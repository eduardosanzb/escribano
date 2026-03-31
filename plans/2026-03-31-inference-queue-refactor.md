# Implementation Plan: InferenceQueue Refactor

**Date**: 2026-03-31  **Status**: COMPLETED

## Overview

Replace the complex 5-state `BridgeState` machine in `PythonBridgeVLMAdapter` with a simpler architecture where a new `InferenceQueue` owns the bridge lifecycle. Both `FrameAnalyzer` and `SessionAggregator` lose all bridge awareness — they only interact with the queue. Add a `ping` method to the Python bridge for zero-cost health checks, fix off-by-one bugs in failure counting, and protect `storedPID` with an `OSAllocatedUnfairLock`.

## Scope

- Work units: 8
- Execution phases: 5
- Files affected:
  - `apps/recorder/Sources/VLMInferenceService.port.swift` → replaced by `InferenceWorker` protocol
  - `apps/recorder/Sources/TextGenerationService.port.swift` → deleted (merged into `InferenceWorker`)
  - `apps/recorder/Sources/PythonBridge.vlm.adapter.swift` → simplified to implement `InferenceWorker`
  - `apps/recorder/Sources/WorkQueue.swift` → replaced by `InferenceQueue`
  - `apps/recorder/Sources/FrameAnalyzer.swift` → remove bridge references, depend only on `InferenceQueue`
  - `apps/recorder/Sources/SessionAggregator.swift` → remove bridge references, depend only on `InferenceQueue`
  - `apps/recorder/Sources/main.swift` → rewire: create worker → queue → callers, simplify shutdown
  - `scripts/mlx_bridge.py` → add `ping` method handler
  - `apps/recorder/README.md` → update architecture docs

## Work Units

### WU-1: Create InferenceWorker protocol (replaces VLMInferenceService + TextGenerationService)

**Dependencies**: none

**Context**: Currently the recorder has two separate port protocols — `VLMInferenceService` (frame analysis) and `TextGenerationService` (text generation). Both are implemented by the same `PythonBridgeVLMAdapter`. The new design merges them into a single `InferenceWorker` protocol. The protocol also adds a `ping()` method for zero-cost health checks and an `isReady` property. The old `restart()` method is removed — the queue owns restart logic now.

**Files**:
- `apps/recorder/Sources/VLMInferenceService.port.swift` — rewrite entirely (keep filename for git history)
- `apps/recorder/Sources/TextGenerationService.port.swift` — delete

**Steps**:
1. Replace the entire contents of `apps/recorder/Sources/VLMInferenceService.port.swift` with the new `InferenceWorker` protocol. The file currently contains:
   ```swift
   protocol VLMInferenceService: AnyObject, Sendable {
       func start() async throws
       func analyzeFrames(frames: [DbFrame]) async throws -> [FrameDescription]
       func stop() async
       func restart() async throws
       nonisolated func terminateSync()
   }
   ```
   Replace with:
   ```swift
   import Foundation
   // MARK: - InferenceWorker (Port)
   //
   // Unified port for VLM frame inference + text generation.
   //
   // Previously split across VLMInferenceService and TextGenerationService,
   // merged because the same physical backend (Python bridge) handles both.
   // The InferenceQueue owns worker lifecycle (start/stop/restart).
   // Callers (FrameAnalyzer, SessionAggregator) never see this protocol —
   // they only interact with InferenceQueue.
   //
   // Design: dumb process wrapper. isReady/start()/stop()/ping() for lifecycle,
   // analyzeFrames()/generateText() for inference. No restart logic, no state machine.
   protocol InferenceWorker: AnyObject, Sendable {
       /// Whether the worker is ready to accept inference requests.
       var isReady: Bool { get async }
       /// Start the inference backend (spawn process, connect socket, load model).
       /// Called by InferenceQueue. Idempotent — safe to call when already started.
       func start() async throws
       /// Gracefully shut down the inference backend.
       /// Called by InferenceQueue on restart or shutdown.
       func stop() async
       /// Zero-cost health check. Returns true if the backend is responsive.
       /// Used by InferenceQueue to verify worker health before dispatching jobs.
       func ping() async throws -> Bool
       /// Synchronously terminate the underlying process.
       /// For use in applicationWillTerminate where async context is unavailable.
       nonisolated func terminateSync()
       /// Run VLM inference on a batch of frames.
       func analyzeFrames(frames: [DbFrame]) async throws -> [FrameDescription]
       /// Generate text from a prompt using the loaded model.
       func generateText(prompt: String, maxTokens: Int) async throws -> String
   }
   ```

2. Delete the file `apps/recorder/Sources/TextGenerationService.port.swift` entirely.

**Verification**: `swift build --package-path apps/recorder 2>&1 | head -1` — Expected: build will fail with errors about missing `VLMInferenceService`, `TextGenerationService`, and missing `InferenceWorker` conformance. This is correct at this stage — downstream work units fix these references. To verify just the protocol file syntax: `swift -parse apps/recorder/Sources/VLMInferenceService.port.swift` should succeed (no syntax errors).

**Rollback**:
- Modified files: `git checkout -- apps/recorder/Sources/VLMInferenceService.port.swift`
- Deleted files: `git checkout -- apps/recorder/Sources/TextGenerationService.port.swift`

---

### WU-2: Simplify PythonBridgeVLMAdapter to implement InferenceWorker

**Dependencies**: WU-1

**Context**: The current `PythonBridgeVLMAdapter` is a 554-line actor with a 5-state `BridgeState` machine (`idle/starting/ready/dead/restarting`), `restart()` with exponential backoff, `waitForRestart()` continuations, and `handleBridgeDeath()`. All of this complexity is being moved to the `InferenceQueue`. The adapter becomes a dumb process wrapper: it knows how to start/stop/ping/analyzeFrames/generateText, but never restarts itself. The `BridgeState` enum, `restartContinuations`, `restart()`, `waitForRestart()`, and `handleBridgeDeath()` are all removed. The `storedPID` gets protected with `OSAllocatedUnfairLock`. A new `ping()` method sends a lightweight `{"method":"ping"}` request to the bridge and returns `true` if it gets `{"pong":true}` back. The `PythonBridgeError.restartFailed` case (dead code) is removed.

**Files**:
- `apps/recorder/Sources/PythonBridge.vlm.adapter.swift` — major rewrite

**Steps**:
1. Replace the `BridgeState` enum (lines 7-13) and the adapter's protocol conformance. The file currently starts with:
   ```swift
   enum BridgeState: Sendable {
       case idle
       case starting
       case ready
       case dead
       case restarting
   }
   actor PythonBridgeVLMAdapter: VLMInferenceService, TextGenerationService {
   ```
   Remove the `BridgeState` enum entirely. Change the conformance to:
   ```swift
   actor PythonBridgeVLMAdapter: InferenceWorker {
   ```

2. Replace the mutable state section (lines 53-62). Currently:
   ```swift
   private var process: Process?
   private var fileHandle: FileHandle?
   private var requestId: Int = 0
   private var state: BridgeState = .idle
   private var restartContinuations: [CheckedContinuation<Void, Error>] = []
   private nonisolated(unsafe) var storedPID: Int32 = 0
   ```
   Replace with:
   ```swift
   private var process: Process?
   private var fileHandle: FileHandle?
   private var requestId: Int = 0
   private var _isReady: Bool = false
   /// PID protected by an unfair lock for safe access from the nonisolated terminateSync().
   private let pidLock = OSAllocatedUnfairLock(initialState: Int32(0))
   ```

3. Add the `isReady` computed property right after the mutable state:
   ```swift
   var isReady: Bool {
       _isReady
   }
   ```

4. Rewrite `start()` (lines 113-165). Remove the `guard state != .ready` / `state = .starting` / `state = .dead` state machine logic. Replace with:
   ```swift
   func start() async throws {
       guard !_isReady else { return }
       do {
           log("[PythonBridge] Starting mlx_bridge.py (VLM mode)...")
           log("[PythonBridge] Python: \(pythonPath)")
           log("[PythonBridge] Bridge: \(bridgePath)")
           log("[PythonBridge] Model: \(modelId)")
           log("[PythonBridge] Max tokens: \(maxTokens)")
           if FileManager.default.fileExists(atPath: socketPath) {
               try? FileManager.default.removeItem(atPath: socketPath)
           }
           let proc = Process()
           proc.executableURL = URL(fileURLWithPath: pythonPath)
           proc.arguments = [bridgePath, "--mode", "vlm"]
           proc.environment = buildEnv()
           let stdoutPipe = Pipe()
           proc.standardOutput = stdoutPipe
           let logDir = FileManager.default.homeDirectoryForCurrentUser
               .appendingPathComponent(".escribano/logs")
           try? FileManager.default.createDirectory(at: logDir, withIntermediateDirectories: true)
           let logURL = logDir.appendingPathComponent("mlx-bridge-recorder-vlm.log")
           let stdoutLogURL = logDir.appendingPathComponent("mlx-bridge-recorder-vlm-stdout.log")
           try? FileManager.default.removeItem(at: logURL)
           try? FileManager.default.removeItem(at: stdoutLogURL)
           FileManager.default.createFile(atPath: logURL.path, contents: nil)
           FileManager.default.createFile(atPath: stdoutLogURL.path, contents: nil)
           let stderrLogHandle = try? FileHandle(forWritingTo: logURL)
           let stdoutLogHandle = try? FileHandle(forWritingTo: stdoutLogURL)
           let stderrPipe = Pipe()
           proc.standardError = stderrPipe
           stderrPipe.fileHandleForReading.readabilityHandler = { handle in
               let data = handle.availableData
               guard !data.isEmpty else { return }
               FileHandle.standardError.write(data)
               stderrLogHandle?.write(data)
           }
           try proc.run()
           process = proc
           pidLock.withLock { $0 = proc.processIdentifier }
           log("[PythonBridge] Python PID: \(proc.processIdentifier)")
           try await waitForReady(stdout: stdoutPipe, logHandle: stdoutLogHandle)
           try connectSocket()
           _isReady = true
           log("[PythonBridge] Ready. Socket connected at \(socketPath)")
       } catch {
           _isReady = false
           throw error
       }
   }
   ```
   Note: The `terminationHandler` is intentionally removed. The queue now detects bridge death via failed `ping()` calls — this eliminates the stale-handler bug where a handler from a previous process corrupts state during restart.

5. Simplify `analyzeFrames()` (lines 167-216). Replace the state switch at the top:
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
   With a simple guard:
   ```swift
   guard _isReady else { throw PythonBridgeError.notStarted }
   ```

6. Simplify `generateText()` (lines 218-247). Replace the state switch at the top with:
   ```swift
   guard _isReady else { throw PythonBridgeError.notStarted }
   ```

7. Rewrite `stop()` (lines 249-257):
   ```swift
   func stop() async {
       log("[PythonBridge] Shutting down...")
       _isReady = false
       fileHandle?.closeFile()
       fileHandle = nil
       if let proc = process {
           proc.terminate()
           proc.waitUntilExit()
       }
       process = nil
       pidLock.withLock { $0 = 0 }
       try? FileManager.default.removeItem(atPath: socketPath)
   }
   ```

8. Rewrite `terminateSync()` (lines 261-266) to use the lock:
   ```swift
   nonisolated func terminateSync() {
       let pid = pidLock.withLock { $0 }
       guard pid > 0 else { return }
       kill(pid, SIGTERM)
       log("[PythonBridge] terminateSync: sent SIGTERM to PID \(pid)")
   }
   ```

9. Add the `ping()` method — insert after `terminateSync()` and before `buildEnv()`:
   ```swift
   func ping() async throws -> Bool {
       guard _isReady else { return false }
       requestId += 1
       let request: [String: Any] = [
           "id": requestId,
           "method": "ping",
       ]
       let (text, _) = try await sendAndReceive(request: request)
       // Bridge responds with {"pong": true, "done": true}
       // sendAndReceive returns the "text" field, but ping has no text.
       // Success means the socket round-trip worked — bridge is alive.
       return true
   }
   ```

10. Remove these methods entirely:
    - `handleBridgeDeath()` (lines 269-273)
    - `restart()` (lines 277-318)
    - `waitForRestart()` (lines 321-325)

11. In the `PythonBridgeError` enum (lines 499-519), remove the `restartFailed` case:
    ```swift
    case restartFailed(Int) // number of attempts
    ```
    And its corresponding errorDescription case:
    ```swift
    case let .restartFailed(n): return "Bridge restart failed after \(n) attempts"
    ```

12. In `sendAndReceive()`, the existing code at line 450 detects bridge death when `data.isEmpty`:
    ```swift
    if data.isEmpty {
        guard resumed.trySet() else { return }
        handle.readabilityHandler = nil
        continuation.resume(throwing: PythonBridgeError.bridgeDied)
        return
    }
    ```
    After this block, also set `_isReady = false`. But since `sendAndReceive` is called from within the actor, and the readabilityHandler runs on a GCD queue, we cannot directly set `_isReady` from there. Instead, keep the existing behavior — throw `.bridgeDied`. The caller (InferenceQueue) will handle marking the worker as unhealthy. However, add a `handleBridgeDeath()` that the `sendAndReceive` catch site can call:

    Actually, keep it simple: the `sendAndReceive` throws `.bridgeDied`, and the existing catch blocks in `analyzeFrames()` and `generateText()` already re-throw it. Add a one-liner to set `_isReady = false` when bridgeDied is caught in those methods. In `analyzeFrames()`, after the `sendAndReceive` call, the existing code:
    ```swift
    } catch PythonBridgeError.bridgeDied {
        state = .dead
        throw PythonBridgeError.bridgeDied
    }
    ```
    Change to:
    ```swift
    } catch PythonBridgeError.bridgeDied {
        _isReady = false
        throw PythonBridgeError.bridgeDied
    }
    ```
    Same for `generateText()`.

**Verification**: `swift build --package-path apps/recorder 2>&1 | head -1` — Expected: build will fail because `FrameAnalyzer`, `SessionAggregator`, and `main.swift` still reference old types. The adapter itself should be syntactically valid. To verify just the adapter: `swift -parse apps/recorder/Sources/PythonBridge.vlm.adapter.swift` should succeed.

**Rollback**:
- Modified files: `git checkout -- apps/recorder/Sources/PythonBridge.vlm.adapter.swift`

---

### WU-3: Create InferenceQueue (replaces WorkQueue)

**Dependencies**: WU-1

**Context**: The current `WorkQueue` is a generic priority work queue that serializes access to a shared resource. The new `InferenceQueue` extends this by owning the `InferenceWorker` lifecycle: it checks worker health before each job via `ping()`, restarts dead workers with exponential backoff, and acts as a circuit breaker (stops after N failures). The priority/fairness scheduling from `WorkQueue` is preserved. The key insight: making the queue the bridge owner eliminates the coordination layer that caused all the bugs in the original `BridgeState` machine.

**Files**:
- `apps/recorder/Sources/WorkQueue.swift` — rewrite entirely (keep filename for git diff clarity, rename internal type)

**Steps**:
1. Replace the entire contents of `apps/recorder/Sources/WorkQueue.swift`. The current file is 208 lines implementing `actor WorkQueue` with `Priority`, `Entry`, `submit()`, `cancelAll()`, `processLoop()`, `pickNext()`. Replace with the new `InferenceQueue` actor that:

   a. Keeps the same `Priority` enum (`.realtime`, `.normal`, `.low`) and `Entry` struct.
   b. Keeps the same `submit()` API signature.
   c. Keeps the same fairness scheduling (`pickNext()` with `maxRealtimeStreak`).
   d. Adds worker ownership: stores `workers: [any InferenceWorker]` (currently always 1 worker, but array for future multi-backend).
   e. Adds health checking: before executing each job, call `worker.ping()`. If ping fails, attempt restart.
   f. Adds restart with exponential backoff: delays `[5, 10, 20, 40, 60]` seconds, max 5 attempts.
   g. Adds circuit breaker: after `maxRestartAttempts` consecutive failures, stops dispatching and logs FATAL.
   h. Exposes `startWorkers()` for initial startup and `stopWorkers()` for shutdown.
   i. Exposes `nonisolated func terminateWorkersSync()` for `applicationWillTerminate`.

   Here is the complete replacement:
   ```swift
   import Foundation

   /// Inference queue that owns worker lifecycle and serializes all inference calls.
   ///
   /// Replaces WorkQueue by adding:
   ///   - Worker health checking (ping before each job)
   ///   - Automatic restart with exponential backoff on worker death
   ///   - Circuit breaker (stops after maxRestartAttempts consecutive failures)
   ///
   /// Scheduling/fairness is preserved from the original WorkQueue:
   ///   - One job runs at a time (matches physical constraint: one bridge process)
   ///   - Priority ordering: .realtime > .normal > .low
   ///   - Fairness: after maxRealtimeStreak consecutive realtime jobs, one non-realtime
   ///     job is allowed through before realtime resumes
   actor InferenceQueue {

       // MARK: - Priority

       enum Priority: Int, Comparable, Sendable {
           case realtime = 0   // FrameAnalyzer VLM inference
           case normal   = 1   // SessionAggregator text generation
           case low      = 2   // Future: embeddings, cleanup, etc.

           static func < (lhs: Self, rhs: Self) -> Bool {
               lhs.rawValue < rhs.rawValue
           }
       }

       // MARK: - Internal Types

       private struct Entry {
           let priority: Priority
           let sequence: UInt64
           let work: @Sendable () async -> Void
           let cancel: @Sendable () -> Void
       }

       // MARK: - State

       private var queue: [Entry] = []
       private var nextSequence: UInt64 = 0
       private var isProcessing = false
       private var realtimeStreak = 0
       private var lastLoggedBucket: Int = -1
       private let maxRealtimeStreak: Int

       // MARK: - Worker Management

       private let workers: [any InferenceWorker]
       private var workerFailureCount: Int = 0
       private let maxRestartAttempts: Int
       private var circuitOpen: Bool = false
       private let restartDelays: [Double] = [5, 10, 20, 40, 60]

       // MARK: - Init

       init(workers: [any InferenceWorker], maxRealtimeStreak: Int = 10, maxRestartAttempts: Int = 5) {
           self.workers = workers
           self.maxRealtimeStreak = maxRealtimeStreak
           self.maxRestartAttempts = maxRestartAttempts
       }

       // MARK: - Worker Lifecycle

       /// Start all workers. Called once at startup from main.swift.
       func startWorkers() async throws {
           for worker in workers {
               try await worker.start()
           }
           log("[InferenceQueue] All workers started (\(workers.count))")
       }

       /// Stop all workers gracefully. Called during shutdown.
       func stopWorkers() async {
           for worker in workers {
               await worker.stop()
           }
           log("[InferenceQueue] All workers stopped")
       }

       /// Synchronously terminate all worker processes.
       /// For use in applicationWillTerminate where async context is unavailable.
       nonisolated func terminateWorkersSync() {
           for worker in workers {
               worker.terminateSync()
           }
       }

       // MARK: - Public API

       /// Submit work to the queue. Suspends the caller until the work completes.
       func submit<T: Sendable>(
           priority: Priority,
           _ operation: @Sendable @escaping () async throws -> T
       ) async throws -> T {
           try Task.checkCancellation()

           if circuitOpen {
               throw PythonBridgeError.bridgeDied
           }

           let entryId = nextSequence + 1

           return try await withTaskCancellationHandler {
               try await withCheckedThrowingContinuation { cont in
                   nextSequence += 1
                   let entry = Entry(
                       priority: priority,
                       sequence: nextSequence,
                       work: {
                           do {
                               let result = try await operation()
                               cont.resume(returning: result)
                           } catch {
                               cont.resume(throwing: error)
                           }
                       },
                       cancel: {
                           cont.resume(throwing: CancellationError())
                       }
                   )
                   queue.append(entry)
                   logQueueIfNeeded()
                   if !isProcessing {
                       isProcessing = true
                       Task { await self.processLoop() }
                   }
               }
           } onCancel: {
               Task { await self.removeEntry(id: entryId) }
           }
       }

       // MARK: - Processing Loop

       private func removeEntry(id: UInt64) {
           if let idx = queue.firstIndex(where: { $0.sequence == id }) {
               let entry = queue.remove(at: idx)
               entry.cancel()
               logQueueIfNeeded()
           }
       }

       func cancelAll() {
           let pending = queue
           queue.removeAll()
           for entry in pending {
               entry.cancel()
           }
           if !pending.isEmpty {
               log("[InferenceQueue] Cancelled \(pending.count) pending entries during shutdown")
           }
       }

       private func processLoop() async {
           while let entry = pickNext() {
               // Health check: verify worker is alive before running the job
               await ensureWorkerHealthy()
               if circuitOpen {
                   // Worker is dead and unrecoverable — cancel this and remaining entries
                   entry.cancel()
                   cancelAll()
                   break
               }
               await entry.work()
           }
           isProcessing = false
       }

       /// Check worker health and attempt restart if needed.
       private func ensureWorkerHealthy() async {
           guard let worker = workers.first else { return }

           // Fast path: worker reports ready
           let ready = await worker.isReady
           if ready {
               // Verify with a ping to catch zombie processes
               do {
                   _ = try await worker.ping()
                   workerFailureCount = 0
                   return
               } catch {
                   log("[InferenceQueue] Ping failed despite isReady=true: \(error.localizedDescription)")
               }
           }

           // Worker is down — attempt restart with backoff
           log("[InferenceQueue] Worker not healthy — attempting restart...")
           for (attempt, delay) in restartDelays.enumerated() {
               workerFailureCount += 1
               if workerFailureCount >= maxRestartAttempts {
                   log("[InferenceQueue] FATAL: Worker failed \(workerFailureCount) times — circuit open, stopping all inference")
                   circuitOpen = true
                   return
               }
               await worker.stop()
               do {
                   try await worker.start()
                   log("[InferenceQueue] Worker restarted on attempt \(attempt + 1)")
                   workerFailureCount = 0
                   return
               } catch {
                   log("[InferenceQueue] Restart attempt \(attempt + 1)/\(restartDelays.count) failed: \(error.localizedDescription)")
                   if attempt < restartDelays.count - 1 {
                       try? await Task.sleep(for: .seconds(delay))
                   }
               }
           }
           log("[InferenceQueue] FATAL: All restart attempts exhausted — circuit open")
           circuitOpen = true
       }

       // MARK: - Scheduling (preserved from WorkQueue)

       private func pickNext() -> Entry? {
           guard !queue.isEmpty else { return nil }

           let hasRealtime = queue.contains { $0.priority == .realtime }
           let hasNonRealtime = queue.contains { $0.priority != .realtime }

           let idx: Int

           if realtimeStreak >= maxRealtimeStreak && hasNonRealtime {
               realtimeStreak = 0
               idx = queue.enumerated()
                   .filter { $0.element.priority != .realtime }
                   .min(by: Self.entryOrder)!.offset
           } else if hasRealtime {
               realtimeStreak += 1
               idx = queue.enumerated()
                   .filter { $0.element.priority == .realtime }
                   .min(by: Self.entryOrder)!.offset
           } else {
               realtimeStreak = 0
               idx = queue.enumerated()
                   .min(by: Self.entryOrder)!.offset
           }

           let entry = queue.remove(at: idx)
           logQueueIfNeeded()
           return entry
       }

       private static func entryOrder(
           _ a: (offset: Int, element: Entry),
           _ b: (offset: Int, element: Entry)
       ) -> Bool {
           if a.element.priority != b.element.priority {
               return a.element.priority < b.element.priority
           }
           return a.element.sequence < b.element.sequence
       }

       private func logQueueIfNeeded() {
           let size = queue.count
           let bucket: Int
           if size == 0 {
               bucket = 0
           } else {
               let pct = maxRealtimeStreak > 0 ? (size * 100) / maxRealtimeStreak : 100
               switch pct {
               case 0..<25:   bucket = 1
               case 25..<50:  bucket = 2
               case 50..<75:  bucket = 3
               case 75...100: bucket = 4
               default:       bucket = 5
               }
           }
           guard bucket != lastLoggedBucket else { return }
           lastLoggedBucket = bucket
           let realtimeCount = queue.filter { $0.priority == .realtime }.count
           let normalCount   = queue.filter { $0.priority == .normal }.count
           let pct = maxRealtimeStreak > 0 ? (size * 100) / maxRealtimeStreak : 0
           log("[InferenceQueue] size=\(size)/\(maxRealtimeStreak) (\(pct)%) realtime=\(realtimeCount) normal=\(normalCount) streak=\(realtimeStreak)")
       }
   }
   ```

**Verification**: `swift build --package-path apps/recorder 2>&1 | head -1` — Expected: build will fail because other files still reference `WorkQueue`. The `InferenceQueue` itself should compile cleanly if `InferenceWorker` protocol exists (from WU-1).

**Rollback**:
- Modified files: `git checkout -- apps/recorder/Sources/WorkQueue.swift`

---

### WU-4: Add ping handler to Python bridge

**Dependencies**: none

**Context**: The Python bridge (`scripts/mlx_bridge.py`) is shared between the TypeScript batch pipeline and Swift recorder. It handles requests via a `handle_request()` function that dispatches on the `method` field. Currently, `SessionAggregator` wastes VLM inference on health checks by calling `generateText(prompt: "ping", maxTokens: 1)` which runs actual model inference. A dedicated `ping` method returns `{"pong": true, "done": true}` with zero inference cost. This benefits both the Swift recorder (InferenceQueue health checks) and potentially the TypeScript batch pipeline.

**Files**:
- `scripts/mlx_bridge.py` — add ping handler in `handle_request()`

**Steps**:
1. In the `handle_request` function, after the mode validation blocks (lines 446-466) and before the first method check (`if method == "vlm_infer":` at line 468), add a ping handler:

   After the block ending at line 466:
   ```python
           return
   ```
   
   And before line 468:
   ```python
           if method == "vlm_infer":
   ```

   Insert:
   ```python
        if method == "ping":
            send_response(conn, {"id": request_id, "pong": True, "text": "", "done": True})
            return

   ```
   
   This must go BEFORE the `vlm_infer` check. The `text` field is included because `sendAndReceive` in the Swift adapter extracts `json["text"]` from the response (the `done: true` block at line 470-488 of the adapter). Including `"text": ""` ensures the Swift side doesn't get a nil text field.

**Verification**: `python3 -c "import ast; ast.parse(open('scripts/mlx_bridge.py').read()); print('OK')"` — should print "OK" (no syntax errors).

**Rollback**:
- Modified files: `git checkout -- scripts/mlx_bridge.py`

---

### WU-5: Simplify FrameAnalyzer — remove bridge awareness

**Dependencies**: WU-1, WU-3

**Context**: `FrameAnalyzer` currently depends on `VLMInferenceService`, `WorkQueue`, and contains bridge-specific error handling (catching `PythonBridgeError.bridgeDied`, calling `vlmService.restart()`, counting `bridgeFailureCount`, stopping after 5 failures). With the `InferenceQueue` owning worker lifecycle, the analyzer becomes purely a "poll frames → submit to queue → write results" loop. It no longer needs to know about bridge restarts or failures — the queue handles all of that. The analyzer also has an off-by-one bug: `bridgeFailureCount > maxBridgeFailures` should be `>=` (e.g., with max=5, it allows 6 failures before stopping). This is fixed by removing the entire mechanism.

**Files**:
- `apps/recorder/Sources/FrameAnalyzer.swift` — major simplification

**Steps**:
1. Replace the entire file with the simplified version. The current file is 152 lines. Key changes:
   - Remove `vlmService` dependency, replace `queue: WorkQueue` with `queue: InferenceQueue`
   - Remove `bridgeFailureCount`, `maxBridgeFailures`
   - Remove `start()` method (queue owns worker startup)
   - Remove the `PythonBridgeError.bridgeDied` catch block with restart logic
   - Remove `await vlmService.stop()` at the end (queue owns worker shutdown)
   - Keep: `frameStore`, `obsStore`, `batchSize`, polling backoff, `resetBackoff()`
   - The `submit` call closure no longer captures `vlmService` — it captures the queue and the queue dispatches to the worker internally. Actually, the caller still needs to pass the operation. The queue's submit takes a closure. The closure needs to call `worker.analyzeFrames()`. But callers don't have worker references... 
   
   **Resolution**: The InferenceQueue needs convenience methods. Add two methods to InferenceQueue:
   - `func analyzeFrames(frames: [DbFrame]) async throws -> [FrameDescription]` — submits with `.realtime` priority
   - `func generateText(prompt: String, maxTokens: Int) async throws -> String` — submits with `.normal` priority
   
   These are thin wrappers that call `submit(priority:) { worker.analyzeFrames/generateText }` internally. Callers never see the worker.

   **Wait — this changes the InferenceQueue from WU-3.** To keep WU-3 and WU-5 independent-ish, we'll add these convenience methods in this WU to the InferenceQueue file, alongside the FrameAnalyzer changes. This means WU-5 touches 2 files.

   Here is the complete replacement for `FrameAnalyzer.swift`:
   ```swift
   import Foundation
   // MARK: - FrameAnalyzerError
   enum FrameAnalyzerError: Error, LocalizedError {
       case startFailed(String)
       var errorDescription: String? {
           switch self {
           case .startFailed(let m): return "Inference queue start failed: \(m)"
           }
       }
   }
   // MARK: - FrameAnalyzer
   //
   // Actor that drives the continuous VLM analysis loop.
   //
   // Bridge-unaware: submits work to InferenceQueue, which owns the worker
   // lifecycle (health checks, restart, circuit breaker). If the queue's
   // circuit breaker opens, submit() throws .bridgeDied and the loop exits.
   actor FrameAnalyzer {
       private let frameStore: any FrameStore
       private let obsStore:   any ObservationStore
       private let queue:      InferenceQueue
       private let batchSize:    Int
       private let basePollInterval: Double = 10.0
       private var currentPollInterval: Double = 10.0
       private let maxPollInterval: Double = 120.0

       init(frameStore: any FrameStore, obsStore: any ObservationStore, queue: InferenceQueue) {
           self.frameStore  = frameStore
           self.obsStore    = obsStore
           self.queue       = queue
           self.batchSize   = Int(ProcessInfo.processInfo.environment["ESCRIBANO_ANALYZE_BATCH_SIZE"] ?? "") ?? 5
       }

       /// Reset the polling backoff to base interval. Called on system wake.
       func resetBackoff() {
           currentPollInterval = basePollInterval
       }

       /// Main analysis loop. Polls for unanalyzed frames, runs VLM, writes results.
       /// Runs until Task is cancelled or the inference queue's circuit breaker opens.
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
                       descriptions = try await queue.analyzeFrames(frames: frames)
                   } catch PythonBridgeError.bridgeDied {
                       // Queue's circuit breaker is open — release frames and exit
                       try? frameStore.releaseFrames(ids: frames.map { $0.id })
                       log("[FrameAnalyzer] Inference queue circuit open — released \(frames.count) frames, stopping")
                       log("[FrameAnalyzer] Frames will accumulate; backpressure will eventually pause capture")
                       break
                   } catch {
                       log("[FrameAnalyzer] VLM inference error: \(error.localizedDescription)")
                       for frame in frames {
                           do {
                               try frameStore.markFrameFailed(id: frame.id)
                           } catch {
                               log("[FrameAnalyzer] Failed to mark frame \(frame.id) as failed: \(error.localizedDescription)")
                           }
                       }
                       continue
                   }
                   let elapsed = String(format: "%.1f", Date().timeIntervalSince(t0))
                   log("[FrameAnalyzer] Batch complete: \(descriptions.count)/\(frames.count) parsed in \(elapsed)s")
                   guard descriptions.count == frames.count else {
                       log("[FrameAnalyzer] Partial parse (\(descriptions.count)/\(frames.count)) — marking all for retry")
                       for frame in frames {
                           do {
                               try frameStore.markFrameFailed(id: frame.id)
                           } catch {
                               log("[FrameAnalyzer] Failed to mark frame \(frame.id) as failed: \(error.localizedDescription)")
                           }
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
               } catch is CancellationError {
                   break
               } catch {
                   log("[FrameAnalyzer] Unexpected error: \(error.localizedDescription)")
                   try? await Task.sleep(for: .seconds(currentPollInterval))
               }
           }
           log("[FrameAnalyzer] Loop exited.")
       }
   }
   ```

2. Add convenience methods to `apps/recorder/Sources/WorkQueue.swift` (the InferenceQueue file from WU-3). Insert these methods in the `// MARK: - Public API` section, after the `submit()` method:

   ```swift
       /// Convenience: run VLM frame analysis through the queue at realtime priority.
       func analyzeFrames(frames: [DbFrame]) async throws -> [FrameDescription] {
           try await submit(priority: .realtime) { [workers] in
               guard let worker = workers.first else {
                   throw PythonBridgeError.notStarted
               }
               return try await worker.analyzeFrames(frames: frames)
           }
       }

       /// Convenience: run text generation through the queue at normal priority.
       func generateText(prompt: String, maxTokens: Int = 2000) async throws -> String {
           try await submit(priority: .normal) { [workers] in
               guard let worker = workers.first else {
                   throw PythonBridgeError.notStarted
               }
               return try await worker.generateText(prompt: prompt, maxTokens: maxTokens)
           }
       }
   ```

**Verification**: `swift build --package-path apps/recorder 2>&1 | grep -c "error:"` — Expected: errors will come only from `SessionAggregator.swift` and `main.swift` (not yet updated). `FrameAnalyzer.swift` should compile cleanly.

**Rollback**:
- Modified files: `git checkout -- apps/recorder/Sources/FrameAnalyzer.swift apps/recorder/Sources/WorkQueue.swift`

---

### WU-6: Simplify SessionAggregator — remove bridge awareness

**Dependencies**: WU-1, WU-3, WU-5 (needs convenience methods on InferenceQueue)

**Context**: `SessionAggregator` currently depends on `TextGenerationService`, `WorkQueue`, and has its own bridge-awareness: a startup ping loop that wastes VLM inference (`generateText(prompt: "ping", maxTokens: 1)`), a `bridgeDied` catch block that re-enters the ping loop, and `bridgeFailureCount`/`maxBridgeFailures`. All of this is removed. The aggregator simply calls `queue.generateText()` — if the queue's circuit breaker is open, it throws `.bridgeDied` and the loop exits. The startup ping loop is replaced by a simple `queue.ping()` call. The off-by-one bug (`bridgeFailureCount > maxBridgeFailures` should be `>=`) is fixed by removing the entire mechanism.

**Files**:
- `apps/recorder/Sources/SessionAggregator.swift` — major simplification

**Steps**:
1. Replace the entire file. Key changes from the current 505-line file:
   - Replace `textService: any TextGenerationService` with nothing (removed dependency)
   - Replace `queue: WorkQueue` with `queue: InferenceQueue`
   - Remove `bridgeFailureCount`, `maxBridgeFailures`
   - Replace the startup ping loop (lines 104-123) with a single `await queue.waitForReady()`... but InferenceQueue doesn't have that. Instead, use a simple loop calling `queue.ping()`:
     ```swift
     while !Task.isCancelled {
         do {
             try await queue.ping()
             break
         } catch {
             try? await Task.sleep(for: .seconds(5))
         }
     }
     ```
     Wait — InferenceQueue needs a `ping()` method too. Add it as a convenience method (similar to analyzeFrames/generateText). This will be added in this WU to the InferenceQueue file.
   - Replace the `processWindow` text_infer calls: `queue.submit(priority: .normal) { [textService] in try await textService.generateText(...) }` → `queue.generateText(prompt: prompt, maxTokens: 4000)`
   - Remove the `PythonBridgeError.bridgeDied` catch block with the recovery ping loop (lines 160-187)
   - Replace with a simple: if `.bridgeDied`, log and break

   Here is the complete replacement for `SessionAggregator.swift`:
   ```swift
   import Foundation

   // Debug flag for SessionAggregator verbose logging (includes LLM responses)
   private let debugSA = ProcessInfo.processInfo.environment["ESCRIBANO_DEBUG_SA"] == "1"

   // MARK: - SessionAggregatorError

   enum SessionAggregatorError: Error, LocalizedError {
       case textGenerationFailed(String)
       case noGroupsParsed

       var errorDescription: String? {
           switch self {
           case .textGenerationFailed(let m): return "Text generation failed: \(m)"
           case .noGroupsParsed:              return "No groups parsed from LLM response"
           }
       }
   }

   // MARK: - SessionAggregator

   /// Actor that periodically groups unclaimed observations into TopicBlocks.
   ///
   /// Bridge-unaware: submits text generation work to InferenceQueue, which owns
   /// the worker lifecycle (health checks, restart, circuit breaker).
   actor SessionAggregator {

       private let obsStore: any ObservationStore
       private let tbStore: any TopicBlockStore
       private let queue: InferenceQueue

       // Configuration
       private let minObservations: Int
       private let pollInterval: Double
       private let maxObsPerCycle: Int
       private let llmBatchSize: Int

       // Backoff state for idle polling
       private var currentIdlePollInterval: Double = 120.0
       private let maxIdlePollInterval: Double = 480.0

       // Sentinel recording ID for recorder-generated TopicBlocks
       private let recorderRecordingId = "__recorder__"

       init(
           obsStore: any ObservationStore,
           tbStore: any TopicBlockStore,
           queue: InferenceQueue
       ) {
           self.obsStore = obsStore
           self.tbStore = tbStore
           self.queue = queue

           let rawMinObs = Int(ProcessInfo.processInfo.environment["ESCRIBANO_TB_MIN_OBSERVATIONS"] ?? "") ?? 3
           self.minObservations = max(1, rawMinObs)
           if self.minObservations != rawMinObs {
               log("[SessionAggregator] WARN: ESCRIBANO_TB_MIN_OBSERVATIONS clamped from \(rawMinObs) to \(self.minObservations)")
           }

           let rawPollInterval = Double(ProcessInfo.processInfo.environment["ESCRIBANO_TB_POLL_INTERVAL"] ?? "") ?? 120.0
           self.pollInterval = max(1.0, rawPollInterval)
           if self.pollInterval != rawPollInterval {
               log("[SessionAggregator] WARN: ESCRIBANO_TB_POLL_INTERVAL clamped from \(rawPollInterval) to \(self.pollInterval)")
           }

           let rawMaxObs = Int(ProcessInfo.processInfo.environment["ESCRIBANO_TB_MAX_OBS_PER_CYCLE"] ?? "") ?? 300
           self.maxObsPerCycle = max(1, rawMaxObs)
           if self.maxObsPerCycle != rawMaxObs {
               log("[SessionAggregator] WARN: ESCRIBANO_TB_MAX_OBS_PER_CYCLE clamped from \(rawMaxObs) to \(self.maxObsPerCycle)")
           }

           let rawLlmBatch = Int(ProcessInfo.processInfo.environment["ESCRIBANO_TB_LLM_BATCH_SIZE"] ?? "") ?? 50
           self.llmBatchSize = max(1, rawLlmBatch)
           if self.llmBatchSize != rawLlmBatch {
               log("[SessionAggregator] WARN: ESCRIBANO_TB_LLM_BATCH_SIZE clamped from \(rawLlmBatch) to \(self.llmBatchSize)")
           }

           self.currentIdlePollInterval = self.pollInterval
       }

       /// Reset the idle polling backoff to base interval.
       func resetBackoff() {
           currentIdlePollInterval = pollInterval
       }

       /// Main aggregation loop. Runs until Task is cancelled or circuit breaker opens.
       func aggregateLoop() async {
           log("[SessionAggregator] Starting. MinObs=\(minObservations) IdlePoll=\(Int(pollInterval))s MaxObs=\(maxObsPerCycle) LLMBatch=\(llmBatchSize)")

           // Wait for inference queue to be ready (workers started by main.swift)
           var readyAttempts = 0
           while !Task.isCancelled {
               readyAttempts += 1
               do {
                   try await queue.ping()
                   break
               } catch {
                   if readyAttempts % 6 == 0 {
                       log("[SessionAggregator] Waiting for inference queue... (\(readyAttempts * 5)s elapsed)")
                   }
                   try? await Task.sleep(for: .seconds(5))
               }
           }

           guard !Task.isCancelled else {
               log("[SessionAggregator] Cancelled while waiting for inference queue.")
               return
           }

           log("[SessionAggregator] Inference queue ready, beginning aggregation")

           while !Task.isCancelled {
               do {
                   let observations = try await obsStore.fetchUnclaimed(limit: maxObsPerCycle)

                   if observations.isEmpty {
                       try await Task.sleep(for: .seconds(currentIdlePollInterval))
                       currentIdlePollInterval = min(currentIdlePollInterval * 2, maxIdlePollInterval)
                       continue
                   }

                   if observations.count < minObservations {
                       log("[SessionAggregator] Found \(observations.count) unclaimed (< \(minObservations) min) — waiting")
                       try await Task.sleep(for: .seconds(pollInterval))
                       continue
                   }

                   log("[SessionAggregator] Found \(observations.count) unclaimed observations — processing")
                   do {
                       let created = try await processWindow(observations)
                       if created > 0 {
                           log("[SessionAggregator] Cycle complete: created \(created) TopicBlock(s)")
                           currentIdlePollInterval = pollInterval
                       } else {
                           log("[SessionAggregator] No TBs created — waiting for more observations")
                           try await Task.sleep(for: .seconds(pollInterval))
                       }
                   } catch PythonBridgeError.bridgeDied {
                       log("[SessionAggregator] Inference queue circuit open — stopping aggregation loop")
                       break
                   } catch {
                       log("[SessionAggregator] Error processing observations: \(error.localizedDescription)")
                       try await Task.sleep(for: .seconds(pollInterval))
                   }

               } catch is CancellationError {
                   break
               } catch {
                   log("[SessionAggregator] Unexpected error: \(error.localizedDescription)")
                   try? await Task.sleep(for: .seconds(pollInterval))
               }
           }

           log("[SessionAggregator] Loop exited.")
       }

       // MARK: - Window Processing

       private func processWindow(_ window: [UnclaimedObservation]) async throws -> Int {
           let subBatches = stride(from: 0, to: window.count, by: llmBatchSize).map { start in
               Array(window[start..<min(start + llmBatchSize, window.count)])
           }

           var allGroups: [ParsedGroup] = []

           for (subBatchIdx, subBatch) in subBatches.enumerated() {
               log("[SessionAggregator] Sub-batch \(subBatchIdx + 1)/\(subBatches.count): \(subBatch.count) obs, submitting text_infer...")
               let prompt = buildGroupingPrompt(subBatch)
               let response: String
               do {
                   response = try await queue.generateText(prompt: prompt, maxTokens: 4000)
               } catch {
                   log("[SessionAggregator] text_infer failed for sub-batch: \(error.localizedDescription) — aborting cycle to retry later")
                   throw error
               }
               if debugSA {
                   log("[SessionAggregator] text_infer complete: \(response.count) chars. Preview: \(response.prefix(120).replacingOccurrences(of: "\n", with: " "))")
               } else {
                   log("[SessionAggregator] text_infer complete: \(response.count) chars")
               }
               let parsed = parseGroupingResponse(response, observations: subBatch)
               if parsed.isEmpty {
                   if debugSA {
                       log("[SessionAggregator] WARN: 0 groups parsed from text_infer response. Raw (first 500 chars): \(response.prefix(500).replacingOccurrences(of: "\n", with: "\\n"))")
                   } else {
                       log("[SessionAggregator] WARN: 0 groups parsed from text_infer response (set ESCRIBANO_DEBUG_SA=1 to see raw response)")
                   }
               } else {
                   log("[SessionAggregator] Parsed \(parsed.count) group(s) from sub-batch \(subBatchIdx + 1)")
               }
               allGroups.append(contentsOf: parsed)
           }

           log("[SessionAggregator] Sub-batch loop done: \(allGroups.count) group(s) from \(subBatches.count) batch(es)")

           if allGroups.isEmpty {
               log("[SessionAggregator] No groups parsed across all sub-batches — creating single TB")
               let tb = createTopicBlock(from: window, label: dominantActivity(window))
               try await tbStore.save(tb)
               let claimed = try await obsStore.claimObservations(
                   ids: window.map { $0.id }, tbId: tb.id
               )
               log("[SessionAggregator] Fallback TB \(tb.id): \(claimed)/\(window.count) obs claimed")
               return 1
           }

           var created = 0
           for group in allGroups {
               let groupObs = group.observationIds.compactMap { targetId in
                   window.first { $0.id == targetId }
               }
               log("[SessionAggregator] Group '\(group.label)': \(group.observationIds.count) IDs → \(groupObs.count) matched in window")
               guard !groupObs.isEmpty else { continue }

               let tb = createTopicBlock(from: groupObs, label: group.label)
               do {
                   try await tbStore.save(tb)
                   log("[SessionAggregator] Saved TB \(tb.id) for group '\(group.label)'")
               } catch {
                   log("[SessionAggregator] FAILED to save TB \(tb.id): \(error.localizedDescription)")
                   continue
               }

               let claimed = try await obsStore.claimObservations(
                   ids: groupObs.map { $0.id }, tbId: tb.id
               )

               if claimed > 0 {
                   created += 1
                   log("[SessionAggregator] TB \(tb.id) (\(group.label)): \(claimed)/\(groupObs.count) obs claimed")
               } else {
                   log("[SessionAggregator] Group '\(group.label)': 0 observations claimed (may have been claimed by another process)")
               }
           }

           let claimedIds = Set(allGroups.flatMap { $0.observationIds })
           let unclaimed = window.filter { !claimedIds.contains($0.id) }
           if !unclaimed.isEmpty {
               log("[SessionAggregator] \(unclaimed.count) obs not assigned to any group — creating catch-all TB")
               let tb = createTopicBlock(from: unclaimed, label: dominantActivity(unclaimed))
               try await tbStore.save(tb)
               let claimed = try await obsStore.claimObservations(
                   ids: unclaimed.map { $0.id }, tbId: tb.id
               )
               log("[SessionAggregator] Catch-all TB \(tb.id): \(claimed)/\(unclaimed.count) obs claimed")
               created += 1
           }

           return created
       }

       // MARK: - TopicBlock Construction

       private func createTopicBlock(from observations: [UnclaimedObservation], label: String) -> TopicBlockInsert {
           let id = "tb-\(UUID().uuidString)"
           let fromTs = observations.map { $0.capturedAt }.min() ?? 0
           let toTs = observations.map { $0.capturedAt }.max() ?? 0
           let duration = toTs - fromTs

           var appsSet = Set<String>()
           var topicsSet = Set<String>()
           var activityCounts: [String: Int] = [:]

           for obs in observations {
               for app in obs.apps { appsSet.insert(app) }
               for topic in obs.topics { topicsSet.insert(topic) }
               activityCounts[obs.activityType, default: 0] += 1
           }

           let dominantActivity = activityCounts.max(by: { $0.value < $1.value })?.key ?? "other"

           let descSample: [String]
           if observations.count <= 6 {
               descSample = observations.map { $0.vlmDescription }
           } else {
               descSample = Array(observations.prefix(5).map { $0.vlmDescription })
                   + [observations.last!.vlmDescription]
           }
           let keyDescription = descSample.joined(separator: "; ")

           let classification: [String: Any] = [
               "activity_type": dominantActivity,
               "key_description": keyDescription,
               "start_time": fromTs,
               "end_time": toTs,
               "duration": duration,
               "apps": Array(appsSet),
               "topics": Array(topicsSet),
               "transcript_count": 0,
               "has_transcript": false,
               "combined_transcript": "",
               "label": label,
           ]

           let classificationJson: String
           if let data = try? JSONSerialization.data(withJSONObject: classification),
              let str = String(data: data, encoding: .utf8) {
               classificationJson = str
           } else {
               classificationJson = "{}"
           }

           return TopicBlockInsert(
               id: id,
               recordingId: recorderRecordingId,
               contextIds: "[]",
               classification: classificationJson,
               duration: duration,
               fromTs: fromTs,
               toTs: toTs,
               observationCount: observations.count
           )
       }

       // MARK: - LLM Grouping Prompt

       private func buildGroupingPrompt(_ observations: [UnclaimedObservation]) -> String {
           let fromTs = observations.first?.capturedAt ?? 0
           let toTs = observations.last?.capturedAt ?? 0

           var blockDescriptions = ""
           for (i, obs) in observations.enumerated() {
               let timeStr = formatTime(obs.capturedAt)
               blockDescriptions += """
               OBS \(i + 1):
               Time: \(timeStr)
               Activity: \(obs.activityType)
               Description: \(obs.vlmDescription)
               Apps: \(obs.apps.joined(separator: ", "))
               Topics: \(obs.topics.joined(separator: ", "))
               ID: \(obs.id)

               """
           }

           let exampleIds: String
           if observations.count >= 2 {
               exampleIds = "\"\(observations[0].id)\", \"\(observations[1].id)\""
           } else {
               exampleIds = "\"\(observations[0].id)\""
           }

           return """
           /no_think
           You are analyzing \(observations.count) screen observations from a continuous work recording spanning \(formatTime(fromTs)) to \(formatTime(toTs)).

           Your task is to group these observations into 1-6 coherent work segments. Each segment represents a distinct thread of work.

           GROUPING RULES:
           1. Group observations that belong to the same work thread, even if not consecutive
           2. Personal activities (WhatsApp, Instagram, social media) should be grouped into a "Personal" segment
           3. Deep work on the same project/codebase should be grouped together
           4. If all observations are about the same project, one group is correct — do not invent artificial splits

           OBSERVATIONS TO GROUP:
           \(blockDescriptions)

           For each group, output ONE line in this EXACT format:
           Group 1: label: [Descriptive segment name] | obsIds: [\(exampleIds)]

           CRITICAL REQUIREMENTS:
           - Each group MUST have "label" and "obsIds"
           - Observation IDs are the IDs shown above (copy them exactly)
           - Include ALL \(observations.count) observation IDs across all groups
           - Create 1-6 groups
           - Output ONLY the group lines — no explanation, no preamble
           """
       }

       // MARK: - Response Parsing

       private struct ParsedGroup {
           let label: String
           let observationIds: [String]
       }

       private func parseGroupingResponse(_ response: String, observations: [UnclaimedObservation]) -> [ParsedGroup] {
           let validIds = Set(observations.map { $0.id })
           var groups: [ParsedGroup] = []

           var cleaned = response
           while let start = cleaned.range(of: "<think>"),
                 let end = cleaned.range(of: "</think>"),
                 start.lowerBound <= end.lowerBound {
               cleaned.removeSubrange(start.lowerBound..<end.upperBound)
           }
           if let orphan = cleaned.range(of: "</think>") {
               cleaned = String(cleaned[orphan.upperBound...])
           }

           let lines = cleaned.split(separator: "\n", omittingEmptySubsequences: true)

           for line in lines {
               let lineStr = String(line).trimmingCharacters(in: .whitespaces)
               guard lineStr.lowercased().hasPrefix("group ") else { continue }

               guard let labelStart = lineStr.range(of: "label: "),
                     let separator = lineStr.range(of: " | obsIds:") else { continue }
               let label = String(lineStr[labelStart.upperBound..<separator.lowerBound])
                   .trimmingCharacters(in: .whitespaces)

               guard let idsStart = lineStr.range(of: "obsIds: ["),
                     let idsEnd = lineStr.range(of: "]", range: idsStart.upperBound..<lineStr.endIndex) else { continue }
               let idsStr = String(lineStr[idsStart.upperBound..<idsEnd.lowerBound])

               let ids = idsStr.split(separator: ",")
                   .map { String($0).trimmingCharacters(in: CharacterSet(charactersIn: " \"'")) }
                   .filter { validIds.contains($0) }

               if !ids.isEmpty && !label.isEmpty {
                   groups.append(ParsedGroup(label: label, observationIds: ids))
               }
           }

           return groups
       }

       // MARK: - Helpers

       private func dominantActivity(_ observations: [UnclaimedObservation]) -> String {
           var counts: [String: Int] = [:]
           for obs in observations {
               counts[obs.activityType, default: 0] += 1
           }
           return counts.max(by: { $0.value < $1.value })?.key ?? "Work Session"
       }

       private static let timeFormatter: DateFormatter = {
           let f = DateFormatter()
           f.dateFormat = "HH:mm"
           return f
       }()

       private func formatTime(_ unixTimestamp: Double) -> String {
           let date = Date(timeIntervalSince1970: unixTimestamp)
           return Self.timeFormatter.string(from: date)
       }
   }
   ```

2. Add a `ping()` convenience method to `apps/recorder/Sources/WorkQueue.swift` (the InferenceQueue file), alongside the other convenience methods added in WU-5:
   ```swift
       /// Convenience: zero-cost health check through the queue.
       func ping() async throws {
           _ = try await submit(priority: .low) { [workers] in
               guard let worker = workers.first else {
                   throw PythonBridgeError.notStarted
               }
               return try await worker.ping()
           }
       }
   ```

**Verification**: `swift build --package-path apps/recorder 2>&1 | grep -c "error:"` — Expected: errors will come only from `main.swift` (not yet updated). `SessionAggregator.swift` should compile cleanly.

**Rollback**:
- Modified files: `git checkout -- apps/recorder/Sources/SessionAggregator.swift apps/recorder/Sources/WorkQueue.swift`

---

### WU-7: Rewire main.swift

**Dependencies**: WU-2, WU-3, WU-5, WU-6

**Context**: `main.swift` currently creates a `PythonBridgeVLMAdapter`, a `WorkQueue`, a `FrameAnalyzer` (with vlmService + queue), and a `SessionAggregator` (with textService + queue). It starts the bridge via `analyzer.start()` which calls `vlmService.start()`. Shutdown kills the bridge via `vlmAdapter?.terminateSync()` and cancels queue entries via `workQueue.cancelAll()`. The new wiring: create worker → create `InferenceQueue(workers: [worker])` → `queue.startWorkers()` → create `FrameAnalyzer(queue:)` and `SessionAggregator(queue:)` without bridge refs → shutdown via `queue.terminateWorkersSync()` and `queue.cancelAll()`.

**Files**:
- `apps/recorder/Sources/main.swift` — rewire startup and shutdown

**Steps**:
1. In the `EscribanoRecorderDelegate` class properties (lines 21-32), replace:
   ```swift
       private var captures: [StreamCapture] = []
       private var store: (any FrameStore)?
       private var backpressure: Backpressure?
       private var obsStore: (any ObservationStore)?
       private var analyzer: FrameAnalyzer?
       private var analyzerTask: Task<Void, Never>?
       private var vlmAdapter: PythonBridgeVLMAdapter?
       private var workQueue: WorkQueue?
       private var analyzerFrameStore: (any FrameStore)?
       private var tbStore: (any TopicBlockStore)?
       private var aggregator: SessionAggregator?
       private var aggregatorTask: Task<Void, Never>?
   ```
   With:
   ```swift
       private var captures: [StreamCapture] = []
       private var store: (any FrameStore)?
       private var backpressure: Backpressure?
       private var obsStore: (any ObservationStore)?
       private var analyzer: FrameAnalyzer?
       private var analyzerTask: Task<Void, Never>?
       private var inferenceQueue: InferenceQueue?
       private var analyzerFrameStore: (any FrameStore)?
       private var tbStore: (any TopicBlockStore)?
       private var aggregator: SessionAggregator?
       private var aggregatorTask: Task<Void, Never>?
   ```
   (Removed `vlmAdapter` and `workQueue`, added `inferenceQueue`)

2. In the `start()` method, replace the section from "Create the VLM adapter" through "SessionAggregator task started" (lines 152-207). Currently:
   ```swift
           let vlmService = PythonBridgeVLMAdapter()
           self.vlmAdapter = vlmService
           let realtimeStreak = Int(...) ?? 10
           let workQueue = WorkQueue(maxRealtimeStreak: realtimeStreak)
           self.workQueue = workQueue
           let analyzer = FrameAnalyzer(frameStore: analyzerFrameStore, obsStore: obsStore, vlmService: vlmService, queue: workQueue)
           self.analyzer = analyzer
           self.analyzerTask = Task {
               do {
                   try await analyzer.start()
               } catch {
                   log("[FrameAnalyzer] Failed to start: \(error.localizedDescription)")
                   return
               }
               await analyzer.analyzeLoop()
           }
           log("[escribano-recorder] VLM analyzer task started.")
           // ... TopicBlockStore setup ...
           let aggregator = SessionAggregator(
               obsStore: obsStore,
               tbStore: tbStore,
               textService: vlmService,
               queue: workQueue
           )
           self.aggregator = aggregator
           self.aggregatorTask = Task {
               await aggregator.aggregateLoop()
           }
           log("[escribano-recorder] SessionAggregator task started.")
   ```
   Replace with:
   ```swift
           // Create the inference worker and queue
           let worker = PythonBridgeVLMAdapter()
           let realtimeStreak = Int(
               ProcessInfo.processInfo.environment["ESCRIBANO_QUEUE_REALTIME_STREAK"] ?? ""
           ) ?? 10
           let inferenceQueue = InferenceQueue(workers: [worker], maxRealtimeStreak: realtimeStreak)
           self.inferenceQueue = inferenceQueue

           // Start workers (blocks until Python bridge is ready and model is loaded)
           do {
               try await inferenceQueue.startWorkers()
           } catch {
               log("[escribano-recorder] FATAL: Failed to start inference workers: \(error.localizedDescription)")
               exit(1)
           }
           log("[escribano-recorder] Inference queue ready.")

           let analyzer = FrameAnalyzer(frameStore: analyzerFrameStore, obsStore: obsStore, queue: inferenceQueue)
           self.analyzer = analyzer
           self.analyzerTask = Task {
               await analyzer.analyzeLoop()
           }
           log("[escribano-recorder] FrameAnalyzer task started.")
   ```
   Then keep the TopicBlockStore setup (unchanged), and replace the aggregator creation:
   ```swift
           let aggregator = SessionAggregator(
               obsStore: obsStore,
               tbStore: tbStore,
               queue: inferenceQueue
           )
           self.aggregator = aggregator
           self.aggregatorTask = Task {
               await aggregator.aggregateLoop()
           }
           log("[escribano-recorder] SessionAggregator task started.")
   ```

3. In `applicationWillTerminate` (lines 249-277), replace the shutdown sequence:
   ```swift
       func applicationWillTerminate(_ notification: Notification) {
           log("[escribano-recorder] applicationWillTerminate — cleaning up")
           if let workQueue {
               Task { await workQueue.cancelAll() }
           }
           analyzerTask?.cancel()
           aggregatorTask?.cancel()
           vlmAdapter?.terminateSync()
           store?.close()
           analyzerFrameStore?.close()
           ...
       }
   ```
   With:
   ```swift
       func applicationWillTerminate(_ notification: Notification) {
           log("[escribano-recorder] applicationWillTerminate — cleaning up")
           // Cancel all pending queue entries first — resumes their continuations
           // with CancellationError so they don't leak when workers are killed.
           if let inferenceQueue {
               Task { await inferenceQueue.cancelAll() }
           }
           // Cancel the analyzer and aggregator tasks so their loops exit cleanly.
           analyzerTask?.cancel()
           aggregatorTask?.cancel()
           // Kill worker processes. Child processes are NOT automatically killed when the
           // parent exits on macOS — they become orphaned without this explicit call.
           inferenceQueue?.terminateWorkersSync()
           // Close synchronous (class-based) frame store handles.
           store?.close()
           analyzerFrameStore?.close()
           // Close async (actor-based) store handles.
           let localObs = obsStore
           let localTb  = tbStore
           let sema = DispatchSemaphore(value: 0)
           Task.detached {
               await localObs?.close()
               await localTb?.close()
               sema.signal()
           }
           _ = sema.wait(timeout: .now() + 2)
       }
   ```

4. In the sleep/wake hooks, the reference to `analyzer` and `aggregator` `resetBackoff()` calls remain unchanged (lines 238-240). No changes needed there.

**Verification**: `swift build -c release --package-path apps/recorder 2>&1 | tail -5` — Expected: clean build with no errors. This is the final compilation step.

**Rollback**:
- Modified files: `git checkout -- apps/recorder/Sources/main.swift`

---

### WU-8: Update README and fix Logger comment

**Dependencies**: WU-7 (needs final architecture to document accurately)

**Context**: The README describes the old architecture (WorkQueue, VLMInferenceService + TextGenerationService, bridge restart logic). It also has a wrong default for `ESCRIBANO_TB_LLM_BATCH_SIZE` (says 100, code uses 50). The Logger.swift doc comment says "timestamped messages" but doesn't add timestamps. Both need updating.

**Files**:
- `apps/recorder/README.md` — update architecture, file reference, config table
- `apps/recorder/Sources/Logger.swift` — fix misleading comment

**Steps**:
1. In `apps/recorder/README.md`, update the Architecture section (lines 12-39). Replace:
   ```
   Three concurrent async Tasks run in parallel after startup, coordinated by one shared actor:
   ```
   With:
   ```
   Three concurrent async Tasks run in parallel after startup, coordinated by one shared `InferenceQueue`:
   ```

2. Replace the WorkQueue bullet (lines 29-32):
   ```
   - **1 shared `WorkQueue`** (actor) — Serializes all bridge calls between `FrameAnalyzer` and
     `SessionAggregator`. Because VLM frame inference and LLM text generation share the same Python
     socket, all requests are queued through this actor with a priority mechanism to prevent
     starvation.
   ```
   With:
   ```
   - **1 shared `InferenceQueue`** (actor) — Owns the Python bridge worker lifecycle and serializes
     all inference calls. Checks worker health before each job via `ping()`, restarts dead workers
     with exponential backoff, and acts as circuit breaker (stops after 5 consecutive failures).
     Priority scheduling with fairness prevents starvation.
   ```

3. In the File Reference table (lines 57-79), update these rows:
   - Change `WorkQueue.swift` description from `Actor priority queue serializing all Python bridge calls` to `InferenceQueue: owns worker lifecycle, scheduling, health checks, and restart`
   - Change `PythonBridge.vlm.adapter.swift` description from `Implements \`VLMInferenceService\` + \`TextGenerationService\` over Unix socket` to `Implements \`InferenceWorker\` over Unix socket (dumb process wrapper)`
   - Change `VLMInferenceService.port.swift` description from `Protocol for VLM frame inference` to `\`InferenceWorker\` protocol: unified VLM + text generation port`
   - Remove the `TextGenerationService.port.swift` row entirely
   - Change `Logger.swift` description from `Global \`log()\` function (timestamps to stdout)` to `Global \`log()\` function (writes to stdout)`
   - Update `main.swift` description from `NSApplication delegate; wires up 3 tasks, 1 WorkQueue, and 3 SQLite connections` to `NSApplication delegate; wires up 3 tasks, 1 InferenceQueue, and 3 SQLite connections`

4. In the Configuration table (line 96), fix the `ESCRIBANO_TB_LLM_BATCH_SIZE` default from `100` to `50`:
   ```
   | `ESCRIBANO_TB_LLM_BATCH_SIZE` | `50` | Observations per LLM sub-batch |
   ```

5. In `apps/recorder/Sources/Logger.swift`, change the doc comment (lines 3-6):
   ```swift
   /// Global logging function for the escribano recorder daemon.
   ///
   /// Writes timestamped messages to stdout. The LaunchAgent captures stdout
   /// to a log file, so all `log()` output is persisted automatically.
   ```
   To:
   ```swift
   /// Global logging function for the escribano recorder daemon.
   ///
   /// Writes messages to stdout (not timestamped — the LaunchAgent captures
   /// stdout to a log file where macOS adds timestamps automatically).
   ```

6. Update the "Common Issues & Dev Notes" section. The "Race conditions with shared bridge" section (lines 201-207) references `WorkQueue`. Update:
   ```
   Both `FrameAnalyzer` and `SessionAggregator` use the same `PythonBridgeVLMAdapter` instance. The
   bridge is an actor that serializes calls, but if `isStarted` is false, calls fail immediately.

   **Solution:** The `WorkQueue` actor wraps all bridge calls and ensures proper ordering. Make sure
   the bridge is started before any tasks begin submitting work to the queue.
   ```
   To:
   ```
   Both `FrameAnalyzer` and `SessionAggregator` share the same Python bridge worker. Neither
   component is aware of the bridge — they submit work to `InferenceQueue`.

   **Solution:** The `InferenceQueue` actor owns the worker lifecycle: it checks health via `ping()`
   before each job, restarts dead workers with exponential backoff, and opens a circuit breaker
   after 5 consecutive failures. `main.swift` calls `queue.startWorkers()` before creating tasks.
   ```

**Verification**: `swift build -c release --package-path apps/recorder 2>&1 | tail -3` — should still compile cleanly (only docs/comments changed). Also verify README renders: `wc -l apps/recorder/README.md` should show a reasonable line count.

**Rollback**:
- Modified files: `git checkout -- apps/recorder/README.md apps/recorder/Sources/Logger.swift`

---

## Execution Plan

### Phase 1 — Parallel (no dependencies)

- **WU-1**: Create InferenceWorker protocol
- **WU-4**: Add ping handler to Python bridge

### Phase 2 — Parallel (requires Phase 1)

- **WU-2**: Simplify PythonBridgeVLMAdapter to implement InferenceWorker
- **WU-3**: Create InferenceQueue (replaces WorkQueue)

### Phase 3 — Sequential (requires Phase 2)

- **WU-5**: Simplify FrameAnalyzer + add convenience methods to InferenceQueue

### Phase 4 — Sequential (requires Phase 3)

- **WU-6**: Simplify SessionAggregator + add ping convenience method to InferenceQueue

### Phase 5 — Sequential (requires Phase 2-4, all callers must be updated first)

- **WU-7**: Rewire main.swift
- **WU-8**: Update README and fix Logger comment

Note: WU-7 and WU-8 are in the same phase because they touch different files and can run in parallel. WU-7 touches only `main.swift`, WU-8 touches only `README.md` and `Logger.swift`.

## Recovery Strategy

- **Automatic**: Each implementor rolls back and retries once on failure.
- **Dependency failure**: If a work unit fails and later units depend on it, those later units will not run.
  The orchestrator will report which units were skipped.
- **Global rollback**: `git stash` or `git checkout -- apps/recorder/Sources/ scripts/mlx_bridge.py apps/recorder/README.md` to revert all changes.
- **Independent failures**: Work units with no dependency on a failed unit will still execute.
- **Build verification**: The final build command `swift build -c release --package-path apps/recorder` must pass after Phase 5 completes. If it fails, the orchestrator will analyze build errors and create fix units.
