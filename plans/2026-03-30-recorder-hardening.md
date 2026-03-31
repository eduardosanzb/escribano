# Implementation Plan: Recorder Hardening — Bridge Crash Recovery & Exponential Backoff

**Date**: 2026-03-30 **Status**: COMPLETED

## Overview

Add crash recovery to the Python VLM bridge so the recorder self-heals instead of entering silent failure mode, and add exponential backoff to polling loops plus sleep/wake hooks to reduce unnecessary CPU usage during idle periods. These two improvements make the always-on recorder production-ready.

## Scope

- Work units: 8
- Execution phases: 5
- Files affected:
  - `apps/recorder/Sources/PythonBridge.vlm.adapter.swift`
  - `apps/recorder/Sources/VLMInferenceService.port.swift`
  - `apps/recorder/Sources/TextGenerationService.port.swift`
  - `apps/recorder/Sources/FrameStore.port.swift`
  - `apps/recorder/Sources/FrameStore.sqlite.adapter.swift`
  - `apps/recorder/Sources/FrameAnalyzer.swift`
  - `apps/recorder/Sources/SessionAggregator.swift`
  - `apps/recorder/Sources/StreamCapture.swift`
  - `apps/recorder/Sources/main.swift`
  - `BACKLOG.md`
  - `MVP-FINAL-PUSH.md`

## Work Units

### WU-1: Add BridgeState and restart() to PythonBridgeVLMAdapter

**Dependencies**: none

**Context**: The Python bridge (`PythonBridge.vlm.adapter.swift`) currently uses a boolean `isStarted` flag. When the bridge dies, `sendAndReceive()` detects it via empty `availableData` and throws `PythonBridgeError.bridgeDied`, but there's no recovery mechanism. We need a state machine and an idempotent restart method with exponential backoff so callers can trigger recovery.

**Files**:
- `apps/recorder/Sources/PythonBridge.vlm.adapter.swift` — modify

**Steps**:
1. Add a `BridgeState` enum at the top of the file (inside the actor or just above it), with cases: `.idle`, `.starting`, `.ready`, `.dead`, `.restarting`. Make it `Sendable`.

2. Replace the `private var isStarted: Bool = false` (line 45) with `private var state: BridgeState = .idle`.

3. Add a private property `private var restartContinuations: [CheckedContinuation<Void, Error>] = []` to collect callers waiting for an in-progress restart to complete.

4. In `start()` (line 101), replace `guard !isStarted else { return }` with:
   ```swift
   guard state == .idle || state == .dead else { return }
   state = .starting
   ```
   At the end of `start()` (line 142), replace `isStarted = true` with `state = .ready`.
   If `start()` throws at any point after setting `.starting`, set `state = .dead` in a `catch` block before rethrowing.

5. In `runBatch()` (line 147), replace `guard isStarted else { throw PythonBridgeError.notStarted }` with:
   ```swift
   switch state {
   case .ready: break
   case .dead: throw PythonBridgeError.bridgeDied
   case .restarting:
       try await waitForRestart()
   default:
       throw PythonBridgeError.notStarted
   }
   ```

6. In `generateText()` (line 186), apply the same state check pattern as step 5.

7. In `sendAndReceive()`, in the `readabilityHandler` closure where `data.isEmpty` is detected (line 346-349), the code already calls `continuation.resume(throwing: PythonBridgeError.bridgeDied)`. This is inside a non-isolated GCD closure, so we cannot set actor-isolated `state` here. Instead, add logic at the call sites (`runBatch` and `generateText`): wrap the `try await sendAndReceive()` call in a do/catch, and if the error is `PythonBridgeError.bridgeDied`, set `state = .dead` before rethrowing. Specifically:
   - In `runBatch()`, after line 170: wrap `let (rawText, rawStats) = try await sendAndReceive(request: request)` in a do/catch. On catch of `PythonBridgeError.bridgeDied`, set `state = .dead` and rethrow.
   - In `generateText()`, after line 201: wrap `let (rawText, _) = try await sendAndReceive(request: request)` in a do/catch. On catch of `PythonBridgeError.bridgeDied`, set `state = .dead` and rethrow.

8. In `stop()` (line 205), change `isStarted = false` to `state = .idle`.

9. Add `Process.terminationHandler` in `start()` right after `try proc.run()` and before `process = proc` (around line 136-137). The handler runs on a non-isolated GCD thread, so it cannot set actor state directly. Instead, use `Task { await self.handleBridgeDeath() }` to bounce back to actor isolation:
   ```swift
   proc.terminationHandler = { [weak self] _ in
       Task { await self?.handleBridgeDeath() }
   }
   ```
   Add a private method:
   ```swift
   private func handleBridgeDeath() {
       guard state == .ready || state == .starting else { return }
       log("[PythonBridge] Bridge process terminated unexpectedly")
       state = .dead
   }
   ```

10. Add the `restart()` method (public, fulfills protocol requirement):
    ```swift
    func restart() async throws {
        if state == .restarting {
            try await waitForRestart()
            return
        }
        guard state == .dead || state == .ready else {
            throw PythonBridgeError.notStarted
        }
        state = .restarting
        log("[PythonBridge] Restarting bridge...")
        
        let delays: [Double] = [5, 10, 20, 40, 60]
        var lastError: Error?
        
        for (attempt, delay) in delays.enumerated() {
            await stop()
            do {
                try await start()
                state = .ready
                log("[PythonBridge] Restart succeeded on attempt \(attempt + 1)")
                // Resume any waiters
                let waiters = restartContinuations
                restartContinuations = []
                for waiter in waiters { waiter.resume(returning: ()) }
                return
            } catch {
                lastError = error
                log("[PythonBridge] Restart attempt \(attempt + 1)/\(delays.count) failed: \(error.localizedDescription)")
                if attempt < delays.count - 1 {
                    try? await Task.sleep(for: .seconds(delay))
                }
            }
        }
        
        state = .dead
        let waiters = restartContinuations
        restartContinuations = []
        let err = lastError ?? PythonBridgeError.bridgeDied
        for waiter in waiters { waiter.resume(throwing: err) }
        throw err
    }
    ```
    Note: `start()` needs adjustment — when called from `restart()`, state is `.restarting` not `.idle` or `.dead`. Update the guard in `start()` to: `guard state == .idle || state == .dead || state == .restarting else { return }`. And in `start()`, only set `state = .ready` if the current state is NOT `.restarting` (because `restart()` manages the final state transition). Actually, simpler: have `start()` set `state = .starting` at the beginning and `state = .ready` at the end regardless, and have `restart()` override the state back to `.restarting` after each failed `start()`/`stop()` cycle. Wait — even simpler: modify `start()` to accept the state transitions, and let `restart()` handle the `.restarting` bookkeeping:
    - In `start()`: change guard to `guard state != .ready else { return }`, set `state = .starting` unconditionally.
    - In `start()` success: set `state = .ready` unconditionally.
    - In `restart()`: after each failed `stop()`/`start()` cycle, re-set `state = .restarting` before the next attempt.

11. Add the `waitForRestart()` helper:
    ```swift
    private func waitForRestart() async throws {
        try await withCheckedThrowingContinuation { cont in
            restartContinuations.append(cont)
        }
    }
    ```

12. Add `PythonBridgeError.restartFailed` case:
    ```swift
    case restartFailed(Int)  // number of attempts
    ```
    with description: `"Bridge restart failed after \(n) attempts"`

**Verification**: `swift build -c release 2>&1 | tail -5` (must show "Build complete!" with no errors) run from `apps/recorder/`

**Rollback**:
- Modified files: `git checkout -- apps/recorder/Sources/PythonBridge.vlm.adapter.swift`

---

### WU-2: Add restart() to VLMInferenceService and TextGenerationService protocols

**Dependencies**: none

**Context**: The two port protocols that FrameAnalyzer and SessionAggregator use to communicate with the bridge need a `restart()` method so consumers can trigger bridge recovery. These are simple protocol additions.

**Files**:
- `apps/recorder/Sources/VLMInferenceService.port.swift` — modify
- `apps/recorder/Sources/TextGenerationService.port.swift` — modify

**Steps**:
1. In `VLMInferenceService.port.swift`, add a new method to the protocol (after the `stop()` method, before `terminateSync()`):
   ```swift
   /// Attempt to restart the inference backend after a crash.
   /// Implementations should use exponential backoff internally.
   func restart() async throws
   ```

2. In `TextGenerationService.port.swift`, add a new method to the protocol (after `generateText()`):
   ```swift
   /// Attempt to restart the text generation backend after a crash.
   func restart() async throws
   ```

**Verification**: `swift build -c release 2>&1 | tail -5` run from `apps/recorder/` (Note: this will fail until WU-1 implements the method on PythonBridgeVLMAdapter. Both WU-1 and WU-2 are in Phase 1 and the build verification happens after Phase 1 is complete.)

**Rollback**:
- Modified files: `git checkout -- apps/recorder/Sources/VLMInferenceService.port.swift apps/recorder/Sources/TextGenerationService.port.swift`

---

### WU-3: Add releaseFrames to FrameStore protocol and SQLite adapter

**Dependencies**: none

**Context**: When the bridge crashes mid-batch, FrameAnalyzer currently calls `markFrameFailed()` on each frame, which increments `retry_count`. After 3 bridge crashes, frames are permanently skipped even though they were never actually analyzed. We need a `releaseFrames(ids:)` method that returns frames to the unanalyzed pool without incrementing `retry_count`. The frames are in a "claimed" state (selected by `claimFrames` WHERE analyzed=0) but never got `markFramesAnalyzed` or `markFrameFailed` called on them — they're still `analyzed=0` in the DB, so releasing is actually a no-op for the DB state. However, we want explicit semantics for clarity and future-proofing (if we add a `processing_lock` column later).

**Files**:
- `apps/recorder/Sources/FrameStore.port.swift` — modify
- `apps/recorder/Sources/FrameStore.sqlite.adapter.swift` — modify

**Steps**:
1. In `FrameStore.port.swift`, add after the `markFrameFailed(id:)` method (around line 74):
   ```swift
   /// Release frames back to the unanalyzed pool without incrementing retry_count.
   /// Used when the bridge crashes mid-batch — these frames were never actually analyzed.
   /// Only releases frames still in unanalyzed state (analyzed = 0).
   func releaseFrames(ids: [String]) throws
   ```

2. In `FrameStore.sqlite.adapter.swift`, add the implementation after `markFrameFailed(id:)` (around line 207):
   ```swift
   /// Release frames back to the pool. Since claimFrames doesn't change analyzed state
   /// (frames remain analyzed=0), this is currently a no-op for the DB. But the explicit
   /// method documents intent and future-proofs for a processing_lock column.
   func releaseFrames(ids: [String]) throws {
       // Currently frames remain analyzed=0 after claimFrames, so no DB update needed.
       // This method exists for:
       // 1. Semantic clarity — distinguishes "bridge crashed, retry" from "inference failed, mark bad"
       // 2. Future-proofing — if we add a processing_lock column, this is where we'd clear it
       guard !ids.isEmpty else { return }
       log("[FrameStore] Released \(ids.count) frames back to pool (bridge crash recovery)")
   }
   ```

**Verification**: `swift build -c release 2>&1 | tail -5` run from `apps/recorder/`

**Rollback**:
- Modified files: `git checkout -- apps/recorder/Sources/FrameStore.port.swift apps/recorder/Sources/FrameStore.sqlite.adapter.swift`

---

### WU-4: Add bridge crash recovery to FrameAnalyzer

**Dependencies**: WU-1, WU-2, WU-3

**Context**: FrameAnalyzer's `analyzeLoop()` currently treats all VLM errors the same — it calls `markFrameFailed()` on each frame and continues. When the bridge crashes (`PythonBridgeError.bridgeDied`), this wastes retry_count budget. Instead, on `bridgeDied`, FrameAnalyzer should release the frames back to the pool and attempt to restart the bridge. We also add exponential backoff for the polling loop.

**Files**:
- `apps/recorder/Sources/FrameAnalyzer.swift` — modify

**Steps**:
1. Add new private properties for backoff and bridge failure tracking after the existing `pollInterval` property (line 37):
   ```swift
   private let basePollInterval: Double = 10.0
   private var currentPollInterval: Double = 10.0
   private let maxPollInterval: Double = 120.0
   private var bridgeFailureCount: Int = 0
   private let maxBridgeFailures: Int = 5
   ```
   Remove the existing `private let pollInterval: Double` from the `init` and instead set `self.pollInterval` is no longer needed — we'll use `currentPollInterval` everywhere. Actually, keep `basePollInterval` as a let and use `currentPollInterval` as the mutable version. Remove the line `self.pollInterval = 10.0` from init.

2. Replace the `init` to not set `pollInterval` (since we removed it):
   The current init (line 31-38) is:
   ```swift
   init(frameStore: any FrameStore, obsStore: any ObservationStore, vlmService: any VLMInferenceService, queue: WorkQueue) {
       self.frameStore  = frameStore
       self.obsStore    = obsStore
       self.vlmService  = vlmService
       self.queue       = queue
       self.batchSize   = Int(ProcessInfo.processInfo.environment["ESCRIBANO_ANALYZE_BATCH_SIZE"] ?? "") ?? 5
       self.pollInterval = 10.0
   }
   ```
   Change to:
   ```swift
   init(frameStore: any FrameStore, obsStore: any ObservationStore, vlmService: any VLMInferenceService, queue: WorkQueue) {
       self.frameStore  = frameStore
       self.obsStore    = obsStore
       self.vlmService  = vlmService
       self.queue       = queue
       self.batchSize   = Int(ProcessInfo.processInfo.environment["ESCRIBANO_ANALYZE_BATCH_SIZE"] ?? "") ?? 5
   }
   ```

3. Add a public method for external callers (sleep/wake hooks):
   ```swift
   /// Reset the polling backoff to base interval. Called when the system wakes
   /// from sleep or when the bridge recovers, since new frames are likely incoming.
   func resetBackoff() {
       currentPollInterval = basePollInterval
   }
   ```

4. Rewrite `analyzeLoop()` to distinguish bridge death from other errors and implement backoff. The full replacement for the current `analyzeLoop()` method (lines 51-106):
   ```swift
   /// Main analysis loop. Polls for unanalyzed frames, runs VLM, writes results.
   /// Runs until Task is cancelled (SIGTERM triggers cancellation in main.swift).
   func analyzeLoop() async {
       log("[FrameAnalyzer] Starting analysis loop. Base poll: \(basePollInterval)s, batch: \(batchSize)")
       while !Task.isCancelled {
           do {
               let frames = try frameStore.claimFrames(batchSize: batchSize)
               if frames.isEmpty {
                   // Exponential backoff when idle
                   try await Task.sleep(for: .seconds(currentPollInterval))
                   currentPollInterval = min(currentPollInterval * 2, maxPollInterval)
                   continue
               }
               // Work available — reset backoff
               currentPollInterval = basePollInterval
               
               log("[FrameAnalyzer] Analyzing \(frames.count) frames...")
               let t0 = Date()
               let descriptions: [FrameDescription]
               do {
                   descriptions = try await queue.submit(priority: .realtime) { [vlmService] in
                       try await vlmService.runBatch(frames: frames)
                   }
               } catch let error as PythonBridgeError where error == .bridgeDied {
                   // Bridge crashed — release frames back to pool (don't waste retry budget)
                   try? frameStore.releaseFrames(ids: frames.map { $0.id })
                   log("[FrameAnalyzer] Bridge died — released \(frames.count) frames, attempting restart...")
                   
                   bridgeFailureCount += 1
                   if bridgeFailureCount > maxBridgeFailures {
                       log("[FrameAnalyzer] FATAL: Bridge failed \(bridgeFailureCount) times — stopping analysis loop")
                       log("[FrameAnalyzer] Frames will accumulate; backpressure will eventually pause capture")
                       break
                   }
                   
                   do {
                       try await vlmService.restart()
                       bridgeFailureCount = 0
                       log("[FrameAnalyzer] Bridge restarted successfully — resuming analysis")
                   } catch {
                       log("[FrameAnalyzer] Bridge restart failed: \(error.localizedDescription)")
                       // Sleep before next attempt — let the system recover
                       try? await Task.sleep(for: .seconds(min(Double(bridgeFailureCount) * 10.0, 60.0)))
                   }
                   continue
               } catch {
                   log("[FrameAnalyzer] VLM inference error: \(error.localizedDescription)")
                   for frame in frames {
                       try? frameStore.markFrameFailed(id: frame.id)
                   }
                   continue
               }
               let elapsed = String(format: "%.1f", Date().timeIntervalSince(t0))
               log("[FrameAnalyzer] Batch complete: \(descriptions.count)/\(frames.count) parsed in \(elapsed)s")
               // Only save when all frames were parsed — a partial result means the
               // parser may have silently dropped lines and we can't reliably pair
               // descriptions to frames by position. Retry the whole batch instead.
               guard descriptions.count == frames.count else {
                   log("[FrameAnalyzer] Partial parse (\(descriptions.count)/\(frames.count)) — marking all for retry")
                   for frame in frames {
                       try? frameStore.markFrameFailed(id: frame.id)
                   }
                   continue
               }
               do {
                   try await obsStore.saveObservations(from: frames, descriptions: descriptions)
               } catch {
                   log("[FrameAnalyzer] DB write error: \(error.localizedDescription)")
                   continue
               }
               do {
                   try frameStore.markFramesAnalyzed(ids: frames.map { $0.id })
               } catch {
                   log("[FrameAnalyzer] Failed to mark frames analyzed: \(error.localizedDescription)")
               }
               // Successful batch — reset bridge failure counter
               bridgeFailureCount = 0
           } catch is CancellationError {
               break
           } catch {
               log("[FrameAnalyzer] Unexpected error: \(error.localizedDescription)")
               try? await Task.sleep(for: .seconds(currentPollInterval))
           }
       }
       log("[FrameAnalyzer] Loop exited.")
       await vlmService.stop()
   }
   ```
   
   Note on the `where error == .bridgeDied` pattern: `PythonBridgeError` is an enum, so we need pattern matching. The correct Swift syntax is:
   ```swift
   } catch PythonBridgeError.bridgeDied {
   ```
   Use this instead of `catch let error as PythonBridgeError where error == .bridgeDied`.

5. Replace all remaining `print("[FrameAnalyzer]` with `log("[FrameAnalyzer]` for consistency with the rest of the codebase (the current file uses `print` instead of the global `log()` function). This applies to:
   - Line 41: `print("[FrameAnalyzer] Starting VLM service...")` → `log("[FrameAnalyzer] Starting VLM service...")`
   - Line 47: `print("[FrameAnalyzer] VLM service ready. Batch size: \(batchSize)")` → `log("[FrameAnalyzer] VLM service ready. Batch size: \(batchSize)")`

**Verification**: `swift build -c release 2>&1 | tail -5` run from `apps/recorder/`

**Rollback**:
- Modified files: `git checkout -- apps/recorder/Sources/FrameAnalyzer.swift`

---

### WU-5: Add bridge crash recovery and backoff to SessionAggregator

**Dependencies**: WU-1, WU-2

**Context**: SessionAggregator's `aggregateLoop()` needs two improvements: (1) when `PythonBridgeError.bridgeDied` occurs during `processWindow()`, it should re-wait for bridge readiness (like the startup ping loop) rather than just sleeping for `pollInterval` and retrying; (2) add exponential backoff for the "0 unclaimed observations" case, but keep normal `pollInterval` for the "< minObservations" case (since more may arrive soon).

**Files**:
- `apps/recorder/Sources/SessionAggregator.swift` — modify

**Steps**:
1. Add private backoff properties after the existing config properties (around line 43, after `private let llmBatchSize: Int`):
   ```swift
   // Backoff state for idle polling
   private var currentIdlePollInterval: Double = 120.0  // initialized from pollInterval in init
   private let maxIdlePollInterval: Double = 480.0
   private var bridgeFailureCount: Int = 0
   private let maxBridgeFailures: Int = 5
   ```
   In the init, after `self.llmBatchSize = ...`, add:
   ```swift
   self.currentIdlePollInterval = self.pollInterval
   ```

2. Add a public method for external callers:
   ```swift
   /// Reset the idle polling backoff to base interval.
   func resetBackoff() {
       currentIdlePollInterval = pollInterval
   }
   ```

3. Modify the main aggregation loop (the `while !Task.isCancelled` block starting at line 119). Replace the handling of the three observation count cases:

   **Empty observations case** (lines 123-126): Replace with backoff:
   ```swift
   if observations.isEmpty {
       try await Task.sleep(for: .seconds(currentIdlePollInterval))
       currentIdlePollInterval = min(currentIdlePollInterval * 2, maxIdlePollInterval)
       continue
   }
   ```

   **Below minObservations case** (lines 128-132): Keep normal interval (no backoff):
   ```swift
   if observations.count < minObservations {
       // Edge case: 1-2 observations can sit unclaimed for a long time if no more arrive.
       // This is acceptable — Phase 3b's flush-aggregate step will handle them on demand.
       log("[SessionAggregator] Found \(observations.count) unclaimed (< \(minObservations) min) — waiting")
       try await Task.sleep(for: .seconds(pollInterval))
       continue
   }
   ```

   **Processing case**: After successful processing, reset backoff:
   After `log("[SessionAggregator] Cycle complete: created \(created) TopicBlock(s)")` (line 138), add:
   ```swift
   currentIdlePollInterval = pollInterval  // Reset backoff on successful processing
   ```

4. In the `processWindow` error handling block (lines 143-146), add specific handling for bridge death. Replace:
   ```swift
   } catch {
       log("[SessionAggregator] Error processing observations: \(error.localizedDescription)")
       try await Task.sleep(for: .seconds(pollInterval))
   }
   ```
   With:
   ```swift
   } catch PythonBridgeError.bridgeDied {
       log("[SessionAggregator] Bridge died during aggregation — waiting for recovery...")
       bridgeFailureCount += 1
       if bridgeFailureCount > maxBridgeFailures {
           log("[SessionAggregator] FATAL: Bridge failed \(bridgeFailureCount) times — stopping aggregation loop")
           break
       }
       // Re-enter the bridge readiness wait loop (same as startup).
       // Observations were not consumed (TB save + claim happen after LLM success).
       var readyAttempts = 0
       while !Task.isCancelled {
           readyAttempts += 1
           do {
               _ = try await queue.submit(priority: .normal) { [textService] in
                   try await textService.generateText(prompt: "ping", maxTokens: 1)
               }
               break
           } catch {
               if readyAttempts % 6 == 0 {
                   log("[SessionAggregator] Waiting for bridge recovery... (\(readyAttempts * 5)s elapsed)")
               }
               try? await Task.sleep(for: .seconds(5))
           }
       }
       if !Task.isCancelled {
           bridgeFailureCount = 0
           log("[SessionAggregator] Bridge recovered — resuming aggregation")
       }
   } catch {
       log("[SessionAggregator] Error processing observations: \(error.localizedDescription)")
       try await Task.sleep(for: .seconds(pollInterval))
   }
   ```

**Verification**: `swift build -c release 2>&1 | tail -5` run from `apps/recorder/`

**Rollback**:
- Modified files: `git checkout -- apps/recorder/Sources/SessionAggregator.swift`

---

### WU-6: Optimize StreamCapture DateFormatter allocations

**Dependencies**: none

**Context**: In `StreamCapture.swift`, `processFrame()` creates a new `DateFormatter()` and `ISO8601DateFormatter()` on every single frame (lines 124-125 and 137). DateFormatter is notoriously expensive to create — Apple recommends reusing them. These should be stored properties on the class.

**Files**:
- `apps/recorder/Sources/StreamCapture.swift` — modify

**Steps**:
1. Add two stored properties to the `StreamCapture` class, after the existing stored properties (after line 27, `private var framesSkipped: Int = 0`):
   ```swift
   // Reuse formatters — DateFormatter allocation is expensive (~5ms each)
   private let dayFormatter: DateFormatter = {
       let f = DateFormatter()
       f.dateFormat = "yyyy-MM-dd"
       return f
   }()
   private let isoFormatter = ISO8601DateFormatter()
   ```

2. In `processFrame()`, replace lines 124-126:
   ```swift
   let dateFmt = DateFormatter()
   dateFmt.dateFormat = "yyyy-MM-dd"
   let dayDir  = Self.framesBaseDir.appendingPathComponent(dateFmt.string(from: now))
   ```
   With:
   ```swift
   let dayDir  = Self.framesBaseDir.appendingPathComponent(dayFormatter.string(from: now))
   ```

3. In `processFrame()`, replace lines 137-138:
   ```swift
   let isoFmt = ISO8601DateFormatter()
   let capturedAt = isoFmt.string(from: now)
   ```
   With:
   ```swift
   let capturedAt = isoFormatter.string(from: now)
   ```

**Verification**: `swift build -c release 2>&1 | tail -5` run from `apps/recorder/`

**Rollback**:
- Modified files: `git checkout -- apps/recorder/Sources/StreamCapture.swift`

---

### WU-7: Add sleep/wake hooks in main.swift

**Dependencies**: WU-4, WU-5

**Context**: When the Mac sleeps, the capture streams should pause (saving CPU/disk) and resume on wake. The FrameAnalyzer and SessionAggregator backoff counters should reset on wake since new frames will be coming in. Sleep/wake hooks are only installed when NOT in dev mode (detected via `ESCRIBANO_DEV_MODE` env var or `isatty`), because dev mode users restart manually.

**Files**:
- `apps/recorder/Sources/main.swift` — modify

**Steps**:
1. At the end of the `start()` method, after the backpressure handler setup (after line 217, before the closing `}`), add sleep/wake notification observers:
   ```swift
   // Sleep/wake hooks — pause capture during sleep, reset backoff on wake.
   // Only install in daemon mode (not dev mode) since dev users restart manually.
   let isDevMode = ProcessInfo.processInfo.environment["ESCRIBANO_DEV_MODE"] != nil
       || isatty(STDIN_FILENO) != 0
   
   if !isDevMode {
       let ws = NSWorkspace.shared.notificationCenter
       ws.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: .main) { [weak self] _ in
           log("[escribano-recorder] System will sleep — pausing capture")
           self?.captures.forEach { $0.pause() }
       }
       ws.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
           log("[escribano-recorder] System woke — resuming capture and resetting backoff")
           self?.captures.forEach { $0.resume() }
           // Reset analyzer and aggregator backoff since new frames are incoming
           if let analyzer = self?.analyzer {
               Task { await analyzer.resetBackoff() }
           }
           if let aggregator = self?.aggregator {
               Task { await aggregator.resetBackoff() }
           }
       }
       log("[escribano-recorder] Sleep/wake hooks installed (daemon mode)")
   } else {
       log("[escribano-recorder] Dev mode detected — sleep/wake hooks disabled")
   }
   ```

**Verification**: `swift build -c release 2>&1 | tail -5` run from `apps/recorder/`

**Rollback**:
- Modified files: `git checkout -- apps/recorder/Sources/main.swift`

---

### WU-8: Update BACKLOG.md and MVP-FINAL-PUSH.md

**Dependencies**: WU-4, WU-5, WU-6, WU-7

**Context**: The BACKLOG and sprint plan docs need to reflect that these hardening items are complete, and the next recorder work items (test coverage, VLM idle unload) should be documented.

**Files**:
- `BACKLOG.md` — modify
- `MVP-FINAL-PUSH.md` — modify

**Steps**:
1. In `BACKLOG.md`, find the section `#### Phase 3: Continuous Session Aggregation — ADR-011` and its subsection `##### Phase 3a: SessionAggregator (Swift actor in recorder)`. After the `- **Phase 3a complete (2026-03-27)**` line (which is the last line of Phase 3a), add a new subsection:

   ```markdown
   ##### Recorder Hardening (Bridge Crash Recovery + Backoff)
   - [x] `BridgeState` enum with `.idle/.starting/.ready/.dead/.restarting` — replaces boolean `isStarted`
   - [x] `Process.terminationHandler` for proactive bridge death detection
   - [x] `restart()` with exponential backoff (5s→10s→20s→40s→60s, max 5 attempts), idempotent (concurrent callers coalesce)
   - [x] `releaseFrames(ids:)` on FrameStore — returns frames to pool without wasting retry budget on bridge crashes
   - [x] FrameAnalyzer: distinguishes `bridgeDied` from other errors, releases frames + restarts bridge, stops loop after 5 consecutive failures
   - [x] SessionAggregator: re-enters bridge readiness wait loop on `bridgeDied`, stops after 5 consecutive failures
   - [x] Exponential backoff on empty polling (FrameAnalyzer: 10→120s cap, SessionAggregator: 120→480s cap)
   - [x] Sleep/wake hooks via `NSWorkspace` notifications — pause capture on sleep, resume + reset backoff on wake (daemon mode only)
   - [x] StreamCapture: `DateFormatter` and `ISO8601DateFormatter` moved to stored properties (avoid per-frame allocation)
   - **Recorder hardening complete (2026-03-30)**
   ```

2. In `BACKLOG.md`, in the `## Recently Done` section, under `### 2026-03`, add as the first bullet:
   ```markdown
   - **Recorder hardening complete (2026-03-30)** — Bridge crash recovery with BridgeState machine + exponential backoff restart, frame release on bridge death, exponential backoff polling, sleep/wake hooks, DateFormatter optimization
   ```

3. In `MVP-FINAL-PUSH.md`, after the `## Prerequisites (Day 1)` section and before `## Week 1: Core Product Loop`, add:
   ```markdown
   ## Tier 2: Recorder Quality (Post-Prerequisites)

   - [ ] **Test coverage for recorder actors** — Unit tests for FrameAnalyzer bridge recovery, SessionAggregator backoff, WorkQueue fairness
   - [ ] **`recorder status` improvements** — Show bridge state (ready/dead/restarting), backoff intervals, failure counts
   - [ ] **Frame cleanup job** — Delete JPEG files for frames older than 7 days (currently frames accumulate forever)

   ## Tier 3: Performance Optimization

   - [ ] **VLM idle unload** — Unload model from GPU memory after N minutes of inactivity, reload on next frame batch
   - [ ] **Adaptive batch sizing** — Increase batch size when queue is deep, decrease when shallow
   ```

**Verification**: `test -f BACKLOG.md && test -f MVP-FINAL-PUSH.md && echo "Files exist"` (basic sanity check — content verification is manual)

**Rollback**:
- Modified files: `git checkout -- BACKLOG.md MVP-FINAL-PUSH.md`

---

## Execution Plan

### Phase 1 — Parallel (no dependencies)

- WU-1: Add BridgeState and restart() to PythonBridgeVLMAdapter
- WU-2: Add restart() to VLMInferenceService and TextGenerationService protocols
- WU-3: Add releaseFrames to FrameStore protocol and SQLite adapter
- WU-6: Optimize StreamCapture DateFormatter allocations

### Phase 2 — Parallel (requires Phase 1)

- WU-4: Add bridge crash recovery to FrameAnalyzer
- WU-5: Add bridge crash recovery and backoff to SessionAggregator

### Phase 3 — Parallel (requires Phase 2)

- WU-7: Add sleep/wake hooks in main.swift

### Phase 4 — Sequential (requires Phase 3)

- WU-8: Update BACKLOG.md and MVP-FINAL-PUSH.md

### Phase 5 — Final build verification

- Full `swift build -c release` from `apps/recorder/`

## Recovery Strategy

- **Automatic**: Each implementor rolls back and retries once on failure.
- **Dependency failure**: If a work unit fails and later units depend on it, those later units will not run. The orchestrator will report which units were skipped.
- **Global rollback**: `git checkout -- apps/recorder/Sources/ BACKLOG.md MVP-FINAL-PUSH.md` to revert all changes.
- **Independent failures**: Work units with no dependency on a failed unit will still execute. WU-6 (StreamCapture optimization) is fully independent of the bridge recovery work.
