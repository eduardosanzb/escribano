# Implementation Plan: Menu Bar .app + DMG Packaging

**Date**: 2026-03-31  **Status**: COMPLETED

## Overview

Convert the Escribano recorder from a headless daemon with LaunchAgent to a standalone macOS menu bar `.app` bundled as an unsigned DMG. The `.app` is self-contained: runs DB migrations, auto-setups Python venv, bundles the ML bridge script, and shows live stats in the menu bar. No Developer ID signing (ad-hoc only for MVP).

## Scope

- Work units: 7
- Execution phases: 2
- Files affected:
  - `apps/recorder/Sources/MigrationRunner.swift` (create)
  - `apps/recorder/Sources/PythonSetup.swift` (create)
  - `apps/recorder/Sources/MenuBarController.swift` (create)
  - `apps/recorder/Info.plist` (create)
  - `scripts/build-app.sh` (create)
  - `apps/recorder/Sources/PythonBridge.vlm.adapter.swift` (modify)
  - `apps/recorder/Sources/FrameStore.port.swift` (modify)
  - `apps/recorder/Sources/FrameStore.sqlite.adapter.swift` (modify)
  - `apps/recorder/Sources/main.swift` (modify)

## Work Units

### WU-1: Swift-native Database Migration Runner

**Dependencies**: none

**Context**: The recorder currently exits with an error if the database schema version is below 17, requiring the Node.js CLI (`escribano recorder install`) to run migrations first. For the standalone `.app`, the recorder must run its own migrations. The Node.js migration runner (`src/db/migrate.ts`) tracks versions in a `_schema_version` table and sets `PRAGMA user_version` after each migration. The Swift port must replicate this exact behavior so both Node.js and Swift can manage the same database. Migration SQL files (001 through 017) live in the repo's `migrations/` directory and will be bundled in `Escribano.app/Contents/Resources/migrations/`.

**Files**:
- `apps/recorder/Sources/MigrationRunner.swift` — create

**Steps**:
1. Create a new file `apps/recorder/Sources/MigrationRunner.swift` with an `enum MigrationRunner` (caseless enum, used as a namespace like the existing `Prompts` and `ResponseParser` enums in the project).

2. Add a static method `run(dbPath: String, migrationsDir: String) throws -> (applied: [String], currentVersion: Int32)` that:
   a. Opens a **new** SQLite connection to `dbPath` (this is intentional — migrations run before any store opens, using a temporary dedicated handle). Set pragmas: `PRAGMA journal_mode = WAL`, `PRAGMA synchronous = NORMAL`, `PRAGMA foreign_keys = ON`, `PRAGMA busy_timeout = 5000`.
   b. Creates the version tracking table if it doesn't exist: `CREATE TABLE IF NOT EXISTS _schema_version (version INTEGER NOT NULL, applied_at TEXT DEFAULT (datetime('now')))`.
   c. Reads the current version: `SELECT MAX(version) FROM _schema_version`. If NULL (fresh DB), treat as 0.
   d. Scans the `migrationsDir` for files matching `^\d+_.+\.sql$`, extracts the numeric prefix, sorts ascending.
   e. For each migration file with version > currentVersion:
      - Reads the SQL file contents as a UTF-8 string
      - Begins a transaction (`BEGIN TRANSACTION`)
      - Executes the SQL via `sqlite3_exec`
      - Inserts into `_schema_version`: `INSERT INTO _schema_version (version) VALUES (?)`
      - Sets `PRAGMA user_version = <version>` (this is what the existing `SQLiteFrameStore`, `SQLiteObservationStore`, and `SQLiteTopicBlockStore` check on startup)
      - Commits (`COMMIT`)
      - If any step fails, rolls back (`ROLLBACK`) and throws
   f. Closes the SQLite handle.
   g. Returns the list of applied filenames and the final version number.

3. Add a static helper `resolveMigrationsDir() -> String?` that checks (in order):
   a. `Bundle.main.resourceURL?.appendingPathComponent("migrations").path` — used when running as `.app`
   b. Environment variable `ESCRIBANO_MIGRATIONS_PATH` — dev override
   c. Returns nil if neither is found (caller should log error and continue without migrations)

4. Use `import Foundation` and `import SQLite3`. Use the same `sqlite3_exec` / `sqlite3_prepare_v2` / `sqlite3_step` patterns as the existing `SQLiteFrameStore` (see `apps/recorder/Sources/FrameStore.sqlite.adapter.swift`). Use the existing `log()` function from `Logger.swift` for all logging with prefix `[MigrationRunner]`.

5. Define an error enum `MigrationError: Error, LocalizedError` with cases: `.connectionFailed(String)`, `.migrationFailed(filename: String, error: String)`, `.directoryNotFound(String)`.

**Verification**: `swift build --package-path apps/recorder 2>&1 | tail -5`

**Rollback**:
- Created files: `rm -f apps/recorder/Sources/MigrationRunner.swift`

---

### WU-2: Info.plist for .app Bundle

**Dependencies**: none

**Context**: The `.app` bundle requires an `Info.plist` that declares the binary executable name, bundle identifier, and critically `LSUIElement = true` which hides the app from the Dock (menu bar only). This plist is separate from the existing `entitlements.plist` (which declares the screen recording capability). The build script will copy this into `Escribano.app/Contents/Info.plist`.

**Files**:
- `apps/recorder/Info.plist` — create

**Steps**:
1. Create `apps/recorder/Info.plist` with the following XML content:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>escribano</string>
    <key>CFBundleIdentifier</key>
    <string>com.escribano.app</string>
    <key>CFBundleName</key>
    <string>Escribano</string>
    <key>CFBundleDisplayName</key>
    <string>Escribano</string>
    <key>CFBundleVersion</key>
    <string>1.0.0</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>LSMinimumSystemVersion</key>
    <string>14.0</string>
    <key>LSUIElement</key>
    <true/>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
```

Key entries explained:
- `CFBundleExecutable`: `escribano` — matches the Swift Package target name in `Package.swift`
- `CFBundleIdentifier`: `com.escribano.app` — used for duplicate instance detection and `SMAppService`
- `LSUIElement`: `true` — hides from Dock, menu bar only
- `LSMinimumSystemVersion`: `14.0` — matches `Package.swift` platform `.macOS(.v14)`

**Verification**: `plutil -lint apps/recorder/Info.plist`

**Rollback**:
- Created files: `rm -f apps/recorder/Info.plist`

---

### WU-3: Python Venv Auto-Setup from Swift

**Dependencies**: none

**Context**: The recorder needs Python 3 with `mlx-vlm` installed to run the VLM bridge. Currently, the Node.js CLI (`src/python-deps.ts`) handles venv creation. For the standalone `.app`, Swift must perform this setup. The core logic is: check if `~/.escribano/venv/bin/python3` exists and has the required packages, if not create the venv and install packages. This should provide progress callbacks so the menu bar can show setup status. The required packages (from `src/python-deps.ts` lines referencing `PYTHON_PACKAGES`) are: `mlx-vlm[torch]>=0.4.0`, `mlx>=0.14.0`, `mlx-lm>=0.9.0`.

**Files**:
- `apps/recorder/Sources/PythonSetup.swift` — create

**Steps**:
1. Create `apps/recorder/Sources/PythonSetup.swift` with an `enum PythonSetup` (caseless namespace enum, same pattern as `Prompts` in this project).

2. Add a static method `ensureVenv(progress: @escaping @Sendable (String) -> Void) async throws -> String` that:
   a. Defines `venvPath = <home>/.escribano/venv` and `pythonPath = venvPath + "/bin/python3"`
   b. If `pythonPath` exists AND packages are importable (check via step 2c), return `pythonPath` immediately (fast path)
   c. Package import check: run `Process()` with `pythonPath -c "import mlx_vlm; import mlx_lm; import mlx"`. If exit code 0, packages are installed. Use a 10-second timeout.
   d. If venv doesn't exist: call `progress("Creating Python environment...")`, find system `python3` (check `/opt/homebrew/bin/python3`, `/usr/local/bin/python3`, `/usr/bin/python3` in order), run `<systemPython> -m venv <venvPath>`. Timeout: 60 seconds.
   e. Install packages: call `progress("Installing ML packages (first run — may take several minutes)...")`, run `<venvPath>/bin/pip3 install mlx-vlm[torch]>=0.4.0 mlx>=0.14.0 mlx-lm>=0.9.0`. Timeout: 300 seconds (5 min — packages are large).
   f. Verify installation by re-running the import check from step 2c. If it fails, throw.
   g. Return `pythonPath`.

3. Add a private static helper `runProcess(executable: String, arguments: [String], timeout: TimeInterval) async throws -> (exitCode: Int32, stdout: String, stderr: String)` that:
   a. Creates a `Process()`, sets `executableURL`, `arguments`
   b. Captures stdout and stderr via `Pipe()`
   c. Runs the process
   d. Uses `Task.sleep` + `process.isRunning` check for timeout (cancel with `process.terminate()` if exceeded)
   e. Returns exit code, stdout string, stderr string

4. Add a private static helper `findSystemPython() -> String?` that checks `/opt/homebrew/bin/python3`, `/usr/local/bin/python3`, `/usr/bin/python3` and returns the first that exists (same resolution order as `PythonBridge.vlm.adapter.swift` line 80-87).

5. Define `enum PythonSetupError: Error, LocalizedError` with cases: `.pythonNotFound`, `.venvCreationFailed(String)`, `.installFailed(String)`, `.verificationFailed`.

6. Use `import Foundation`. Use the existing `log()` function for logging with prefix `[PythonSetup]`.

**Verification**: `swift build --package-path apps/recorder 2>&1 | tail -5`

**Rollback**:
- Created files: `rm -f apps/recorder/Sources/PythonSetup.swift`

---

### WU-4: Menu Bar Controller + FrameStore totalFrameCount

**Dependencies**: none

**Context**: The `.app` presents a menu bar icon (NSStatusItem) with live stats and controls. The design calls for a green/yellow/red dot indicating status, stats showing display count, frame counts, topic blocks, RAM, and CPU usage. It also needs Pause/Resume toggle, Start at Login toggle, and Quit. Stats refresh every 5 seconds using SQLite queries (via existing `FrameStore.pendingFrameCount()` and `TopicBlockStore.count()`). A new `totalFrameCount()` method is needed on FrameStore to show total captured frames. Resource monitoring uses `mach_task_basic_info` for self-process RSS and `proc_pidinfo` for the Python bridge process.

**Files**:
- `apps/recorder/Sources/MenuBarController.swift` — create
- `apps/recorder/Sources/FrameStore.port.swift` — modify (add `totalFrameCount()`)
- `apps/recorder/Sources/FrameStore.sqlite.adapter.swift` — modify (implement `totalFrameCount()`)

**Steps**:
1. **Modify `apps/recorder/Sources/FrameStore.port.swift`**: Add `func totalFrameCount() throws -> Int` to the `FrameStore` protocol. Add it right after the existing `func pendingFrameCount() throws -> Int` declaration. The current protocol (around line 20-30 of the file) looks like:
```swift
protocol FrameStore: AnyObject, Sendable {
    func insertFrame(_ metadata: FrameMetadata) throws
    func pendingFrameCount() throws -> Int
    func claimFrames(batchSize: Int) throws -> [DbFrame]
    ...
}
```
Add `func totalFrameCount() throws -> Int` right after `pendingFrameCount`.

2. **Modify `apps/recorder/Sources/FrameStore.sqlite.adapter.swift`**: Add the implementation of `totalFrameCount()` to `SQLiteFrameStore`. Add it right after the existing `pendingFrameCount()` method (which ends at line 130). The implementation is identical to `pendingFrameCount()` but queries `SELECT COUNT(*) FROM frames` (no WHERE clause). Copy the same pattern:
```swift
func totalFrameCount() throws -> Int {
    var stmt: OpaquePointer?
    let sql = "SELECT COUNT(*) FROM frames"
    guard sqlite3_prepare_v2(handle, sql, -1, &stmt, nil) == SQLITE_OK else {
        let errMsg = String(cString: sqlite3_errmsg(handle))
        throw FrameStoreError.queryFailed(errMsg)
    }
    defer { sqlite3_finalize(stmt) }
    let stepRc = sqlite3_step(stmt)
    guard stepRc == SQLITE_ROW else {
        throw FrameStoreError.queryFailed("COUNT(*) returned no rows (rc=\(stepRc))")
    }
    return Int(sqlite3_column_int(stmt, 0))
}
```

3. **Create `apps/recorder/Sources/MenuBarController.swift`** with:
   a. `import Cocoa`, `import ServiceManagement`, `import Darwin`
   b. `@MainActor final class MenuBarController` with:
      - An `enum Status` with cases: `setup`, `running`, `paused`, `permissionNeeded`, `error(String)`
      - Private properties: `statusItem: NSStatusItem`, `menu: NSMenu`, `statsTimer: Timer?`, `currentStatus: Status`
      - Private properties for stats labels (NSMenuItems used as display-only): `statsDisplaysItem`, `statsFramesItem`, `statsTopicBlocksItem`, `statsResourcesItem`
      - Private property: `pauseResumeItem: NSMenuItem` (toggle text)
      - Private property: `startAtLoginItem: NSMenuItem` (checkbox)
      - Closures: `var onPauseResume: ((Bool) -> Void)?` (true=pause, false=resume), `var onRelaunch: (() -> Void)?`

   c. `init()`:
      - Create `NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)`
      - Set initial button title to "●" (will be colored by setStatus)
      - Build the NSMenu with items matching this layout:
        ```
        [●] Escribano
        ─────────────────────────────
        Recording — {N} displays          (statsDisplaysItem, disabled/non-clickable)
        Frames: — captured · — pending    (statsFramesItem, disabled)
        Topic Blocks: —                   (statsTopicBlocksItem, disabled)
        RAM: — MB  CPU: —%               (statsResourcesItem, disabled)
        ─────────────────────────────
        ⏸  Pause Recording               (pauseResumeItem, action: togglePauseResume)
        ─────────────────────────────
        ☑  Start at Login                (startAtLoginItem, action: toggleStartAtLogin)
           Quit Escribano                (action: quitApp)
        ```
      - For disabled/display-only items, create `NSMenuItem` with empty action and set `.isEnabled = false`
      - For separator lines, use `NSMenuItem.separator()`
      - For Start at Login, check current state via `SMAppService.mainApp.status == .enabled` and set the item's state (`.on` / `.off`) accordingly
      - Assign the menu to `statusItem.menu`

   d. `func setStatus(_ status: Status)`:
      - Store `currentStatus = status`
      - Update the button title (attributed string) based on status:
        - `.setup`: yellow "●" + " Escribano"
        - `.running`: green "●" + " Escribano"
        - `.paused`: yellow "●" + " Escribano"
        - `.permissionNeeded`: red "●" + " Escribano"
        - `.error`: red "●" + " Escribano"
      - Use `NSAttributedString` with `NSColor.systemGreen`, `.systemYellow`, `.systemRed` for the dot, and default label color for text
      - When `.permissionNeeded`: update `statsDisplaysItem.title` to "⚠️ Grant Screen Recording permission" and add a "Relaunch Escribano" menu item (calls `onRelaunch`)

   e. `func setSetupProgress(_ message: String)`:
      - Update `statsDisplaysItem.title` to the message (e.g., "Creating Python environment...")

   f. `func startStatsTimer(frameStore: any FrameStore, tbStore: any TopicBlockStore, displayCount: Int, bridgePID: @escaping () -> Int32)`:
      - Set `statsDisplaysItem.title = "Recording — \(displayCount) display(s)"`
      - Create a 5-second repeating `Timer.scheduledTimer` that:
        - Queries `frameStore.totalFrameCount()` and `frameStore.pendingFrameCount()` (synchronous, called on MainActor — safe because FrameStore is `@unchecked Sendable` confined to MainActor)
        - Queries `tbStore.count()` via `Task { await tbStore.count() }` and updates on completion
        - Gets self-process RSS via `mach_task_basic_info` (see step 3g)
        - Gets Python bridge RSS and CPU via `proc_pidinfo` using `bridgePID()` (see step 3h)
        - Updates menu item titles:
          - `statsFramesItem.title = "Frames: \(total) captured · \(pending) pending"`
          - `statsTopicBlocksItem.title = "Topic Blocks: \(tbCount)"`
          - `statsResourcesItem.title = "RAM: \(totalMB) MB (recorder \(selfMB) + bridge \(bridgeMB))  CPU: \(cpuPct)%"`

   g. Private helper `selfProcessRSS() -> UInt64`:
      ```swift
      var info = mach_task_basic_info()
      var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size / MemoryLayout<integer_t>.size)
      let result = withUnsafeMutablePointer(to: &info) { ptr in
          ptr.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { intPtr in
              task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), intPtr, &count)
          }
      }
      return result == KERN_SUCCESS ? info.resident_size : 0
      ```

   h. Private helper `bridgeProcessRSS(pid: Int32) -> (rssBytes: UInt64, cpuPct: Double)`:
      ```swift
      guard pid > 0 else { return (0, 0) }
      var info = proc_taskinfo()
      let size = Int32(MemoryLayout<proc_taskinfo>.size)
      let result = proc_pidinfo(pid, PROC_PIDTASKINFO, 0, &info, size)
      guard result > 0 else { return (0, 0) }
      let rss = info.pti_resident_size
      // CPU percentage approximation: total user+system time
      // For a simple display, just show RSS (CPU% requires delta tracking over time)
      return (rss, 0)
      ```
      Note: Accurate CPU% requires tracking time deltas between polls. For MVP, just show RAM. Set CPU display to "—" unless a delta is available. The implementor may add a `prevCPUTime` / `prevTimestamp` pair to track deltas between 5s timer ticks if feasible.

   i. `@objc private func togglePauseResume()`:
      - If currently running: call `onPauseResume?(true)`, update item title to "▶  Resume Recording", call `setStatus(.paused)`
      - If currently paused: call `onPauseResume?(false)`, update item title to "⏸  Pause Recording", call `setStatus(.running)`

   j. `@objc private func toggleStartAtLogin()`:
      - If `SMAppService.mainApp.status == .enabled`: call `SMAppService.mainApp.unregister()`, set item state to `.off`
      - Else: `try? SMAppService.mainApp.register()`, set item state to `.on`

   k. `@objc private func quitApp()`:
      - `NSApp.terminate(nil)`

**Verification**: `swift build --package-path apps/recorder 2>&1 | tail -5`

**Rollback**:
- Created files: `rm -f apps/recorder/Sources/MenuBarController.swift`
- Modified files: `git checkout -- apps/recorder/Sources/FrameStore.port.swift apps/recorder/Sources/FrameStore.sqlite.adapter.swift`

---

### WU-5: Bundle Resource Path for Python Bridge Script

**Dependencies**: none

**Context**: The `PythonBridgeVLMAdapter` (in `PythonBridge.vlm.adapter.swift`) currently resolves the bridge script path as: `ESCRIBANO_BRIDGE_PATH` env var → `~/.escribano/scripts/mlx_bridge.py`. For the `.app` bundle, `mlx_bridge.py` will be in `Escribano.app/Contents/Resources/mlx_bridge.py`. The adapter needs to check the bundle resource path first, falling back to the existing resolution chain. This ensures the `.app` is self-contained while dev mode still works.

**Files**:
- `apps/recorder/Sources/PythonBridge.vlm.adapter.swift` — modify

**Steps**:
1. In the `init()` method of `PythonBridgeVLMAdapter`, locate the bridge path resolution block (lines 67-72):
```swift
if let override = ProcessInfo.processInfo.environment["ESCRIBANO_BRIDGE_PATH"] {
    bridgePath = override
} else {
    bridgePath = (ProcessInfo.processInfo.environment["HOME"] ?? "/tmp")
        + "/.escribano/scripts/mlx_bridge.py"
}
```

2. Replace it with a 3-tier resolution that checks Bundle resources first:
```swift
if let override = ProcessInfo.processInfo.environment["ESCRIBANO_BRIDGE_PATH"] {
    bridgePath = override
} else if let bundled = Bundle.main.resourceURL?.appendingPathComponent("mlx_bridge.py").path,
          FileManager.default.fileExists(atPath: bundled) {
    bridgePath = bundled
} else {
    bridgePath = (ProcessInfo.processInfo.environment["HOME"] ?? "/tmp")
        + "/.escribano/scripts/mlx_bridge.py"
}
```

This preserves backward compatibility: env var override > .app bundle resource > home directory fallback.

**Verification**: `swift build --package-path apps/recorder 2>&1 | tail -5`

**Rollback**:
- Modified files: `git checkout -- apps/recorder/Sources/PythonBridge.vlm.adapter.swift`

---

### WU-6: Build Script for .app Bundle + DMG

**Dependencies**: none

**Context**: The current `scripts/build-recorder.sh` builds a plain binary. The `.app` needs a proper bundle structure with `Info.plist`, the binary in `Contents/MacOS/`, and resources (migrations + bridge script) in `Contents/Resources/`. The script also creates a DMG for distribution. It follows the same signing tier logic as the existing build script (env var → keychain identity → adhoc).

**Files**:
- `scripts/build-app.sh` — create

**Steps**:
1. Create `scripts/build-app.sh` as an executable bash script (`chmod +x`). Structure:

```bash
#!/bin/bash
# build-app.sh — Build Escribano.app bundle + DMG for distribution.
#
# Output: dist/Escribano.app and dist/Escribano.dmg
#
# Usage: bash scripts/build-app.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RECORDER_DIR="$REPO_ROOT/apps/recorder"
DIST_DIR="$REPO_ROOT/dist"
APP_DIR="$DIST_DIR/Escribano.app"
CONTENTS="$APP_DIR/Contents"
ENTITLEMENTS="$RECORDER_DIR/entitlements.plist"
INFO_PLIST="$RECORDER_DIR/Info.plist"
```

2. Build the Swift binary:
```bash
echo "==> Building Swift binary..."
swift build --package-path "$RECORDER_DIR" -c release
```

3. Assemble the `.app` bundle:
```bash
echo "==> Assembling Escribano.app..."
rm -rf "$APP_DIR"
mkdir -p "$CONTENTS/MacOS"
mkdir -p "$CONTENTS/Resources/migrations"

# Binary
cp "$RECORDER_DIR/.build/release/escribano" "$CONTENTS/MacOS/escribano"

# Info.plist
cp "$INFO_PLIST" "$CONTENTS/Info.plist"

# Resources: migration SQL files
cp "$REPO_ROOT"/migrations/*.sql "$CONTENTS/Resources/migrations/"

# Resources: Python bridge script
cp "$REPO_ROOT/scripts/mlx_bridge.py" "$CONTENTS/Resources/mlx_bridge.py"

echo "==> Bundle assembled: $APP_DIR"
```

4. Code signing (same tier logic as existing `build-recorder.sh`):
```bash
# Resolve signing identity
if [ -n "$APPLE_SIGNING_IDENTITY" ]; then
  IDENTITY="$APPLE_SIGNING_IDENTITY"
else
  IDENTITY=$(security find-identity -v -p codesigning 2>/dev/null \
    | grep -E '"(Apple Development|Developer ID Application):' \
    | head -1 \
    | awk -F'"' '{print $2}')
fi

if [ -n "$IDENTITY" ]; then
  echo "==> Signing with: $IDENTITY"
  codesign --force --deep --options runtime \
    --entitlements "$ENTITLEMENTS" \
    -s "$IDENTITY" \
    "$APP_DIR"
  echo "==> Signed successfully."
else
  echo "==> Warning: No signing identity found. Using adhoc signing."
  echo "   (TCC permission will reset on every rebuild)"
  codesign --force --deep -s - "$APP_DIR"
fi
```
Note: `--deep` signs nested code in the bundle. This is needed for `.app` bundles.

5. Create DMG:
```bash
echo "==> Creating DMG..."
DMG_PATH="$DIST_DIR/Escribano.dmg"
rm -f "$DMG_PATH"

# Create a temporary DMG with the app
hdiutil create -volname "Escribano" \
  -srcfolder "$APP_DIR" \
  -ov -format UDZO \
  "$DMG_PATH"

echo ""
echo "==> Done!"
echo "   App:  $APP_DIR"
echo "   DMG:  $DMG_PATH"
echo ""
echo "To install: open $DMG_PATH and drag Escribano to /Applications"
```

6. The script should be executable. The implementor should ensure `chmod +x scripts/build-app.sh` is run.

**Verification**: `bash -n scripts/build-app.sh`

**Rollback**:
- Created files: `rm -f scripts/build-app.sh`

---

### WU-7: Main.swift Bootstrap Rewrite + Menu Bar Integration

**Dependencies**: WU-1 (MigrationRunner), WU-3 (PythonSetup), WU-4 (MenuBarController + totalFrameCount), WU-5 (PythonBridge bundle path)

**Context**: This is the integration work unit. The existing `main.swift` runs as a headless daemon: it checks screen recording permission (exits if denied, relying on LaunchAgent to restart), opens DB stores (exits on schema mismatch), and starts capture + analysis. The rewrite transforms it into a menu bar `.app` with a richer bootstrap sequence: hide from Dock, check for duplicate instances, migrate away from old LaunchAgent, run DB migrations, auto-setup Python venv (with progress in menu bar), handle screen recording permission gracefully (show warning instead of exiting), and wire everything to the menu bar controller for live stats. The existing capture/analyzer/aggregator logic is preserved — only the bootstrap and lifecycle management changes.

**Files**:
- `apps/recorder/Sources/main.swift` — modify

**Steps**:

1. **Add Dock hiding**: After the existing line `let app = NSApplication.shared` (line 7), add:
```swift
app.setActivationPolicy(.accessory)
```
This hides the app from the Dock. Must be called before `app.run()`.

2. **Add menuBar property to EscribanoRecorderDelegate**: Add a new property after line 32 (`private var aggregatorTask: Task<Void, Never>?`):
```swift
private var menuBar: MenuBarController?
```

3. **Rewrite `applicationDidFinishLaunching`**: Keep the existing SIGTERM/SIGINT handlers and build commit log, but replace the `Task { @MainActor in await self.start() }` with a new bootstrap sequence:
```swift
// 1. Create menu bar immediately (shows "Setting up..." to user)
let menuBar = MenuBarController()
self.menuBar = menuBar
menuBar.setStatus(.setup)
menuBar.setSetupProgress("Starting up...")

// 2. Run bootstrap in a Task (async operations)
Task { @MainActor in
    await self.bootstrap(menuBar: menuBar)
}
```

4. **Create new `bootstrap(menuBar:)` method** (replaces the old `start()`). This is the main rewrite. The method signature:
```swift
private func bootstrap(menuBar: MenuBarController) async {
```

The body implements this sequence:

**Step 4a — Duplicate instance check**:
```swift
if let bundleId = Bundle.main.bundleIdentifier {
    let running = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId)
    if running.count > 1 {
        log("[escribano-recorder] Another instance is already running. Exiting.")
        NSApp.terminate(nil)
        return
    }
}
```

**Step 4b — LaunchAgent migration** (remove old plist if present):
```swift
let home = FileManager.default.homeDirectoryForCurrentUser
let oldPlist = home.appendingPathComponent("Library/LaunchAgents/com.escribano.capture.plist")
if FileManager.default.fileExists(atPath: oldPlist.path) {
    log("[escribano-recorder] Found old LaunchAgent plist — migrating to .app")
    let uid = getuid()
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/bin/launchctl")
    proc.arguments = ["bootout", "gui/\(uid)/com.escribano.capture"]
    try? proc.run()
    proc.waitUntilExit()
    try? FileManager.default.removeItem(at: oldPlist)
    log("[escribano-recorder] Old LaunchAgent removed")
}
```

**Step 4c — Create directory structure**:
```swift
let escribanoDir = home.appendingPathComponent(".escribano")
let dirs = ["", "frames", "logs", "artifacts", "scripts"]
for dir in dirs {
    let path = escribanoDir.appendingPathComponent(dir)
    try? FileManager.default.createDirectory(at: path, withIntermediateDirectories: true)
}
```

**Step 4d — Run DB migrations**:
```swift
menuBar.setSetupProgress("Running database migrations...")
let dbPath = home.appendingPathComponent(".escribano/escribano.db").path
if let migrationsDir = MigrationRunner.resolveMigrationsDir() {
    do {
        let result = try MigrationRunner.run(dbPath: dbPath, migrationsDir: migrationsDir)
        if !result.applied.isEmpty {
            log("[escribano-recorder] Applied \(result.applied.count) migration(s). Schema version: \(result.currentVersion)")
        } else {
            log("[escribano-recorder] Database up to date (version \(result.currentVersion))")
        }
    } catch {
        log("[escribano-recorder] Migration error: \(error.localizedDescription)")
        menuBar.setStatus(.error("Database migration failed"))
        return
    }
} else {
    log("[escribano-recorder] WARNING: No migrations directory found. Skipping migrations.")
}
```

**Step 4e — Python venv setup**:
```swift
menuBar.setSetupProgress("Checking Python environment...")
do {
    let pythonPath = try await PythonSetup.ensureVenv { message in
        Task { @MainActor in
            menuBar.setSetupProgress(message)
        }
    }
    log("[escribano-recorder] Python ready: \(pythonPath)")
} catch {
    log("[escribano-recorder] Python setup failed: \(error.localizedDescription)")
    log("[escribano-recorder] VLM analysis will not be available until Python is configured")
    // Don't return — capture can still run, just without VLM analysis
}
```

**Step 4f — Screen Recording permission check**:
Replace the existing permission check (lines 67-78 of current main.swift) with a non-exiting version:
```swift
if !CGPreflightScreenCaptureAccess() {
    log("[escribano-recorder] Screen Recording permission not granted.")
    CGRequestScreenCaptureAccess()
    menuBar.setStatus(.permissionNeeded)
    menuBar.onRelaunch = {
        // Spawn a new instance and quit
        if let bundleURL = Bundle.main.bundleURL as URL? {
            let config = NSWorkspace.OpenConfiguration()
            config.createsNewApplicationInstance = true
            NSWorkspace.shared.openApplication(at: bundleURL, configuration: config) { _, _ in }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            NSApp.terminate(nil)
        }
    }
    return  // Don't start capture — user must relaunch after granting
}
log("[escribano-recorder] Screen Recording permission: granted")
menuBar.setSetupProgress("Starting capture...")
```

**Step 4g — Normal startup** (preserve existing logic from the old `start()` method, lines 81-217). Copy the entire block starting from `let dbPath = ...` through setting up stores, backpressure, displays, captures, analyzer, aggregator, and backpressure closures. The key changes to this existing block:

- Remove the `let dbPath = ...` line (already defined in step 4d)
- Change the schema mismatch catch for `SQLiteFrameStore` to show error in menu bar instead of `exit(1)`:
  ```swift
  } catch FrameStoreError.schemaMismatch(let current, let expected) {
      log("[escribano-recorder] ERROR: Schema mismatch (version \(current), expected \(expected))")
      menuBar.setStatus(.error("Database schema error"))
      return
  } catch {
      log("[escribano-recorder] ERROR: Cannot open database: \(error.localizedDescription)")
      menuBar.setStatus(.error("Database error"))
      return
  }
  ```
- Similarly for other `exit(1)` calls — replace with `menuBar.setStatus(.error(...))` + `return`

**Step 4h — Wire menu bar** (after all existing startup logic):
```swift
// Set running status
menuBar.setStatus(.running)

// Wire pause/resume
menuBar.onPauseResume = { [weak self] shouldPause in
    guard let self = self else { return }
    if shouldPause {
        self.captures.forEach { $0.pause() }
    } else {
        self.captures.forEach { $0.resume() }
    }
}

// Start stats timer
menuBar.startStatsTimer(
    frameStore: store,
    tbStore: tbStore,
    displayCount: captures.count,
    bridgePID: { [weak self] in self?.vlmAdapter?.storedPID ?? 0 }
)
```

5. **Rename old `start()` to be replaced**: The old `start()` method is fully replaced by `bootstrap(menuBar:)`. Delete the old `start()` method entirely and replace it with the new `bootstrap(menuBar:)` method.

6. **Update `applicationWillTerminate`**: Add cleanup for the stats timer and menu bar. After the existing cleanup code (line 242), before the closing brace:
```swift
// MenuBarController cleanup (timer invalidation happens automatically when the controller is deallocated)
menuBar = nil
```

7. **Keep the backpressure onPause/onResume closures** from the existing code (lines 209-214), but they should now coexist with the menu bar's pause/resume. The menu bar's `onPauseResume` closure calls `captures.forEach { $0.pause/resume() }` directly. The backpressure closures also pause/resume captures. Both can coexist — backpressure handles automatic load management, menu bar handles user-initiated pause.

8. **Update backpressure closures** to also update menu bar status:
```swift
bp.onPause = { [weak self] in
    self?.captures.forEach { $0.pause() }
    self?.menuBar?.setStatus(.paused)
}
bp.onResume = { [weak self] in
    self?.captures.forEach { $0.resume() }
    self?.menuBar?.setStatus(.running)
}
```

**Verification**: `swift build --package-path apps/recorder 2>&1 | tail -5`

**Rollback**:
- Modified files: `git checkout -- apps/recorder/Sources/main.swift`

---

## Execution Plan

### Phase 1 — Parallel (no dependencies)

- WU-1: Swift-native Database Migration Runner
- WU-2: Info.plist for .app Bundle
- WU-3: Python Venv Auto-Setup from Swift
- WU-4: Menu Bar Controller + FrameStore totalFrameCount
- WU-5: Bundle Resource Path for Python Bridge Script
- WU-6: Build Script for .app Bundle + DMG

### Phase 2 — Sequential (requires Phase 1)

- WU-7: Main.swift Bootstrap Rewrite + Menu Bar Integration

## Recovery Strategy

- **Automatic**: Each implementor rolls back and retries once on failure.
- **Dependency failure**: If any Phase 1 work unit fails and WU-7 depends on it (specifically WU-1, WU-3, WU-4, WU-5), WU-7 will not run. WU-2 and WU-6 are not code dependencies of WU-7 (they're build-time artifacts).
- **Global rollback**: `git stash` or `git reset HEAD~N --hard` where N is the number of committed work units.
- **Independent failures**: WU-2 (Info.plist) and WU-6 (build script) can fail without affecting other units. WU-1, WU-3, WU-4, WU-5 are all required for WU-7 to compile.
- **Critical path**: WU-4 (MenuBarController) is the most complex Phase 1 unit. If it fails, WU-7 cannot proceed. The other Phase 1 units are simpler and lower risk.
