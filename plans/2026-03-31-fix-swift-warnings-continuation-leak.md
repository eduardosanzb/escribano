# Implementation Plan: Fix Swift 6 Actor Isolation Warnings & WorkQueue Continuation Leak

**Date**: 2026-03-31 **Status**: COMPLETED

## Overview

Fix two issues in the recorder: (1) Swift 6 concurrency warnings in the sleep/wake notification observers added by WU-7, where `@Sendable` closures access `@MainActor`-isolated properties; (2) a `CheckedContinuation` leak in `WorkQueue` that fires when a pending entry is removed via cancellation without resuming its continuation, causing a runtime warning on SIGINT shutdown.

## Scope

- Work units: 2
- Execution phases: 2
- Files affected:
  - `apps/recorder/Sources/WorkQueue.swift`
  - `apps/recorder/Sources/main.swift`

## Work Units

### WU-1: Fix WorkQueue continuation leak on cancellation

**Dependencies**: none

**Context**: `WorkQueue.submit()` creates a `CheckedContinuation` inside a `withCheckedThrowingContinuation` block and captures it in an `Entry.work` closure. When a task is cancelled, the `onCancel` handler calls `removeEntry(id:)` which removes the `Entry` from the queue array. But the captured `CheckedContinuation` inside the dropped `work` closure is never resumed — Swift's runtime detects this and prints `SWIFT TASK CONTINUATION MISUSE: submit(priority:_:) leaked its continuation`. The fix is to store a separate `cancel` closure on each `Entry` that resumes the continuation with `CancellationError`, and call it in `removeEntry()`. Additionally, add a `cancelAll()` method for clean shutdown.

**Files**:
- `apps/recorder/Sources/WorkQueue.swift` — modify

**Steps**:
1. Add a `cancel` field to the `Entry` struct. Replace the current struct (lines 30-34):
   ```swift
   private struct Entry {
       let priority: Priority
       let sequence: UInt64
       let work: @Sendable () async -> Void
   }
   ```
   With:
   ```swift
   private struct Entry {
       let priority: Priority
       let sequence: UInt64
       let work: @Sendable () async -> Void
       let cancel: @Sendable () -> Void  // Resume continuation with CancellationError
   }
   ```

2. In `submit()` (lines 68-89), add the `cancel` field when creating the `Entry`. Replace the entry creation block:
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
       }
   )
   ```
   With:
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

3. In `removeEntry(id:)` (lines 100-105), call `cancel()` on the removed entry. Replace:
   ```swift
   private func removeEntry(id: UInt64) {
       if let idx = queue.firstIndex(where: { $0.sequence == id }) {
           queue.remove(at: idx)
           logQueueIfNeeded()
       }
   }
   ```
   With:
   ```swift
   private func removeEntry(id: UInt64) {
       if let idx = queue.firstIndex(where: { $0.sequence == id }) {
           let entry = queue.remove(at: idx)
           entry.cancel()
           logQueueIfNeeded()
       }
   }
   ```

4. Add a `cancelAll()` method after `removeEntry()` for clean shutdown. This drains the queue and resumes all pending continuations with `CancellationError`:
   ```swift
   /// Cancel all pending (not yet started) entries. Resumes their continuations
   /// with CancellationError. Called during applicationWillTerminate for clean shutdown.
   func cancelAll() {
       let pending = queue
       queue.removeAll()
       for entry in pending {
           entry.cancel()
       }
       if !pending.isEmpty {
           log("[WorkQueue] Cancelled \(pending.count) pending entries during shutdown")
       }
   }
   ```

**Verification**: `swift build -c release 2>&1 | tail -5` run from `apps/recorder/`

**Rollback**:
- Modified files: `git checkout -- apps/recorder/Sources/WorkQueue.swift`

---

### WU-2: Fix actor isolation warnings in sleep/wake hooks and wire cancelAll()

**Dependencies**: WU-1

**Context**: The sleep/wake notification observers in `main.swift` (lines 226-240) use `addObserver(forName:object:queue:_:)` which takes a `@Sendable` closure. Inside these closures, we access `@MainActor`-isolated properties (`captures`, `analyzer`, `aggregator`) and call `@MainActor`-isolated methods (`pause()`, `resume()`). Even though we dispatch on `.main` queue, the compiler can't verify actor isolation statically. The fix is to wrap each closure body in `Task { @MainActor in ... }` so the compiler can prove isolation. Additionally, wire `cancelAll()` into the shutdown path so pending WorkQueue entries don't leak continuations on exit.

**Files**:
- `apps/recorder/Sources/main.swift` — modify

**Steps**:
1. Replace the sleep notification observer (lines 226-229):
   ```swift
   ws.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: .main) { [weak self] _ in
       log("[escribano-recorder] System will sleep — pausing capture")
       self?.captures.forEach { $0.pause() }
   }
   ```
   With:
   ```swift
   ws.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: .main) { [weak self] _ in
       Task { @MainActor in
           guard let self else { return }
           log("[escribano-recorder] System will sleep — pausing capture")
           self.captures.forEach { $0.pause() }
       }
   }
   ```

2. Replace the wake notification observer (lines 230-240):
   ```swift
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
   ```
   With:
   ```swift
   ws.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
       Task { @MainActor in
           guard let self else { return }
           log("[escribano-recorder] System woke — resuming capture and resetting backoff")
           self.captures.forEach { $0.resume() }
           // Reset analyzer and aggregator backoff since new frames are incoming
           await self.analyzer?.resetBackoff()
           await self.aggregator?.resetBackoff()
       }
   }
   ```

3. In `applicationWillTerminate` (line 247), add a `cancelAll()` call on the work queue BEFORE cancelling the tasks and killing the bridge. Insert after the log line (line 248) and before `analyzerTask?.cancel()` (line 250):
   ```swift
   // Cancel all pending WorkQueue entries first — resumes their continuations
   // with CancellationError so they don't leak when the bridge is killed.
   if let workQueue {
       Task { await workQueue.cancelAll() }
   }
   ```
   Note: Since `applicationWillTerminate` is synchronous and `cancelAll()` is async (actor method), we use `Task { ... }`. The semaphore wait at the end of the method (line 269, 2-second timeout) gives this time to complete.

**Verification**: `swift build -c release 2>&1 | tail -5` run from `apps/recorder/`

**Rollback**:
- Modified files: `git checkout -- apps/recorder/Sources/main.swift`

---

## Execution Plan

### Phase 1 — Parallel (no dependencies)

- WU-1: Fix WorkQueue continuation leak on cancellation

### Phase 2 — Sequential (requires Phase 1)

- WU-2: Fix actor isolation warnings in sleep/wake hooks and wire cancelAll()

## Recovery Strategy

- **Automatic**: Each implementor rolls back and retries once on failure.
- **Dependency failure**: If WU-1 fails, WU-2 will not run (depends on `cancelAll()`).
- **Global rollback**: `git checkout -- apps/recorder/Sources/WorkQueue.swift apps/recorder/Sources/main.swift`
