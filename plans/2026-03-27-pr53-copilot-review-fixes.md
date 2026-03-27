# Implementation Plan: PR #53 Copilot Review Fixes

**Date**: 2026-03-27
**Status**: COMPLETED
**Worktree**: `/Users/eduardosanchez/repos/github.com/eduardosanzb/escribano/.claude/worktrees/mystifying-mcnulty`
**Branch**: `phase-3a-session-aggregation`

## Overview

Address all 13 outstanding non-outdated Copilot review comments from PR #53. These are critical fixes for:
- Environment variable validation (prevent crashes from invalid config)
- Error handling consistency (throw instead of silent failures)
- Database connection leak prevention
- Data consistency (prevent orphan TopicBlocks)
- Privacy protection (gate sensitive LLM response logging)
- Concurrency correctness (cancellation handling, Sendable documentation)
- Documentation accuracy (API signatures, outdated comments)
- Query accuracy (filter unclaimed observations correctly)

## Scope

- **Work units**: 13
- **Execution phases**: 3
- **Files affected**:
  - `apps/recorder/Sources/SessionAggregator.swift` (issues 1, 5, 6, 7)
  - `apps/recorder/Sources/FrameStore.sqlite.adapter.swift` (issues 2, 9)
  - `apps/recorder/Sources/TopicBlockStore.sqlite.adapter.swift` (issue 3)
  - `apps/recorder/Sources/ObservationStore.sqlite.adapter.swift` (issues 4, 13)
  - `apps/recorder/Sources/WorkQueue.swift` (issue 8)
  - `apps/recorder/Sources/ObservationStore.port.swift` (issue 12)
  - `src/actions/recorder-commands.ts` (issue 11)
  - `docs/architecture.md` (issue 10)

## Work Units

### WU-1: SessionAggregator Env Var Validation

**Dependencies**: none

**Context**: The SessionAggregator initializer (lines 55-69) parses environment variables for configuration without validation. This allows 0 or negative values which cause runtime crashes:
- `llmBatchSize <= 0` will crash with `stride(by: 0)` in `processWindow()`
- `pollInterval <= 0` can reintroduce hot loop behavior

**Files**:
- `apps/recorder/Sources/SessionAggregator.swift` — modify (lines 55-69)

**Steps**:
1. Replace the env var parsing in `init()` with validated versions that clamp to minimums:
   - `minObservations`: clamp to `max(1, ...)` with default 3
   - `pollInterval`: clamp to `max(1.0, ...)` with default 120.0
   - `maxObsPerCycle`: clamp to `max(1, ...)` with default 300
   - `llmBatchSize`: clamp to `max(1, ...)` with default 100
2. Add warning logs when values are clamped (use existing `log()` function)
3. The implementation should follow this pattern:
   ```swift
   let rawMinObs = Int(ProcessInfo.processInfo.environment["ESCRIBANO_TB_MIN_OBSERVATIONS"] ?? "") ?? 3
   self.minObservations = max(1, rawMinObs)
   if self.minObservations != rawMinObs {
       log("[SessionAggregator] WARN: ESCRIBANO_TB_MIN_OBSERVATIONS clamped from \(rawMinObs) to \(self.minObservations)")
   }
   ```

**Verification**: `cd /Users/eduardosanchez/repos/github.com/eduardosanzb/escribano/.claude/worktrees/mystifying-mcnulty && swift build -c release 2>&1 | head -20` should show no errors

**Rollback**: `git checkout -- apps/recorder/Sources/SessionAggregator.swift`

---

### WU-2: FrameStore markFrameFailed Error Handling

**Dependencies**: none

**Context**: The `markFrameFailed()` function (lines 185-200) is declared `throws` but on `sqlite3_prepare_v2` failure (line 193), it only logs and returns silently (lines 194-195). This leaves frames stuck without `retry_count`/`analyzed` updates, violating the function's contract.

**Files**:
- `apps/recorder/Sources/FrameStore.sqlite.adapter.swift` — modify (lines 193-196)

**Steps**:
1. Replace the silent return on prepare failure with a thrown error:
   - Change lines 193-196 from:
     ```swift
     guard sqlite3_prepare_v2(handle, sql, -1, &stmt, nil) == SQLITE_OK else {
         log("[FrameStore] markFrameFailed prepare error: \(String(cString: sqlite3_errmsg(handle)))")
         return
     }
     ```
   - To:
     ```swift
     guard sqlite3_prepare_v2(handle, sql, -1, &stmt, nil) == SQLITE_OK else {
         throw FrameStoreError.queryFailed(String(cString: sqlite3_errmsg(handle)))
     }
     ```
2. This matches the pattern used in `claimFrames()` and `markFramesAnalyzed()`

**Verification**: `cd /Users/eduardosanchez/repos/github.com/eduardosanzb/escribano/.claude/worktrees/mystifying-mcnulty && swift build -c release 2>&1 | head -20` should show no errors

**Rollback**: `git checkout -- apps/recorder/Sources/FrameStore.sqlite.adapter.swift`

---

### WU-3: TopicBlockStore getUserVersion Crash Fix

**Dependencies**: none

**Context**: The `getUserVersion()` function (lines 45-51) ignores the return code from `sqlite3_prepare_v2`. If prepare fails, `stmt` may be nil and `sqlite3_step(stmt)` can crash at runtime. This is inconsistent with the pattern in `FrameStore.sqlite.adapter.swift` which properly checks return codes.

**Files**:
- `apps/recorder/Sources/TopicBlockStore.sqlite.adapter.swift` — modify (lines 45-51)

**Steps**:
1. Change `getUserVersion()` from a non-throwing method to a throwing method
2. Check the prepare return code and throw on failure:
   ```swift
   private func getUserVersion() throws -> Int32 {
       var stmt: OpaquePointer?
       guard sqlite3_prepare_v2(handle, "PRAGMA user_version", -1, &stmt, nil) == SQLITE_OK else {
           throw TopicBlockStoreError.queryFailed("Failed to prepare PRAGMA user_version")
       }
       defer { sqlite3_finalize(stmt) }
       sqlite3_step(stmt)
       return sqlite3_column_int(stmt, 0)
   }
   ```
3. Update the call site in `init()` (line 35) to use `try`:
   ```swift
   let version = try getUserVersion()
   ```

**Verification**: `cd /Users/eduardosanchez/repos/github.com/eduardosanzb/escribano/.claude/worktrees/mystifying-mcnulty && swift build -c release 2>&1 | head -20` should show no errors

**Rollback**: `git checkout -- apps/recorder/Sources/TopicBlockStore.sqlite.adapter.swift`

---

### WU-4: ObservationStore Connection Leak Fix

**Dependencies**: none

**Context**: In `init()` (lines 50-55), when schema version check fails, the SQLite handle is left open. This leaks a connection and can keep WAL files locked. The pattern in `TopicBlockStore.sqlite.adapter.swift` correctly closes the handle before throwing.

**Files**:
- `apps/recorder/Sources/ObservationStore.sqlite.adapter.swift` — modify (lines 50-55)

**Steps**:
1. Before throwing the schema mismatch error, close the handle and set to nil:
   ```swift
   guard version >= Self.expectedSchemaVersion else {
       sqlite3_close(handle)
       handle = nil
       throw ObservationStoreError.queryFailed(
           "Database schema out of date (version \(version), expected \(Self.expectedSchemaVersion)). " +
           "Run 'escribano recorder install' from Node.js."
       )
   }
   ```
2. This matches the pattern in `SQLiteTopicBlockStore.init()` lines 36-39

**Verification**: `cd /Users/eduardosanchez/repos/github.com/eduardosanzb/escribano/.claude/worktrees/mystifying-mcnulty && swift build -c release 2>&1 | head -20` should show no errors

**Rollback**: `git checkout -- apps/recorder/Sources/ObservationStore.sqlite.adapter.swift`

---

### WU-5: WorkQueue Cancellation Handler

**Dependencies**: none

**Context**: The docstring (lines 56-59) says "Cancellation that occurs after enqueuing will be surfaced when the work actually runs", but the implementation doesn't tie the waiting continuation to task cancellation. If the caller cancelled while waiting, work still executes and caller may receive value instead of CancellationError.

**Files**:
- `apps/recorder/Sources/WorkQueue.swift` — modify (lines 60-86)

**Steps**:
1. Wrap the `withCheckedThrowingContinuation` in `withTaskCancellationHandler`:
   ```swift
   func submit<T: Sendable>(
       priority: Priority,
       _ operation: @Sendable @escaping () async throws -> T
   ) async throws -> T {
       try Task.checkCancellation()
       
       let entryId = nextSequence + 1  // Capture before increment
       
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
           // Remove the entry from queue if still pending
           Task { await self.removeEntry(id: entryId) }
       }
   }
   ```
2. Add a helper method to remove entries by sequence ID:
   ```swift
   private func removeEntry(id: UInt64) {
       if let idx = queue.firstIndex(where: { $0.sequence == id }) {
           queue.remove(at: idx)
           logQueueIfNeeded()
       }
   }
   ```
3. Update the docstring to reflect the actual cancellation behavior

**Verification**: `cd /Users/eduardosanchez/repos/github.com/eduardosanzb/escribano/.claude/worktrees/mystifying-mcnulty && swift build -c release 2>&1 | head -20` should show no errors

**Rollback**: `git checkout -- apps/recorder/Sources/WorkQueue.swift`

---

### WU-6: Architecture.md WorkQueue API Documentation Fix

**Dependencies**: none

**Context**: The WorkQueue API shown in docs/architecture.md (line 712) doesn't match the implementation. Docs show `func submit<T>(priority: TaskPriority, operation: ...)` but actual code uses `WorkQueue.Priority` enum and unlabeled trailing closure.

**Files**:
- `docs/architecture.md` — modify (line 712)

**Steps**:
1. Update the signature in the documentation to match the actual API:
   ```swift
   actor WorkQueue {
     func submit<T>(_ priority: Priority, _ operation: () async throws -> T) async throws -> T
   }
   ```
2. Ensure the Priority enum is documented as `WorkQueue.Priority` with cases `.realtime`, `.normal`, `.low`

**Verification**: `grep -n "func submit" docs/architecture.md` should show the corrected signature

**Rollback**: `git checkout -- docs/architecture.md`

---

### WU-7: Recorder Commands Unclaimed Count Filter Fix

**Dependencies**: none

**Context**: The "unclaimed observations" count query (line 238) includes any observation with `tb_id IS NULL` and VLM description, including non-recorder/batch observations (where `frame_id IS NULL`). This reports backlog that SessionAggregator will never process.

**Files**:
- `src/actions/recorder-commands.ts` — modify (line 238)

**Steps**:
1. Add `AND frame_id IS NOT NULL` filter to match the recorder-side filter in `ObservationStore.sqlite.adapter.swift`:
   ```typescript
   const unclaimedRow = db
     .prepare(
       'SELECT COUNT(*) as cnt FROM observations WHERE tb_id IS NULL AND vlm_description IS NOT NULL AND frame_id IS NOT NULL'
     )
     .get() as { cnt: number };
   ```
2. This aligns with the filter in `fetchUnclaimed()` which has `AND o.frame_id IS NOT NULL`

**Verification**: `cd /Users/eduardosanchez/repos/github.com/eduardosanzb/escribano/.claude/worktrees/mystifying-mcnulty && pnpm biome check src/actions/recorder-commands.ts 2>&1 | head -10` should show no errors

**Rollback**: `git checkout -- src/actions/recorder-commands.ts`

---

### WU-8: ObservationStore.port.swift Comment Update

**Dependencies**: none

**Context**: The comment on lines 109-113 still mentions "gap-aware windowing" but the implementation/ADR now uses LLM-based semantic grouping and `splitByGap` was removed.

**Files**:
- `apps/recorder/Sources/ObservationStore.port.swift` — modify (lines 109-113)

**Steps**:
1. Update the comment to reflect the current LLM-based semantic grouping:
   ```swift
   /// Fetch observations not yet claimed by any TopicBlock.
   /// Returns observations ordered by timestamp ASC (oldest first).
   /// Uses frame.captured_at when available for accurate timestamps.
   /// These observations are grouped via LLM-based semantic analysis in SessionAggregator.
   /// - Parameter limit: Maximum number of observations to return (default 300)
   ```

**Verification**: `grep -A5 "Fetch observations not yet claimed" apps/recorder/Sources/ObservationStore.port.swift` should show updated comment

**Rollback**: `git checkout -- apps/recorder/Sources/ObservationStore.port.swift`

---

### WU-9: ObservationStore Magic Timestamp Documentation

**Dependencies**: none

**Context**: Line 120 in `fetchUnclaimed()` hard-codes `o.timestamp >= 1577836800.0` (2020-01-01) without explanation. This silently excludes valid data if timestamps are relative or system time is wrong.

**Files**:
- `apps/recorder/Sources/ObservationStore.sqlite.adapter.swift` — modify (line 120)

**Steps**:
1. Add a comment explaining the magic timestamp:
   ```swift
   // Filter out observations with timestamps before 2020-01-01 (Unix epoch 1577836800).
   // This guards against observations with invalid/relative timestamps that could
   // skew aggregation results. Observations before this date are considered data errors.
   AND o.timestamp >= 1577836800.0
   ```
2. Consider adding a named constant at the top of the file:
   ```swift
   private let MIN_VALID_TIMESTAMP: Double = 1577836800.0  // 2020-01-01 00:00:00 UTC
   ```

**Verification**: `cd /Users/eduardosanchez/repos/github.com/eduardosanzb/escribano/.claude/worktrees/mystifying-mcnulty && swift build -c release 2>&1 | head -20` should show no errors

**Rollback**: `git checkout -- apps/recorder/Sources/ObservationStore.sqlite.adapter.swift`

---

### WU-10: FrameStore Sendable Documentation

**Dependencies**: none

**Context**: `SQLiteFrameStore` is marked `@unchecked Sendable` (line 20) but contains mutable `sqlite3*` handle and is not inherently thread-safe. This needs clear documentation explaining the invariant that each instance is confined to a single actor/thread.

**Files**:
- `apps/recorder/Sources/FrameStore.sqlite.adapter.swift` — modify (lines 8-20)

**Steps**:
1. Add documentation comment explaining the Sendable invariant:
   ```swift
   // MARK: - SQLiteFrameStore
   // Adapter implementation of FrameStore using SQLite C API.
   //
   // This class handles:
   // - Database connection lifecycle
   // - SQLite pragma configuration (WAL mode, etc.)
   // - Schema version validation on startup
   // - Frame metadata persistence
   //
   // Architecture note: This is the "Adapter" in the Port/Adapter pattern.
   // The Port (FrameStore protocol) is defined in FrameStore.swift and knows
   // nothing about SQLite. This adapter bridges the protocol to SQLite specifics.
   //
   // Thread Safety: Marked `@unchecked Sendable` because each instance is confined
   // to a single actor/thread and never shared concurrently. The sqlite3* handle
   // is not thread-safe, so instances must not be accessed from multiple threads
   // simultaneously. This is enforced by using the adapter within an actor context.
   final class SQLiteFrameStore: FrameStore, @unchecked Sendable {
   ```

**Verification**: `cd /Users/eduardosanchez/repos/github.com/eduardosanzb/escribano/.claude/worktrees/mystifying-mcnulty && swift build -c release 2>&1 | head -20` should show no errors

**Rollback**: `git checkout -- apps/recorder/Sources/FrameStore.sqlite.adapter.swift`

---

### WU-11: SessionAggregator Orphan Prevention - Fallback Path

**Dependencies**: WU-1

**Context**: In the text_infer failure fallback path (lines 140-146), the TopicBlock is inserted before attempting to claim observations. If `claimObservations` updates 0 rows (concurrent claimer), this leaves an orphan TopicBlock.

**Files**:
- `apps/recorder/Sources/SessionAggregator.swift` — modify (lines 137-147)

**Steps**:
1. Restructure the fallback path to claim first, then save only if claims succeeded:
   ```swift
   } catch {
       log("[SessionAggregator] text_infer failed for sub-batch: \(error.localizedDescription)")
       // Fallback: treat sub-batch as a single TB with dominant activity label
       let tb = createTopicBlock(from: subBatch, label: dominantActivity(subBatch))
       // Claim first to avoid creating orphan TB if observations already claimed
       let claimed = try await obsStore.claimObservations(
           ids: subBatch.map { $0.id }, tbId: tb.id
       )
       if claimed > 0 {
           try await tbStore.save(tb)
           log("[SessionAggregator] Fallback TB \(tb.id): \(claimed)/\(subBatch.count) obs claimed")
       } else {
           log("[SessionAggregator] Fallback: all observations already claimed, skipping TB creation")
       }
       continue
   }
   ```

**Verification**: `cd /Users/eduardosanchez/repos/github.com/eduardosanzb/escribano/.claude/worktrees/mystifying-mcnulty && swift build -c release 2>&1 | head -20` should show no errors

**Rollback**: `git checkout -- apps/recorder/Sources/SessionAggregator.swift`

---

### WU-12: SessionAggregator Orphan Prevention - Main Loop

**Dependencies**: WU-11

**Context**: In the main group loop (lines 183-192), the TB is saved before claiming observations, and the code explicitly allows claimed == 0 (logging orphan). This creates persistent orphans when LLM repeats IDs or concurrent process claims first.

**Files**:
- `apps/recorder/Sources/SessionAggregator.swift` — modify (lines 172-193)

**Steps**:
1. Restructure the main loop to claim first, only save TB when claimed > 0:
   ```swift
   var created = 0
   for group in allGroups {
       let groupObs = group.observationIds.compactMap { targetId in
           window.first { $0.id == targetId }
       }
       log("[SessionAggregator] Group '\(group.label)': \(group.observationIds.count) IDs → \(groupObs.count) matched in window")
       guard !groupObs.isEmpty else { continue }
       
       // Claim observations first to avoid creating orphan TB
       let tb = createTopicBlock(from: groupObs, label: group.label)
       let claimed = try await obsStore.claimObservations(
           ids: groupObs.map { $0.id }, tbId: tb.id
       )
       
       if claimed > 0 {
           // Only save TB if we successfully claimed observations
           try await tbStore.save(tb)
           created += 1
           log("[SessionAggregator] TB \(tb.id) (\(group.label)): \(claimed)/\(groupObs.count) obs claimed")
       } else {
           log("[SessionAggregator] Group '\(group.label)': all observations already claimed, skipping TB creation")
       }
   }
   ```
2. Remove the old comment about "Save first, then claim" and the orphan warning

**Verification**: `cd /Users/eduardosanchez/repos/github.com/eduardosanzb/escribano/.claude/worktrees/mystifying-mcnulty && swift build -c release 2>&1 | head -20` should show no errors

**Rollback**: `git checkout -- apps/recorder/Sources/SessionAggregator.swift`

---

### WU-13: SessionAggregator Privacy-Safe Logging

**Dependencies**: WU-11, WU-12

**Context**: Lines 148 and 151 log raw `text_infer` response (and up to 500 chars on parse failures) to stdout. LLM responses can include sensitive screen content from prompts - privacy leak and log bloat.

**Files**:
- `apps/recorder/Sources/SessionAggregator.swift` — modify (lines 148, 151)

**Steps**:
1. Add a debug flag check at the top of the file (after imports, before the error enum):
   ```swift
   // Debug flag for SessionAggregator verbose logging (includes LLM responses)
   private let debugSA = ProcessInfo.processInfo.environment["ESCRIBANO_DEBUG_SA"] == "1"
   ```
2. Gate the verbose response logging on line 148:
   ```swift
   if debugSA {
       log("[SessionAggregator] text_infer complete: \(response.count) chars. Preview: \(response.prefix(120).replacingOccurrences(of: "\n", with: " "))")
   } else {
       log("[SessionAggregator] text_infer complete: \(response.count) chars")
   }
   ```
3. Gate the raw response logging on line 151:
   ```swift
   if parsed.isEmpty {
       if debugSA {
           log("[SessionAggregator] WARN: 0 groups parsed from text_infer response. Raw (first 500 chars): \(response.prefix(500).replacingOccurrences(of: "\n", with: "\\n"))")
       } else {
           log("[SessionAggregator] WARN: 0 groups parsed from text_infer response (set ESCRIBANO_DEBUG_SA=1 to see raw response)")
       }
   }
   ```

**Verification**: `cd /Users/eduardosanchez/repos/github.com/eduardosanzb/escribano/.claude/worktrees/mystifying-mcnulty && swift build -c release 2>&1 | head -20` should show no errors

**Rollback**: `git checkout -- apps/recorder/Sources/SessionAggregator.swift`

## Execution Plan

### Phase 1 — Parallel (no file dependencies)
All these work units touch different files and can run in parallel.

- WU-2: FrameStore markFrameFailed error handling
- WU-3: TopicBlockStore getUserVersion crash fix
- WU-4: ObservationStore connection leak fix
- WU-5: WorkQueue cancellation handler
- WU-6: Architecture.md documentation fix
- WU-7: Recorder commands unclaimed count filter
- WU-8: ObservationStore.port.swift comment update
- WU-9: ObservationStore magic timestamp documentation
- WU-10: FrameStore Sendable documentation

### Phase 2 — Sequential (SessionAggregator env validation)
This must complete before Phase 3 since Phase 3 modifies the same file.

- WU-1: SessionAggregator env var validation

### Phase 3 — Sequential (SessionAggregator data consistency & privacy)
These all modify SessionAggregator.swift and depend on Phase 2.

- WU-11: SessionAggregator orphan prevention - fallback path
- WU-12: SessionAggregator orphan prevention - main loop
- WU-13: SessionAggregator privacy-safe logging

## Recovery Strategy

- **Automatic**: Each implementor rolls back and retries once on failure.
- **Dependency failure**: If a work unit fails and later units depend on it, those later units will not run. The orchestrator will report which units were skipped.
- **Global rollback**: `git reset HEAD~N --hard` where N is the number of committed work units, or use `git revert` to undo individual WU commits non-destructively.
- **Independent failures**: Work units with no dependency on a failed unit will still execute.

## Verification Commands

After all phases complete, run these verification steps:

1. **Swift compilation**: `cd /Users/eduardosanchez/repos/github.com/eduardosanzb/escribano/.claude/worktrees/mystifying-mcnulty && swift build -c release`
2. **TypeScript linting**: `cd /Users/eduardosanchez/repos/github.com/eduardosanzb/escribano/.claude/worktrees/mystifying-mcnulty && pnpm biome check src/actions/recorder-commands.ts`
3. **Git diff summary**: `cd /Users/eduardosanchez/repos/github.com/eduardosanzb/escribano/.claude/worktrees/mystifying-mcnulty && git diff --stat`

## Notes

- All changes are in the existing worktree at `/Users/eduardosanchez/repos/github.com/eduardosanzb/escribano/.claude/worktrees/mystifying-mcnulty`
- The branch is already on `phase-3a-session-aggregation` and is clean
- Default values for env vars: minObservations=3, pollInterval=120.0, maxObsPerCycle=300, llmBatchSize=100
- The `ESCRIBANO_DEBUG_SA` env var is new and gates sensitive LLM response logging
