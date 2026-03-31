# Implementation Plan: Merge Resolution + Bridge PID Wiring + Logging Cleanup

**Date**: 2026-03-31  **Status**: COMPLETED

## Overview

Three concerns handled in one plan: (1) complete the mid-flight `git merge origin/main` by resolving
5 conflicted files, (2) wire the Python bridge PID into the menu bar RAM stats display using a clean
`nonisolated var bridgePID` property on the adapter rather than exposing it through InferenceQueue,
and (3) promote error and lifecycle `print()` calls to `log()` in StreamCapture and Backpressure so
they reach `~/.escribano/logs/recorder.log`.

## Scope

- Work units: 9
- Execution phases: 4
- Files affected:
  - `apps/recorder/Sources/Logger.swift` (conflict → resolve)
  - `MVP-FINAL-PUSH.md` (conflict → resolve)
  - `apps/recorder/README.md` (conflict → resolve)
  - `apps/recorder/Sources/PythonBridge.vlm.adapter.swift` (conflict → resolve, then add `bridgePID`)
  - `apps/recorder/Sources/main.swift` (conflict → resolve, then wire `worker.bridgePID`)
  - `apps/recorder/Sources/StreamCapture.swift` (logging)
  - `apps/recorder/Sources/Backpressure.swift` (logging)

---

## Work Units

### WU-1: Resolve Logger.swift merge conflict

**Dependencies**: none

**Context**: A `git merge origin/main` is currently mid-flight on the `feat/menu-bar-app` branch.
`apps/recorder/Sources/Logger.swift` has conflict markers in the doc comment only (lines 5-11). Our
branch added file logging to `~/.escribano/logs/recorder.log`; `origin/main` kept only stdout. The
actual implementation body (the `log()` function + `writeToLogFile()`) is already correct below the
conflict zone — only the doc comment is conflicted. Resolution: keep our doc comment, drop origin's.

**Files**:
- `apps/recorder/Sources/Logger.swift` — modify

**Steps**:
1. Open `apps/recorder/Sources/Logger.swift`. The file currently looks like this at lines 3-11:
   ```
   /// Global logging function for the escribano recorder.
   ///
   <<<<<<< HEAD
   /// Writes timestamped messages to both stdout and a log file at
   /// ~/.escribano/logs/recorder.log. The file is created on first use.
   =======
   /// Writes messages to stdout (not timestamped — the LaunchAgent captures
   /// stdout to a log file where macOS adds timestamps automatically).
   >>>>>>> origin
   func log(_ message: String) {
   ```
2. Remove the three conflict-marker lines (`<<<<<<< HEAD`, `=======`, `>>>>>>> origin`) and
   origin's two comment lines. Keep our two comment lines. The result at lines 3-7 must be:
   ```swift
   /// Global logging function for the escribano recorder.
   ///
   /// Writes timestamped messages to both stdout and a log file at
   /// ~/.escribano/logs/recorder.log. The file is created on first use.
   func log(_ message: String) {
   ```
3. Leave every other line in the file completely unchanged (lines 12-44 are clean).

**Verification**: `! grep -q "^<<<<<<< " apps/recorder/Sources/Logger.swift`

**Rollback**:
- `git checkout -- apps/recorder/Sources/Logger.swift`

---

### WU-2: Resolve MVP-FINAL-PUSH.md merge conflict

**Dependencies**: none

**Context**: `MVP-FINAL-PUSH.md` has one conflict zone around line 21. Our branch had a
`## Completed Prerequisites` section heading there. `origin/main` inserted three new sections
above it: `## Tier 2: Recorder Quality`, `## Tier 3: Performance Optimization`, and
`## Week 1: Core Product Loop`. Both sides are purely additive — origin's new sections belong
BEFORE our `## Completed Prerequisites` heading.

**Files**:
- `MVP-FINAL-PUSH.md` — modify

**Steps**:
1. Open `MVP-FINAL-PUSH.md`. Find the conflict zone around line 21 which currently reads:
   ```
   <<<<<<< HEAD
   ## Completed Prerequisites
   =======
   ## Tier 2: Recorder Quality (Post-Prerequisites)

   - [ ] **Test coverage for recorder actors** — Unit tests for FrameAnalyzer bridge recovery, SessionAggregator backoff, WorkQueue fairness
   - [ ] **`recorder status` improvements** — Show bridge state (ready/dead/restarting), backoff intervals, failure counts
   - [ ] **Frame cleanup job** — Delete JPEG files for frames older than 7 days (currently frames accumulate forever)

   ## Tier 3: Performance Optimization

   - [ ] **VLM idle unload** — Unload model from GPU memory after N minutes of inactivity, reload on next frame batch
   - [ ] **Adaptive batch sizing** — Increase batch size when queue is deep, decrease when shallow

   ## Week 1: Core Product Loop
   >>>>>>> origin
   ```
2. Replace the entire conflict zone (from `<<<<<<< HEAD` through `>>>>>>> origin` inclusive) with
   origin's three sections followed immediately by our heading:
   ```
   ## Tier 2: Recorder Quality (Post-Prerequisites)

   - [ ] **Test coverage for recorder actors** — Unit tests for FrameAnalyzer bridge recovery, SessionAggregator backoff, WorkQueue fairness
   - [ ] **`recorder status` improvements** — Show bridge state (ready/dead/restarting), backoff intervals, failure counts
   - [ ] **Frame cleanup job** — Delete JPEG files for frames older than 7 days (currently frames accumulate forever)

   ## Tier 3: Performance Optimization

   - [ ] **VLM idle unload** — Unload model from GPU memory after N minutes of inactivity, reload on next frame batch
   - [ ] **Adaptive batch sizing** — Increase batch size when queue is deep, decrease when shallow

   ## Week 1: Core Product Loop

   ## Completed Prerequisites
   ```
3. Leave all other lines unchanged. The `- [x] Merge PR #53...` bullet points that follow will
   now appear under `## Completed Prerequisites`, which is correct.

**Verification**: `! grep -q "^<<<<<<< " MVP-FINAL-PUSH.md`

**Rollback**:
- `git checkout -- MVP-FINAL-PUSH.md`

---

### WU-3: Resolve apps/recorder/README.md merge conflict

**Dependencies**: none

**Context**: `apps/recorder/README.md` has two conflict zones. Zone 1 (lines 29-48): our branch
lists four bullets (MenuBarController, MigrationRunner, PythonSetup, WorkQueue); origin replaces
only the WorkQueue bullet with an InferenceQueue bullet. Resolution: keep all four bullets, adopt
origin's InferenceQueue description for the fourth one. Zone 2 (lines 77-105): the file-reference
table has two sub-conflicts — resolve by using origin's InferenceQueue wording for `main.swift`,
keeping our three new rows, using origin's InferenceWorker description, removing the deleted
TextGenerationService row, and keeping our Logger description.

**Files**:
- `apps/recorder/README.md` — modify

**Steps**:
1. Open `apps/recorder/README.md`. Find Zone 1 at lines 29-48 (between the last numbered item
   and the `- **3 SQLite connections**` bullet):
   ```
   <<<<<<< HEAD
   - **`MenuBarController`** — NSStatusItem with live stats (frames, topic blocks, RAM), pause/resume
     capture, and Start at Login toggle via SMAppService.

   - **`MigrationRunner`** — Swift-native DB migrations (replicates Node.js migrate.ts), runs on
     startup to ensure schema is up to date.

   - **`PythonSetup`** — Zero-config Python venv setup. Auto-creates `~/.escribano/venv` and installs
     `mlx-vlm` on first launch.

   - **1 shared `WorkQueue`** (actor) — Serializes all bridge calls between `FrameAnalyzer` and
     `SessionAggregator`. Because VLM frame inference and LLM text generation share the same Python
     socket, all requests are queued through this actor with a priority mechanism to prevent
     starvation.
   =======
   - **1 shared `InferenceQueue`** (actor) — Owns the Python bridge worker lifecycle and serializes
     all inference calls. Checks worker health before each job via `ping()`, restarts dead workers
     with exponential backoff, and acts as circuit breaker (stops after 5 consecutive failures).
     Priority scheduling with fairness prevents starvation.
   >>>>>>> origin
   ```
   Replace with all four bullets, origin's InferenceQueue description for the last:
   ```
   - **`MenuBarController`** — NSStatusItem with live stats (frames, topic blocks, RAM), pause/resume
     capture, and Start at Login toggle via SMAppService.

   - **`MigrationRunner`** — Swift-native DB migrations (replicates Node.js migrate.ts), runs on
     startup to ensure schema is up to date.

   - **`PythonSetup`** — Zero-config Python venv setup. Auto-creates `~/.escribano/venv` and installs
     `mlx-vlm` on first launch.

   - **1 shared `InferenceQueue`** (actor) — Owns the Python bridge worker lifecycle and serializes
     all inference calls. Checks worker health before each job via `ping()`, restarts dead workers
     with exponential backoff, and acts as circuit breaker (stops after 5 consecutive failures).
     Priority scheduling with fairness prevents starvation.
   ```

2. Find Zone 2, sub-conflict A at lines 77-84 (the first rows of the file-reference table):
   ```
   <<<<<<< HEAD
   | `main.swift` | NSApplication delegate; wires up 3 tasks, 1 WorkQueue, and 3 SQLite connections |
   | `MenuBarController.swift` | NSStatusItem menu bar UI with live stats, pause/resume, Start at Login |
   | `MigrationRunner.swift` | DB schema migration runner (Swift-native, replicates Node.js migrate.ts) |
   | `PythonSetup.swift` | Python venv auto-setup at `~/.escribano/venv` with `mlx-vlm` installation |
   =======
   | `main.swift` | NSApplication delegate; wires up 3 tasks, 1 InferenceQueue, and 3 SQLite connections |
   >>>>>>> origin
   ```
   Replace with origin's `main.swift` description plus all three of our new rows:
   ```
   | `main.swift` | NSApplication delegate; wires up 3 tasks, 1 InferenceQueue, and 3 SQLite connections |
   | `MenuBarController.swift` | NSStatusItem menu bar UI with live stats, pause/resume, Start at Login |
   | `MigrationRunner.swift` | DB schema migration runner (Swift-native, replicates Node.js migrate.ts) |
   | `PythonSetup.swift` | Python venv auto-setup at `~/.escribano/venv` with `mlx-vlm` installation |
   ```

3. Find Zone 2, sub-conflict B at lines 98-105 (near the bottom of the table):
   ```
   <<<<<<< HEAD
   | `VLMInferenceService.port.swift` | Protocol for VLM frame inference |
   | `TextGenerationService.port.swift` | Protocol for text generation |
   | `Logger.swift` | Global `log()` function (timestamps to stdout + log file) |
   =======
   | `VLMInferenceService.port.swift` | `InferenceWorker` protocol: unified VLM + text generation port |
   | `Logger.swift` | Global `log()` function (writes to stdout) |
   >>>>>>> origin
   ```
   Replace with origin's InferenceWorker description, no TextGenerationService row (it was deleted
   in origin/main), and our Logger description:
   ```
   | `VLMInferenceService.port.swift` | `InferenceWorker` protocol: unified VLM + text generation port |
   | `Logger.swift` | Global `log()` function (timestamps to stdout + log file) |
   ```

**Verification**: `! grep -q "^<<<<<<< " apps/recorder/README.md`

**Rollback**:
- `git checkout -- apps/recorder/README.md`

---

### WU-4: Resolve PythonBridge.vlm.adapter.swift merge conflict

**Dependencies**: none

**Context**: `apps/recorder/Sources/PythonBridge.vlm.adapter.swift` has one conflict zone at
lines 46-61. Our branch had `isStarted: Bool` and `internal nonisolated(unsafe) var storedPID: Int32`.
`origin/main` rewrote these as `_isReady: Bool`, `pidLock = OSAllocatedUnfairLock(initialState: Int32(0))`,
and `var isReady: Bool { _isReady }`. The rest of the 525-line file is ALREADY origin's version —
our bundle path addition in `init()` (lines 80-86), `pidLock` usage, `_isReady` usage throughout
are all already present. Resolution: take origin's 7 lines entirely for the conflict zone.

**Files**:
- `apps/recorder/Sources/PythonBridge.vlm.adapter.swift` — modify

**Steps**:
1. Open `apps/recorder/Sources/PythonBridge.vlm.adapter.swift`. Find the conflict zone at lines
   46-61 which looks like this:
   ```
       private var requestId: Int = 0
   <<<<<<< HEAD
       private var isStarted: Bool = false
       /// PID stored nonisolated so applicationWillTerminate can kill the bridge
       /// synchronously without an async context. nonisolated(unsafe) is safe here
       /// because storedPID is only written once (in start()) before any concurrent
       /// reads, and reads in terminateSync() are always after that write.
       internal nonisolated(unsafe) var storedPID: Int32 = 0
   =======
       private var _isReady: Bool = false
       /// PID stored behind a lock so terminateSync() can read it safely from any thread.
       private let pidLock = OSAllocatedUnfairLock(initialState: Int32(0))

       var isReady: Bool {
           _isReady
       }
   >>>>>>> origin

       // MARK: - Init
   ```
2. Remove the conflict markers and our 6 lines. Keep origin's 7 lines. The result must be:
   ```swift
       private var requestId: Int = 0
       private var _isReady: Bool = false
       /// PID stored behind a lock so terminateSync() can read it safely from any thread.
       private let pidLock = OSAllocatedUnfairLock(initialState: Int32(0))

       var isReady: Bool {
           _isReady
       }

       // MARK: - Init
   ```
3. Do not change any other line in the file.

**Verification**: `! grep -q "^<<<<<<< " apps/recorder/Sources/PythonBridge.vlm.adapter.swift`

**Rollback**:
- `git checkout -- apps/recorder/Sources/PythonBridge.vlm.adapter.swift`

---

### WU-5: Resolve main.swift merge conflict

**Dependencies**: none

**Context**: `apps/recorder/Sources/main.swift` has one conflict zone at lines 303-354. Our branch
wired the menu bar (setStatus, onPauseResume, startStatsTimer) using a stale `vlmAdapter` variable
that does not exist in scope — after the refactor the bridge is encapsulated inside `InferenceQueue`.
`origin/main` added sleep/wake hooks via NSWorkspace notifications. Both blocks belong in the final
file. The stale `{ [vlmAdapter] in vlmAdapter?.storedPID ?? 0 }` becomes `{ Int32(0) }` as a
placeholder — WU-7 replaces it with `{ worker.bridgePID }` once that property exists. Additionally,
two SIGTERM/SIGINT `print()` calls at lines 40 and 46 must be changed to `log()`.

**Files**:
- `apps/recorder/Sources/main.swift` — modify

**Steps**:
1. Fix line 40 (inside the SIGTERM signal handler): change `print(` to `log(`:
   ```swift
   // BEFORE:
               print("[escribano-recorder] SIGTERM — shutting down")
   // AFTER:
               log("[escribano-recorder] SIGTERM — shutting down")
   ```
2. Fix line 46 (inside the SIGINT signal handler): change `print(` to `log(`:
   ```swift
   // BEFORE:
               print("[escribano-recorder] SIGINT — shutting down")
   // AFTER:
               log("[escribano-recorder] SIGINT — shutting down")
   ```
3. Find the conflict zone at lines 303-354. It begins with `<<<<<<< HEAD` and ends with
   `>>>>>>> origin`. Replace the entire zone (including the markers) with BOTH blocks in order —
   our menu bar block first, then origin's sleep/wake block — fixing the stale capture:
   ```swift
           // Step 4h — Wire menu bar
           menuBar.setStatus(.running)

           menuBar.onPauseResume = { [weak self] shouldPause in
               guard let self = self else { return }
               if shouldPause {
                   self.captures.forEach { $0.pause() }
               } else {
                   self.captures.forEach { $0.resume() }
               }
           }

           // bridgePID placeholder — WU-7 replaces { Int32(0) } with { worker.bridgePID }
           menuBar.startStatsTimer(
               frameStore: store,
               tbStore: tbStore,
               displayCount: captures.count,
               bridgePID: { Int32(0) }
           )

           // Sleep/wake hooks — pause capture during sleep, reset backoff on wake.
           // Only install in daemon mode (not dev mode) since dev users restart manually.
           let isDevMode = ProcessInfo.processInfo.environment["ESCRIBANO_DEV_MODE"] != nil
               || isatty(STDIN_FILENO) != 0

           if !isDevMode {
               let ws = NSWorkspace.shared.notificationCenter
               ws.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: .main) { [weak self] _ in
                   Task { @MainActor in
                       guard let self else { return }
                       log("[escribano-recorder] System will sleep — pausing capture")
                       self.captures.forEach { $0.pause() }
                   }
               }
               ws.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
                   Task { @MainActor in
                       guard let self else { return }
                       log("[escribano-recorder] System woke — resuming capture and resetting backoff")
                       self.captures.forEach { $0.resume() }
                       await self.analyzer?.resetBackoff()
                       await self.aggregator?.resetBackoff()
                   }
               }
               log("[escribano-recorder] Sleep/wake hooks installed (daemon mode)")
           } else {
               log("[escribano-recorder] Dev mode detected — sleep/wake hooks disabled")
           }
   ```
4. Verify no `<<<<<<< HEAD` markers remain anywhere in the file.

**Verification**: `! grep -q "^<<<<<<< " apps/recorder/Sources/main.swift`

**Rollback**:
- `git checkout -- apps/recorder/Sources/main.swift`

---

### WU-6: Commit the merge

**Dependencies**: WU-1, WU-2, WU-3, WU-4, WU-5

**Context**: After all five conflict files are resolved, the `git merge origin/main` must be
completed with a merge commit. This WU stages all five resolved files and runs `git commit --no-edit`
which uses the auto-generated merge commit message. No source file edits — pure git operations.
After this WU succeeds, Phase 3 WUs can apply clean changes on the fully-merged codebase.

**Files**: none (git operations only)

**Steps**:
1. Stage all five resolved conflict files:
   ```bash
   git add MVP-FINAL-PUSH.md \
       apps/recorder/README.md \
       apps/recorder/Sources/Logger.swift \
       apps/recorder/Sources/PythonBridge.vlm.adapter.swift \
       apps/recorder/Sources/main.swift
   ```
2. Verify no unmerged paths remain (output must be empty):
   ```bash
   git diff --name-only --diff-filter=U
   ```
3. Complete the merge:
   ```bash
   git commit --no-edit
   ```
4. Confirm the merge commit was created:
   ```bash
   git log --oneline -1
   ```

**Verification**: `git diff --name-only --diff-filter=U | wc -l | tr -d ' ' | grep -q "^0$"`

**Rollback**:
- If still mid-merge: `git merge --abort`
- If merge commit was created: `git reset --hard HEAD~1`

---

### WU-7: Add bridgePID property and wire menu bar stats

**Dependencies**: WU-6

**Context**: The menu bar stats timer calls `startStatsTimer(bridgePID:)` with a
`@Sendable () -> Int32` closure to get the Python bridge PID for RAM tracking. After the
origin/main inference-queue refactor, `InferenceQueue` holds workers as `[any InferenceWorker]`
(private). Routing PID through the queue would require adding process-management concerns to the
`InferenceWorker` protocol — a leaky abstraction. The clean solution: `main.swift` is the *owner*
(not a caller) and already creates the concrete `PythonBridgeVLMAdapter` instance before passing
it to `InferenceQueue`. It can retain that reference purely for stats. We add a
`nonisolated var bridgePID: Int32` to the adapter that reads through the existing `pidLock`
without requiring actor context. The `{ Int32(0) }` placeholder from WU-5 becomes `{ worker.bridgePID }`.

**Files**:
- `apps/recorder/Sources/PythonBridge.vlm.adapter.swift` — modify
- `apps/recorder/Sources/main.swift` — modify

**Steps**:
1. Open `apps/recorder/Sources/PythonBridge.vlm.adapter.swift`. Find the `isReady` computed
   property (around lines 58-60 after WU-4 resolved the conflict):
   ```swift
       var isReady: Bool {
           _isReady
       }
   ```
   Insert the new property immediately AFTER the closing brace of `isReady`:
   ```swift
       var isReady: Bool {
           _isReady
       }

       /// PID of the underlying Python process, readable from any thread without actor context.
       /// Returns 0 if the bridge has not been started or has been stopped.
       nonisolated var bridgePID: Int32 { pidLock.withLock { $0 } }
   ```

2. Open `apps/recorder/Sources/main.swift`. Find the startStatsTimer call with the WU-5
   placeholder comment:
   ```swift
           // bridgePID placeholder — WU-7 replaces { Int32(0) } with { worker.bridgePID }
           menuBar.startStatsTimer(
               frameStore: store,
               tbStore: tbStore,
               displayCount: captures.count,
               bridgePID: { Int32(0) }
           )
   ```
   Replace with (drop the comment, use the real closure):
   ```swift
           menuBar.startStatsTimer(
               frameStore: store,
               tbStore: tbStore,
               displayCount: captures.count,
               bridgePID: { worker.bridgePID }
           )
   ```
   Note: `worker` is declared earlier in the same `bootstrap()` function as
   `let worker = PythonBridgeVLMAdapter()` and is in scope at this call site. The closure is
   `@Sendable`-safe: `PythonBridgeVLMAdapter` is an actor (Sendable) and `bridgePID` is
   `nonisolated` so it can be called without the actor's executor.

**Verification**: `swift build -c release --package-path apps/recorder 2>&1 | grep -q "Build complete"`

**Rollback**:
- `git checkout -- apps/recorder/Sources/PythonBridge.vlm.adapter.swift apps/recorder/Sources/main.swift`

---

### WU-8: Promote errors and lifecycle events to log() in StreamCapture and Backpressure

**Dependencies**: WU-6

**Context**: When the `.app` bundle runs, stdout is not captured — there is no `launchctl`
redirecting it to a file. Only calls to `log()` reach `~/.escribano/logs/recorder.log`.
`StreamCapture.swift` and `Backpressure.swift` currently use raw `print()` for errors and state
transitions which silently disappear in production. High-frequency debug/verbose calls stay as
`print()` — they are too noisy for the log file. Rule: errors + meaningful lifecycle transitions
(start/stop/pause/resume, watermark crossings) go to `log()`; pHash per-frame debug and
rolling stats stay as `print()`.

**Files**:
- `apps/recorder/Sources/StreamCapture.swift` — modify
- `apps/recorder/Sources/Backpressure.swift` — modify

**Steps**:
1. In `apps/recorder/Sources/StreamCapture.swift`, change `print(` to `log(` for exactly these
   7 call sites (match by message prefix, not line number — line numbers may shift):

   | Message prefix | Action |
   |---|---|
   | `[StreamCapture] Started —` | `print` → `log` |
   | `[StreamCapture] Stopped.` | `print` → `log` |
   | `[StreamCapture] Paused.` | `print` → `log` |
   | `[StreamCapture] Resumed.` | `print` → `log` |
   | `[StreamCapture] Filesystem error:` | `print` → `log` |
   | `[StreamCapture] Store insert failed:` | `print` → `log` |
   | `[StreamCapture] Stream error:` | `print` → `log` |

   Leave ALL of the following as `print()` — do not touch them:
   - `[pHash] Verbose logging ENABLED` (debug-gated)
   - `[pHash] KEEP frame=` (per-frame hot path)
   - `[pHash] Stats:` (rolling stats every 100 frames)
   - `[StreamCapture] \(frameCounter) frames stored in DB` (milestone count, not an error)

2. In `apps/recorder/Sources/Backpressure.swift`, change `print(` to `log(` for exactly these
   2 call sites:

   | Message prefix | Action |
   |---|---|
   | `[Backpressure] High-water reached` | `print` → `log` |
   | `[Backpressure] Low-water reached` | `print` → `log` |

   Leave this as `print()`:
   - `[Backpressure] Checked, \(pending) pending frames.` — called every 10 frames, pure noise.

**Verification**: `swift build -c release --package-path apps/recorder 2>&1 | grep -q "Build complete"`

**Rollback**:
- `git checkout -- apps/recorder/Sources/StreamCapture.swift apps/recorder/Sources/Backpressure.swift`

---

### WU-9: Final commit and build verification

**Dependencies**: WU-7, WU-8

**Context**: WU-7 and WU-8 made clean post-merge source changes. These should be in a separate
commit from the merge commit (WU-6) so git history stays readable: one merge commit, one feature
commit. This WU verifies the build, stages the four changed files, and commits.

**Files**: none (git operations only)

**Steps**:
1. Verify the build passes before committing:
   ```bash
   swift build -c release --package-path apps/recorder 2>&1 | tail -3
   ```
   Must include "Build complete!". Stop and report if it fails.
2. Stage the four source files changed by WU-7 and WU-8:
   ```bash
   git add apps/recorder/Sources/PythonBridge.vlm.adapter.swift \
       apps/recorder/Sources/main.swift \
       apps/recorder/Sources/StreamCapture.swift \
       apps/recorder/Sources/Backpressure.swift
   ```
3. Commit with this message:
   ```
   git commit -m "feat(recorder): wire bridge PID for menu bar RAM stats, fix logging to file

   - Add nonisolated var bridgePID to PythonBridgeVLMAdapter (reads pidLock)
   - Keep worker reference in main.swift alongside InferenceQueue for stats only
   - Replace { Int32(0) } placeholder with { worker.bridgePID } in startStatsTimer
   - Promote StreamCapture/Backpressure errors and lifecycle events to log()
   - High-frequency pHash debug lines remain as print() (too noisy for log file)
   - Fix SIGTERM/SIGINT handlers to use log() so shutdown is recorded to file"
   ```
4. Confirm both commits exist: `git log --oneline -2`

**Verification**: `swift build -c release --package-path apps/recorder 2>&1 | grep -q "Build complete"`

**Rollback**:
- `git reset HEAD~1` (undoes commit, keeps changes staged)

---

## Execution Plan

### Phase 1 — Parallel (no dependencies)

- WU-1: Resolve `Logger.swift` conflict
- WU-2: Resolve `MVP-FINAL-PUSH.md` conflict
- WU-3: Resolve `apps/recorder/README.md` conflict
- WU-4: Resolve `PythonBridge.vlm.adapter.swift` conflict
- WU-5: Resolve `main.swift` conflict + fix SIGTERM/SIGINT print→log

### Phase 2 — Sequential (requires Phase 1)

- WU-6: Complete the merge commit (`git add` all 5 files, `git commit --no-edit`)

### Phase 3 — Parallel (requires Phase 2)

- WU-7: Add `nonisolated var bridgePID` + wire `worker.bridgePID` in main.swift
- WU-8: Promote errors/lifecycle to `log()` in StreamCapture + Backpressure

### Phase 4 — Sequential (requires Phase 3)

- WU-9: Build verification + final commit

## Recovery Strategy

- **Automatic**: Each implementor rolls back and retries once on failure.
- **Merge abort**: If any Phase 1 WU fails and WU-6 has not run, abort with `git merge --abort`.
- **Post-merge rollback**: If WU-6 succeeds but a later WU fails, use `git revert HEAD --no-edit`
  rather than a hard reset (the merge commit may already be in the remote PR).
- **Independent failures**: WU-1 through WU-5 are fully independent. WU-7 and WU-8 are independent.
- **Stale plan warning**: The PENDING APPROVAL plan `2026-03-31-capture-quality-guards.md` also
  touches `main.swift` and `StreamCapture.swift`. It MUST be applied after this plan completes —
  executing it before would re-introduce conflicts on the same files.
