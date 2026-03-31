# Implementation Plan: Resolve Merge Conflicts + PR #60 Review Fixes

**Date**: 2026-03-31  **Status**: IN PROGRESS

## Overview

Resolve the 4 merge conflicts from rebasing `feat/menu-bar-app` onto `main`, while simultaneously addressing all 9 unresolved PR #60 review comments. The central design change is replacing both the branch's simple `pause()`/`resume()` and main's 6-method granular pause system with a unified `Set<PauseReason>` pattern in `StreamCapture`, then wiring all callers (backpressure, screen lock, sleep, menu bar) through it.

## Scope

- Work units: 9
- Execution phases: 2
- Files affected:
  - `apps/recorder/Sources/StreamCapture.swift` — modify (conflict + refactor)
  - `apps/recorder/Sources/main.swift` — modify (conflict + review fixes)
  - `apps/recorder/Sources/Logger.swift` — modify (review fixes)
  - `apps/recorder/Sources/MenuBarController.swift` — modify (review fixes)
  - `apps/recorder/Sources/PythonSetup.swift` — modify (review fixes)
  - `apps/recorder/Sources/MigrationRunner.swift` — modify (review fix)
  - `MVP-FINAL-PUSH.md` — modify (conflict cleanup)
  - `plans/2026-03-31-menu-bar-app-dmg.md` — modify (conflict cleanup)
  - `scripts/build-app.sh` — modify (review fix)

## Work Units

### WU-1: Refactor StreamCapture pause system to Set<PauseReason>

**Dependencies**: none

**Context**: The merge conflict in StreamCapture.swift arises because this branch added a simple `pause()`/`resume()` pair while main added 6 separate methods (`pauseForBackpressure`, `pauseForScreenLock`, `pauseForSleep` + their resume counterparts) with cross-checked boolean flags. Both approaches are being replaced with a single `Set<PauseReason>` pattern that correctly handles overlapping pause reasons (e.g., backpressure + screen lock simultaneously) without the complexity of N boolean flags and 2N methods.

**Files**:
- `apps/recorder/Sources/StreamCapture.swift` — modify

**Steps**:
1. Remove the conflict markers (lines 96-154) and the three boolean properties (`isPausedByBackpressure`, `isPausedByScreenLock`, `isPausedBySleep`) at lines 23-26.

2. Add a `PauseReason` enum and a `Set<PauseReason>` property. Place this right after the existing `private let backpressure: Backpressure` line (line 15) and before the debugging configuration section. The enum should be defined at file scope (before the `StreamCapture` class) or as a nested type:
```swift
enum PauseReason: Hashable {
    case backpressure
    case screenLock
    case sleep
    case user
}
```
Inside the class, replace the three boolean properties and the computed `isPaused` with:
```swift
private var pauseReasons: Set<PauseReason> = []
private var isPaused: Bool { !pauseReasons.isEmpty }
```

3. Replace all 6+ pause/resume methods (and the conflicted block) with exactly two methods:
```swift
func pause(_ reason: PauseReason) {
    let wasEmpty = pauseReasons.isEmpty
    pauseReasons.insert(reason)
    if wasEmpty {
        Task { try? await stream?.stopCapture() }
    }
    log("[StreamCapture] Paused (\(reason)). Active reasons: \(pauseReasons)")
}

func resume(_ reason: PauseReason) {
    pauseReasons.remove(reason)
    if pauseReasons.isEmpty {
        Task { try? await stream?.startCapture() }
    }
    log("[StreamCapture] Resumed from \(reason). Active reasons: \(pauseReasons)")
}
```

4. Fix all remaining `print()` calls in the file to use `log()` instead. Specifically:
   - Line 114: `print("[StreamCapture] Paused (backpressure).")` — removed by step 3
   - Line 183: `print("[StreamCapture] High churn detected...")` → `log("[StreamCapture] High churn detected...")`
   - Line 185: `print("[StreamCapture] Churn rate normalized...")` → `log("[StreamCapture] Churn rate normalized...")`
   - Line 194: `print("[pHash] KEEP frame=...")` → `log("[pHash] KEEP frame=...")`
   - Line 210: `print(String(format: "[pHash] Stats:..."))` → `log(String(format: "[pHash] Stats:..."))`
   - Line 271: `print("[StreamCapture] \(frameCounter) frames stored in DB")` → `log("[StreamCapture] \(frameCounter) frames stored in DB")`

**Verification**: `cd apps/recorder && swift build 2>&1 | grep -c "error:" | grep -q "^0$" || swift build`

**Rollback**:
- `git checkout -- apps/recorder/Sources/StreamCapture.swift`

---

### WU-2: Fix Logger thread safety and ISO8601DateFormatter allocation

**Dependencies**: none

**Context**: The `log()` function in Logger.swift has two issues flagged in PR #60 review: (1) It creates a new `ISO8601DateFormatter` on every call, which is expensive on a hot path (capture loop calls `log()` frequently), and (2) it writes to a shared log file from multiple actors/threads without any synchronization, leading to potential interleaved or lost writes. The fix uses a static shared formatter and a serial DispatchQueue with a persistent FileHandle for thread-safe appends.

**Files**:
- `apps/recorder/Sources/Logger.swift` — modify

**Steps**:
1. The current file (39 lines total) has this structure:
```swift
func log(_ message: String) {
    let timestamp = ISO8601DateFormatter().string(from: Date())
    ...
}
private func writeToLogFile(_ line: String) {
    // Opens/closes FileHandle on every call, no synchronization
}
```

2. Rewrite the entire file with these changes:
   - Add a `private let` static `ISO8601DateFormatter` at file/module scope (or use `Date().formatted(.iso8601)` as suggested in the review).
   - Create a private serial `DispatchQueue` for log file writes.
   - Open a persistent `FileHandle` lazily on first write, keep it open for the process lifetime.
   - The `log()` function should format the message, print to stdout synchronously (for Console.app / `log stream`), then dispatch the file write asynchronously to the serial queue.

3. The rewritten file should look approximately like:
```swift
import Foundation

/// Shared ISO8601 formatter — avoids per-call allocation (~5ms each).
private let isoFormatter: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    return f
}()

/// Serial queue for thread-safe log file writes.
private let logQueue = DispatchQueue(label: "com.escribano.logger", qos: .utility)

/// Lazily-opened persistent file handle for append-only log writes.
private var logFileHandle: FileHandle?

func log(_ message: String) {
    let timestamp = isoFormatter.string(from: Date())
    let line = "[\(timestamp)] \(message)"

    // Always print to stdout (captured by `log stream` or Console.app)
    print(line)
    fflush(stdout)

    // Thread-safe file write
    logQueue.async {
        writeToLogFile(line)
    }
}

private func writeToLogFile(_ line: String) {
    let logsDir = (ProcessInfo.processInfo.environment["HOME"] ?? NSHomeDirectory())
        + "/.escribano/logs"
    let logPath = logsDir + "/recorder.log"

    if logFileHandle == nil {
        // Ensure directory exists
        try? FileManager.default.createDirectory(atPath: logsDir, withIntermediateDirectories: true)

        // Create file if needed
        if !FileManager.default.fileExists(atPath: logPath) {
            FileManager.default.createFile(atPath: logPath, contents: nil)
        }

        logFileHandle = FileHandle(forWritingAtPath: logPath)
        logFileHandle?.seekToEndOfFile()
    }

    guard let handle = logFileHandle,
          let data = (line + "\n").data(using: .utf8) else { return }
    handle.write(data)
}
```

**Verification**: `cd apps/recorder && swift build 2>&1 | grep -c "error:" | grep -q "^0$" || swift build`

**Rollback**:
- `git checkout -- apps/recorder/Sources/Logger.swift`

---

### WU-3: Fix MigrationRunner sqlite3_open_v2 handle leak

**Dependencies**: none

**Context**: In MigrationRunner.swift, if `sqlite3_open_v2` fails, SQLite may still allocate a non-null handle. The current code throws an error in the `guard` block (line 61-64) without closing the handle, since the `defer { sqlite3_close(handle) }` block is declared AFTER the guard (line 66-68). This leaks a connection/file descriptor on open failures.

**Files**:
- `apps/recorder/Sources/MigrationRunner.swift` — modify

**Steps**:
1. In the `run()` method, find the guard block at lines 61-64:
```swift
        guard openRc == SQLITE_OK else {
            let errMsg = handle.map { String(cString: sqlite3_errmsg($0)) } ?? "unknown"
            throw MigrationError.connectionFailed(errMsg)
        }
```

2. Add `sqlite3_close` for a non-nil handle before throwing, so it becomes:
```swift
        guard openRc == SQLITE_OK else {
            let errMsg = handle.map { String(cString: sqlite3_errmsg($0)) } ?? "unknown"
            if let h = handle { sqlite3_close(h) }
            throw MigrationError.connectionFailed(errMsg)
        }
```

3. Also fix the `try! NSRegularExpression` at line 179 — replace with a proper error-handling or static let pattern. Change:
```swift
        let pattern = try! NSRegularExpression(pattern: #"^(\d+)_.+\.sql$"#)
```
to:
```swift
        let pattern: NSRegularExpression
        do {
            pattern = try NSRegularExpression(pattern: #"^(\d+)_.+\.sql$"#)
        } catch {
            // The pattern is a compile-time constant — this should never fail.
            // If it somehow does, return an empty migration list rather than crashing.
            log("[MigrationRunner] Warning: Failed to compile migration filename regex: \(error)")
            return []
        }
```

4. Also fix `readCurrentVersion` (line 207-211) to properly distinguish SQLITE_DONE from errors:
```swift
        let stepRc = sqlite3_step(stmt)
        switch stepRc {
        case SQLITE_ROW:
            break
        case SQLITE_DONE:
            return 0
        default:
            let errMsg = String(cString: sqlite3_errmsg(handle))
            throw MigrationError.connectionFailed("Failed to read schema version (rc=\(stepRc)): \(errMsg)")
        }
```

**Verification**: `cd apps/recorder && swift build 2>&1 | grep -c "error:" | grep -q "^0$" || swift build`

**Rollback**:
- `git checkout -- apps/recorder/Sources/MigrationRunner.swift`

---

### WU-4: Fix PythonSetup pipe deadlock and timeout escalation

**Dependencies**: none

**Context**: PythonSetup.swift's `runProcess` method has two issues: (1) stdout/stderr pipes are not drained until after `waitUntilExit()`, which can deadlock if the child process (e.g., `pip install`) fills the pipe buffer (~64KB), and (2) after calling `process.terminate()` on timeout, it still does a blocking `waitUntilExit()` which hangs forever if the child ignores SIGTERM.

**Files**:
- `apps/recorder/Sources/PythonSetup.swift` — modify

**Steps**:
1. Find the `runProcess` method (lines 143-188). The current implementation:
```swift
    private static func runProcess(
        executable: String,
        arguments: [String],
        timeout: TimeInterval
    ) async throws -> (exitCode: Int32, stdout: String, stderr: String) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments

        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        try process.run()

        // Timeout: poll isRunning until deadline, then terminate.
        let deadline = Date(timeIntervalSinceNow: timeout)
        while process.isRunning {
            if Date() > deadline {
                process.terminate()
                log("[PythonSetup] Process timed out after \(Int(timeout))s: \(executable)")
                break
            }
            do {
                try await Task.sleep(nanoseconds: 100_000_000) // 100ms
            } catch {
                process.terminate()
                process.waitUntilExit()
                throw error
            }
        }

        process.waitUntilExit()
        stdoutPipe.fileHandleForWriting.closeFile()
        stderrPipe.fileHandleForWriting.closeFile()

        let stdoutData = stdoutPipe.fileHandleForReading.readDataToEndOfFile()
        let stderrData = stderrPipe.fileHandleForReading.readDataToEndOfFile()
        ...
    }
```

2. Replace the `runProcess` method with a version that:
   - Drains stdout/stderr concurrently using `readabilityHandler` BEFORE calling `run()`.
   - After timeout + `terminate()`, waits a 2-second grace period, then escalates to `kill()` (SIGKILL).
   - Does NOT do a potentially-infinite `waitUntilExit()` after timeout.

3. The new implementation should be:
```swift
    private static func runProcess(
        executable: String,
        arguments: [String],
        timeout: TimeInterval
    ) async throws -> (exitCode: Int32, stdout: String, stderr: String) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments

        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        // Drain pipes concurrently to prevent buffer deadlock.
        // Pipe buffers are ~64KB — pip install easily exceeds this.
        var stdoutChunks: [Data] = []
        var stderrChunks: [Data] = []
        let stdoutLock = NSLock()
        let stderrLock = NSLock()

        stdoutPipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if !data.isEmpty {
                stdoutLock.lock()
                stdoutChunks.append(data)
                stdoutLock.unlock()
            }
        }
        stderrPipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if !data.isEmpty {
                stderrLock.lock()
                stderrChunks.append(data)
                stderrLock.unlock()
            }
        }

        try process.run()

        // Timeout: poll isRunning until deadline, then terminate.
        let deadline = Date(timeIntervalSinceNow: timeout)
        while process.isRunning {
            if Date() > deadline {
                process.terminate()
                log("[PythonSetup] Process timed out after \(Int(timeout))s: \(executable)")
                // Grace period: wait 2s for SIGTERM, then escalate to SIGKILL
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                if process.isRunning {
                    process.interrupt() // SIGINT as intermediate step
                    try? await Task.sleep(nanoseconds: 500_000_000)
                    if process.isRunning {
                        kill(process.processIdentifier, SIGKILL)
                    }
                }
                break
            }
            do {
                try await Task.sleep(nanoseconds: 100_000_000) // 100ms
            } catch {
                // Task cancelled — kill child before propagating.
                process.terminate()
                process.waitUntilExit()
                throw error
            }
        }

        process.waitUntilExit()

        // Stop readability handlers and collect remaining data
        stdoutPipe.fileHandleForReading.readabilityHandler = nil
        stderrPipe.fileHandleForReading.readabilityHandler = nil

        // Read any remaining data in the pipe
        let finalStdout = stdoutPipe.fileHandleForReading.readDataToEndOfFile()
        let finalStderr = stderrPipe.fileHandleForReading.readDataToEndOfFile()
        if !finalStdout.isEmpty {
            stdoutChunks.append(finalStdout)
        }
        if !finalStderr.isEmpty {
            stderrChunks.append(finalStderr)
        }

        let stdoutData = stdoutChunks.reduce(Data(), +)
        let stderrData = stderrChunks.reduce(Data(), +)
        let stdoutStr = String(data: stdoutData, encoding: .utf8) ?? ""
        let stderrStr = String(data: stderrData, encoding: .utf8) ?? ""

        return (process.terminationStatus, stdoutStr, stderrStr)
    }
```

4. Remove the now-unnecessary `closeFile()` calls that were at lines 179-180 (they are no longer needed since readabilityHandler drains the pipes).

**Verification**: `cd apps/recorder && swift build 2>&1 | grep -c "error:" | grep -q "^0$" || swift build`

**Rollback**:
- `git checkout -- apps/recorder/Sources/PythonSetup.swift`

---

### WU-5: Fix MenuBarController timer leak, stale menu item, and CPU% PID tracking

**Dependencies**: none

**Context**: PR #60 review flagged three issues in MenuBarController.swift: (1) `statsTimer` is never invalidated when the controller is released, causing run-loop leak and unnecessary wakeups; (2) when entering `.permissionNeeded` state a "Relaunch Escribano" menu item is added but never removed when transitioning to other states; (3) CPU% calculation uses wrapping subtraction without resetting when the bridge PID changes, producing nonsensical percentages.

**Files**:
- `apps/recorder/Sources/MenuBarController.swift` — modify

**Steps**:
1. Add a `deinit` block to `MenuBarController` to invalidate the timer. Place it right after the `init()` closing brace (after line 133):
```swift
    deinit {
        statsTimer?.invalidate()
    }
```

2. Fix the stale "Relaunch Escribano" menu item. In the `setStatus(_:)` method, add cleanup logic at the top of the method (after `currentStatus = status` on line 139) that removes the relaunch item when transitioning away from `.permissionNeeded`:
```swift
    func setStatus(_ status: Status) {
        currentStatus = status

        // Clean up permission-specific UI when leaving .permissionNeeded state
        if case .permissionNeeded = status {
            // Will be re-added below if needed
        } else {
            if let relaunchItem = menu.item(withTitle: "Relaunch Escribano") {
                menu.removeItem(relaunchItem)
            }
            // Restore default stats display title
            if statsDisplaysItem.title.hasPrefix("⚠️") {
                statsDisplaysItem.title = "Recording — —"
            }
        }

        guard let button = statusItem.button else { return }
        // ... rest of existing switch statement
```

3. Fix the CPU% PID tracking issue. Add a `prevBridgePID` property alongside the existing `prevCPUTime` and `prevTimestamp` properties (around line 48):
```swift
    private var prevBridgePID: Int32 = 0
```

4. In the `bridgeProcessRSS(pid:)` method (line 273), add a PID change check right after the `guard pid > 0` check:
```swift
    private func bridgeProcessRSS(pid: Int32) -> (rssBytes: UInt64, cpuPct: Double) {
        guard pid > 0 else {
            prevBridgePID = 0
            prevCPUTime = 0
            prevTimestamp = 0
            return (0, 0)
        }

        // Reset CPU tracking when bridge PID changes (e.g., after restart)
        if pid != prevBridgePID {
            prevBridgePID = pid
            prevCPUTime = 0
            prevTimestamp = 0
        }

        var info = proc_taskinfo()
        // ... rest of existing implementation
```

5. Also add a guard against counter rollback in the CPU% delta calculation (around line 290):
```swift
        if prevTimestamp > 0 && elapsed > 0 && prevCPUTime > 0 && currentCPUTime >= prevCPUTime {
```

**Verification**: `cd apps/recorder && swift build 2>&1 | grep -c "error:" | grep -q "^0$" || swift build`

**Rollback**:
- `git checkout -- apps/recorder/Sources/MenuBarController.swift`

---

### WU-6: Clean up MVP-FINAL-PUSH.md conflict markers

**Dependencies**: none

**Context**: MVP-FINAL-PUSH.md has deeply nested conflict markers from multiple merge attempts (this branch vs main vs a capture-quality-guards commit). The content is semantically identical between both sides — just formatting differences (compact vs wide). The resolution takes the compact formatting (this branch's style) while incorporating the content additions from main (Capture Quality Guards section, table formatting).

**Files**:
- `MVP-FINAL-PUSH.md` — modify

**Steps**:
1. This is a pure markdown document with no code implications. The conflicts are:
   - Lines 3-74: Duplicated header/architecture/prerequisites sections with nested `<<<<<<< HEAD` / `54e8c5f` / `main` markers
   - Lines 93-124: Duplicated "Completed Prerequisites" + "Day 1" sections
   - Lines 141-150: Resource monitoring line formatting
   - Lines 158-177: Bootstrap section formatting
   - Lines 182-191: DMG section formatting
   - Lines 200-209: Phase 3b intro formatting
   - Lines 257-276: Risk table formatting

2. Resolve all conflicts by:
   - Taking the **first** (HEAD/branch) version for all content that is identical between sides (just compact formatting)
   - Removing the duplicated "Completed Prerequisites" section at lines 93-101 (it appears earlier in the file at lines 46-73)
   - Keeping the "Capture Quality Guards" subsection from main (screen lock detection, churn rate limiter)
   - Removing all `<<<<<<< HEAD`, `=======`, `>>>>>>> main`, and `>>>>>>> 54e8c5f` markers

3. The file should have exactly ONE of each section, with no conflict markers remaining.

**Verification**: `grep -c '<<<<<<' MVP-FINAL-PUSH.md | grep -q '^0$'`

**Rollback**:
- `git checkout -- MVP-FINAL-PUSH.md`

---

### WU-7: Fix plan status conflict marker

**Dependencies**: none

**Context**: The `plans/2026-03-31-menu-bar-app-dmg.md` file has a single conflict: the branch says `Status: COMPLETED` while main says `Status: PENDING APPROVAL`. The branch is correct — the menu bar app implementation was already completed.

**Files**:
- `plans/2026-03-31-menu-bar-app-dmg.md` — modify

**Steps**:
1. Find the conflict at lines 2-7:
```
<<<<<<< HEAD
**Date**: 2026-03-31  **Status**: COMPLETED
=======
**Date**: 2026-03-31  **Status**: PENDING APPROVAL
>>>>>>> main
```

2. Replace with the branch version only:
```
**Date**: 2026-03-31  **Status**: COMPLETED
```

**Verification**: `grep -c '<<<<<<' plans/2026-03-31-menu-bar-app-dmg.md | grep -q '^0$'`

**Rollback**:
- `git checkout -- plans/2026-03-31-menu-bar-app-dmg.md`

---

### WU-8: Ensure dist/ directory exists in build script

**Dependencies**: none

**Context**: The build script `scripts/build-app.sh` sets `DIST_DIR="$REPO_ROOT/dist"` and uses it for `APP_DIR` and `DMG_PATH`, but never ensures `dist/` exists before writing to it. While `mkdir -p "$CONTENTS/MacOS"` implicitly creates it, an explicit `mkdir -p` makes the intent clear and prevents breakage if the script order changes.

**Files**:
- `scripts/build-app.sh` — modify

**Steps**:
1. After line 12 (`DIST_DIR="$REPO_ROOT/dist"`), add:
```bash
mkdir -p "$DIST_DIR"
```

So lines 12-13 become:
```bash
DIST_DIR="$REPO_ROOT/dist"
mkdir -p "$DIST_DIR"
```

**Verification**: `bash -n scripts/build-app.sh && grep -q 'mkdir -p "$DIST_DIR"' scripts/build-app.sh`

**Rollback**:
- `git checkout -- scripts/build-app.sh`

---

### WU-9: Resolve main.swift conflicts and wire PauseReason API

**Dependencies**: WU-1 (StreamCapture PauseReason API), WU-5 (MenuBarController fixes)

**Context**: main.swift has three conflict zones: (1) the property declarations where both `menuBar` and `screenLockObserver` need to coexist; (2) the backpressure callbacks and screen lock wiring where the branch uses `pause()`/`resume()` and main uses the granular variants; (3) the sleep/wake hooks with the same API mismatch. Additionally, two PR review comments need fixing: the `terminationHandler` race condition in the LaunchAgent migration (line 92), and the stale "run `escribano recorder install`" error message (line 274).

**Files**:
- `apps/recorder/Sources/main.swift` — modify

**Steps**:
1. **Property declarations** (lines 35-39): Replace the conflict block with both properties:
```swift
    private var menuBar: MenuBarController?
    private var screenLockObserver: ScreenLockObserver?
```

2. **terminationHandler race** (lines 90-94): The current code sets `proc.terminationHandler` AFTER `proc.run()`. Fix by setting it before and adding a `didResume` guard. Replace the existing `do { try proc.run() ... }` block (approximately lines 90-97) with:
```swift
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                var didResume = false

                proc.terminationHandler = { _ in
                    guard !didResume else { return }
                    didResume = true
                    continuation.resume()
                }

                do {
                    try proc.run()
                } catch {
                    if !didResume {
                        didResume = true
                        log("[escribano-recorder] launchctl bootout failed to launch: \(error)")
                        continuation.resume()
                    }
                }
            }
```

3. **Stale error message** (line 274): Find the error log that says:
```swift
            log("[escribano-recorder] ERROR: Database schema out of date (version \(current), expected \(expected)). Run 'escribano recorder install' from Node.js.")
```
Replace with:
```swift
            log("[escribano-recorder] ERROR: Database schema out of date (version \(current), expected \(expected)). Database migrations normally run automatically on startup; please reinstall or repair the Escribano app and try again.")
```

4. **Backpressure callbacks** (lines 295-308): Replace the conflict block. Wire backpressure to the new PauseReason API and update menu bar status:
```swift
        bp.onPause = { [weak self] in
            self?.captures.forEach { $0.pause(.backpressure) }
            self?.menuBar?.setStatus(.paused)
        }
        bp.onResume = { [weak self] in
            self?.captures.forEach { $0.resume(.backpressure) }
            self?.menuBar?.setStatus(.running)
        }
```

5. **Screen lock wiring** (lines 311-321): Keep the screen lock observer code from main, but update to use the new API:
```swift
        let lockObserver = ScreenLockObserver()
        lockObserver.onLock = { [weak self] in
            self?.captures.forEach { $0.pause(.screenLock) }
            log("[escribano-recorder] Screen locked — all captures paused")
        }
        lockObserver.onUnlock = { [weak self] in
            self?.captures.forEach { $0.resume(.screenLock) }
            log("[escribano-recorder] Screen unlocked — all captures resumed")
        }
        self.screenLockObserver = lockObserver
```

6. **Menu bar onPauseResume** (lines 331-338): Update the menu bar pause/resume callback to use `.user` reason:
```swift
        menuBar.onPauseResume = { [weak self] shouldPause in
            guard let self = self else { return }
            if shouldPause {
                self.captures.forEach { $0.pause(.user) }
            } else {
                self.captures.forEach { $0.resume(.user) }
            }
        }
```

7. **Sleep/wake hooks** (lines 354-370): Replace the conflict in the wake handler. Update sleep to use `.sleep` reason:
```swift
            ws.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in
                    guard let self else { return }
                    log("[escribano-recorder] System will sleep — pausing capture")
                    self.captures.forEach { $0.pause(.sleep) }
                }
            }
            ws.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in
                    guard let self else { return }
                    log("[escribano-recorder] System woke — resuming capture and resetting backoff")
                    self.captures.forEach { $0.resume(.sleep) }
                    // Reset analyzer and aggregator backoff since new frames are incoming
                    await self.analyzer?.resetBackoff()
                    await self.aggregator?.resetBackoff()
                }
            }
```

**Verification**: `cd apps/recorder && swift build 2>&1 | grep "error:" | head -5; swift build 2>&1 | tail -1`

**Rollback**:
- `git checkout -- apps/recorder/Sources/main.swift`

---

## Execution Plan

### Phase 1 — Parallel (no dependencies)

- WU-1: Refactor StreamCapture pause system to Set<PauseReason>
- WU-2: Fix Logger thread safety and ISO8601DateFormatter allocation
- WU-3: Fix MigrationRunner sqlite3_open_v2 handle leak
- WU-4: Fix PythonSetup pipe deadlock and timeout escalation
- WU-5: Fix MenuBarController timer leak, stale menu item, and CPU% PID tracking
- WU-6: Clean up MVP-FINAL-PUSH.md conflict markers
- WU-7: Fix plan status conflict marker
- WU-8: Ensure dist/ directory exists in build script

### Phase 2 — Sequential (requires Phase 1, specifically WU-1 and WU-5)

- WU-9: Resolve main.swift conflicts and wire PauseReason API

## Recovery Strategy

- **Automatic**: Each implementor rolls back and retries once on failure.
- **Dependency failure**: If WU-1 (StreamCapture) fails, WU-9 (main.swift) will be skipped since it depends on the PauseReason API. All other Phase 1 WUs are independent.
- **Global rollback**: `git checkout -- apps/recorder/Sources/ MVP-FINAL-PUSH.md plans/2026-03-31-menu-bar-app-dmg.md scripts/build-app.sh` to restore all files to their conflicted state.
- **Build verification**: After Phase 2, run `swift build` in `apps/recorder/` to verify the entire recorder compiles.
