# Implementation Plan: Circuit Breaker bridgeDied Error Fixes

**Date**: 2026-03-31  **Status**: COMPLETED

## Overview

Two bugs were identified in PR #58 Copilot review. When the `InferenceQueue` circuit breaker opens, it incorrectly signals callers with `CancellationError` instead of `PythonBridgeError.bridgeDied`, defeating the callers' specific error-handling logic. Separately, `SessionAggregator`'s readiness ping loop retries forever when the circuit is already open, since it catches all errors generically.

## Scope

- Work units: 2
- Execution phases: 1 (fully parallel — no shared files)
- Files affected:
  - `apps/recorder/Sources/WorkQueue.swift`
  - `apps/recorder/Sources/SessionAggregator.swift`

## Work Units

---

### WU-1: Fix circuit-breaker error propagation in InferenceQueue

**Dependencies**: none

**Context**: `InferenceQueue.processLoop()` calls `ensureWorkerHealthy()` before each job. If the circuit breaker opens (all restart attempts exhausted), it currently calls `entry.cancel()` and `cancelAll()` to drain the queue. Both of these resume caller continuations with `CancellationError()`. The problem: `FrameAnalyzer.analyzeLoop()` has a specific `catch PythonBridgeError.bridgeDied` block that releases claimed frames back to the pool so they aren't lost. That block is never reached when callers get `CancellationError` — frames are instead marked as failed (wrong path). The fix: give `Entry` a second closure `fail` that resumes with a caller-supplied error, and use it in the circuit-open path with `PythonBridgeError.bridgeDied`.

**Files**:
- `apps/recorder/Sources/WorkQueue.swift` — modify

**Steps**:

1. In the `Entry` struct (currently has `work`, `cancel` closures — around lines 31–36 of `WorkQueue.swift`), add a `fail` closure:

   Current struct:
   ```swift
   private struct Entry {
       let priority: Priority
       let sequence: UInt64
       let work: @Sendable () async -> Void
       let cancel: @Sendable () -> Void
   }
   ```
   Replace with:
   ```swift
   private struct Entry {
       let priority: Priority
       let sequence: UInt64
       let work: @Sendable () async -> Void
       let cancel: @Sendable () -> Void
       let fail: @Sendable (Error) -> Void
   }
   ```

2. In `submit<T>()`, where the `Entry` is constructed (inside the `withCheckedThrowingContinuation` block), add the `fail` closure. Currently:
   ```swift
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
   ```
   Replace with:
   ```swift
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
       },
       fail: { error in
           cont.resume(throwing: error)
       }
   )
   ```

3. Add a new private `drainWithError(_ error: Error)` method to `InferenceQueue`. Place it alongside `cancelAll()`:
   ```swift
   /// Drain the queue resuming all pending continuations with a specific error.
   /// Used when the circuit breaker opens — callers need to distinguish bridge
   /// death from user cancellation so they can take the correct cleanup path.
   private func drainWithError(_ error: Error) {
       let pending = queue
       queue.removeAll()
       for entry in pending {
           entry.fail(error)
       }
       if !pending.isEmpty {
           log("[InferenceQueue] Drained \(pending.count) pending entries with error: \(error.localizedDescription)")
       }
   }
   ```

4. In `processLoop()`, find the circuit-open block (currently calls `entry.cancel()` then `cancelAll()`):
   ```swift
   if circuitOpen {
       entry.cancel()
       cancelAll()
       break
   }
   ```
   Replace with:
   ```swift
   if circuitOpen {
       entry.fail(PythonBridgeError.bridgeDied)
       drainWithError(PythonBridgeError.bridgeDied)
       break
   }
   ```

**Verification**: `swift build --package-path apps/recorder 2>&1 | grep -c "error:"` — expected output: `0`

**Rollback**:
- Modified files: `git checkout -- apps/recorder/Sources/WorkQueue.swift`

---

### WU-2: Fix SessionAggregator readiness loop to exit on circuit-open

**Dependencies**: none

**Context**: `SessionAggregator.aggregateLoop()` begins with a readiness check loop that pings the `InferenceQueue` every 5 seconds until it gets a successful response. The catch block is generic — it catches any error and retries. If the `InferenceQueue` circuit breaker has already opened (e.g., the Python bridge failed to start 5 times before SA even began), `queue.ping()` will always throw `PythonBridgeError.bridgeDied` (because `submit()` checks `circuitOpen` and throws immediately). The loop will spin forever, sleeping 5 seconds between iterations, logging "Waiting for inference queue..." indefinitely. The fix: add a specific `catch PythonBridgeError.bridgeDied` clause before the generic catch that logs and returns early.

**Files**:
- `apps/recorder/Sources/SessionAggregator.swift` — modify

**Steps**:

1. In `aggregateLoop()`, locate the readiness ping loop (currently around lines 91–103). The current loop is:
   ```swift
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
   ```
   Replace with:
   ```swift
   var readyAttempts = 0
   while !Task.isCancelled {
       readyAttempts += 1
       do {
           try await queue.ping()
           break
       } catch PythonBridgeError.bridgeDied {
           log("[SessionAggregator] Inference queue circuit open while waiting for readiness — stopping")
           return
       } catch {
           if readyAttempts % 6 == 0 {
               log("[SessionAggregator] Waiting for inference queue... (\(readyAttempts * 5)s elapsed)")
           }
           try? await Task.sleep(for: .seconds(5))
       }
   }
   ```

**Verification**: `swift build --package-path apps/recorder 2>&1 | grep -c "error:"` — expected output: `0`

**Rollback**:
- Modified files: `git checkout -- apps/recorder/Sources/SessionAggregator.swift`

---

## Execution Plan

### Phase 1 — Parallel (no dependencies, no file overlap)

- **WU-1**: Fix circuit-breaker error propagation in InferenceQueue (`WorkQueue.swift`)
- **WU-2**: Fix SessionAggregator readiness loop to exit on circuit-open (`SessionAggregator.swift`)

## Recovery Strategy

- **Automatic**: Each implementor rolls back and retries once on failure.
- **Dependency failure**: Units are independent — failure of one does not block the other.
- **Global rollback**: `git checkout -- apps/recorder/Sources/WorkQueue.swift apps/recorder/Sources/SessionAggregator.swift`
- **Build verification**: `swift build -c release --package-path apps/recorder` must pass after Phase 1.
