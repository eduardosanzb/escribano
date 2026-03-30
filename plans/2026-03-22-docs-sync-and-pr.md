# Plan: Docs Sync + PR Update

**Date**: 2026-03-22
**Status**: ABANDONED (superseded by new work)

## Context

Phase 3a (SessionAggregator) is implemented and validated. The recorder pipeline runs 3 concurrent
tasks (StreamCapture, FrameAnalyzer, SessionAggregator) with a shared WorkQueue. The hot loop bug
is fixed, protocols are split cleanly, and thread safety is ensured via dedicated SQLite connections.

However, 7 documentation files are out of date — they reference removed features (gap-aware
windowing, `ESCRIBANO_SESSION_GAP_THRESHOLD`), wrong defaults (`minObservations=5` instead of 3),
missing env vars, and stale architecture descriptions. PR #53 exists as a draft and needs updating.

## Scope

- Work units: 2
- Execution phases: 1 (sequential — docs first, then PR)
- Files modified: 7 docs files updated, 1 PR updated

---

## WU-1: Update Documentation (7 files)

### 1. `BACKLOG.md` — Mark Phase 3a complete

**Lines 96-103**: Mark all Phase 3a sub-tasks as `[x]` complete. Remove references to
`ESCRIBANO_SESSION_GAP_THRESHOLD` and gap-aware windowing. Fix `minObservations` default from 5 to 3.
Add `ESCRIBANO_TB_LLM_BATCH_SIZE` (100) and `ESCRIBANO_TB_MAX_OBS_PER_CYCLE` (300).

### 2. `CLAUDE.md` — Add missing recorder env vars

**Lines 123-128**: Add to the Recorder env vars section:
- `ESCRIBANO_TB_POLL_INTERVAL` — Seconds between SessionAggregator polls (default `120`)
- `ESCRIBANO_TB_MIN_OBSERVATIONS` — Minimum observations to trigger aggregation (default `3`)
- `ESCRIBANO_TB_MAX_OBS_PER_CYCLE` — Max observations per aggregation cycle (default `300`)
- `ESCRIBANO_TB_LLM_BATCH_SIZE` — Observations per LLM sub-batch (default `100`)
- `ESCRIBANO_QUEUE_REALTIME_STREAK` — Max consecutive realtime tasks before normal task runs (default `10`)

**Lines 485-532 (architecture section)**: Update the recorder architecture description from
"Two Concurrent Async Tasks" to "Three Concurrent Async Tasks" (StreamCapture, FrameAnalyzer,
SessionAggregator). Mention the shared WorkQueue and TextGenerationService port.

### 3. `docs/architecture.md` — Add missing ports + update recorder section

**Lines 363-367 (ports table)**: Add rows:
- `TopicBlockStore` / `SQLiteTopicBlockStore.swift` — TopicBlock persistence
- `TextGenerationService` / `PythonBridge.vlm.adapter.swift` — Text generation via VLM bridge
- `SessionAggregator` / `SessionAggregator.swift` — LLM-based observation grouping actor
- `WorkQueue` / `WorkQueue.swift` — Priority queue serializing bridge access

**Lines 485-532 (recorder architecture)**: Update from "Two Concurrent Async Tasks" to
"Three Concurrent Async Tasks". Add SessionAggregator as Task 3. Update the Frame Lifecycle
diagram to include SessionAggregator → TopicBlocks step.

**Lines 628-650 (Swift adapter pattern)**: Update protocol signatures to match actual code:
- `FrameStore` has `insertFrame()`, `pendingFrameCount()`, `claimFrames()`, `markFramesAnalyzed()`, `markFrameFailed()`, `close()`
- `ObservationStore` has `saveObservations()`, `fetchUnclaimed()`, `claimObservations()`, `close()`
- `SQLiteFrameStore` is a `final class` (not actor), `SQLiteObservationStore` is an `actor`

### 4. `docs/adr/011-continuous-session-aggregation.md` — Fix design divergence

**Lines 121-166 (Gap-Aware Windowing section)**: Replace with "LLM-Based Semantic Grouping"
describing how the aggregator sends observations to `text_infer` for grouping via sub-batches.

**Line 210**: Fix "No LLM call" claim — the implementation DOES use LLM for semantic grouping.

**Line 377**: Fix "LLM-free aggregation" — change to "LLM-backed aggregation via shared VLM bridge."

**Lines 354-358 (env vars table)**: Remove `ESCRIBANO_SESSION_GAP_THRESHOLD`. Fix
`ESCRIBANO_TB_MIN_OBSERVATIONS` default from 5 to 3. Add `ESCRIBANO_TB_MAX_OBS_PER_CYCLE` (300)
and `ESCRIBANO_TB_LLM_BATCH_SIZE` (100).

### 5. `docs/plans/phase3a-implementation.md` — Resolve merge conflicts + update

**Lines 640-658**: Resolve merge conflict markers. Remove `ESCRIBANO_SESSION_GAP_THRESHOLD`
references. Remove `splitByGap()` code samples. Fix `minObservations` default to 3.
Update env var names to match implementation.

### 6. `README.md` — Update roadmap + recorder section

**Line 414**: Change "Always-on recorder — Phase 3 (auto artifact generation from live sessions)"
from `[ ]` to `[x]` with note "(Phase 3a: SessionAggregator creates TopicBlocks from live observations)".

**Lines 276-279 (What's next)**: Update to reflect that SessionAggregator is done. Remaining
"what's next" items: time-range artifact generation (`npx escribano generate --today`), MCP server.

### 7. `apps/recorder/README.md` — Already up to date

No changes needed. This file was created in WU-3 and correctly documents the current state.

---

## WU-2: Update PR #53

**PR**: https://github.com/eduardosanzb/escribano/pull/53
**Current state**: DRAFT

### Actions:
1. Update PR title if needed
2. Write proper PR description covering all changes
3. Mark as ready for review (remove draft status)

### PR Description Template:

```markdown
## Summary

- Fix SessionAggregator hot loop (100% CPU spin on small observation batches)
- Split ObservationStore into two clean protocols (FrameStore + ObservationStore)
- Add dedicated SQLite connection for FrameAnalyzer (thread safety)
- Create recorder README documenting architecture and dataflow
- Sync all documentation with implementation state

## Changes

### Hot Loop Fix (SessionAggregator)
- Removed `splitByGap()` gap-windowing logic — the LLM prompt already handles activity boundaries
- Simplified `aggregateLoop()` to process all unclaimed observations as one batch
- Lowered `minObservations` default from 5 to 3 to prevent observation starvation
- Added explicit sleep when no TopicBlocks are created (prevents CPU spin)

### Protocol Split (FrameStore / ObservationStore)
- Moved `claimFrames()`, `markFramesAnalyzed()`, `markFrameFailed()` from `ObservationStore` to `FrameStore`
- `FrameStore` now owns frame lifecycle; `ObservationStore` owns observation lifecycle only
- `FrameAnalyzer` uses dedicated `analyzerFrameStore` connection (thread safety — separate from @MainActor callers)
- `SQLiteFrameStore` is a class with sync methods; `SQLiteObservationStore` remains an actor

### Documentation
- Created `apps/recorder/README.md` — architecture, dataflow, file reference, config, build instructions
- Updated `BACKLOG.md` — Phase 3a marked complete
- Updated `CLAUDE.md` — added missing recorder env vars, updated architecture description
- Updated `docs/architecture.md` — added missing ports, updated recorder section
- Updated `docs/adr/011-continuous-session-aggregation.md` — fixed gap-aware windowing divergence
- Updated `README.md` — roadmap reflects Phase 3a completion

## Validation

- `swift build -c release` passes on all commits
- Pipeline validated live: 3 aggregation cycles, 13 TopicBlocks created from 54 observations
- Data integrity verified: 14,107 analyzed frames = 14,107 observations (100% match)
- Hot loop fix confirmed: aggregator correctly sleeps when < 3 unclaimed observations
```

---

## Execution Plan

1. WU-1: Update all 7 documentation files (sequential edits)
2. WU-2: Update PR #53 via `gh pr ready` + `gh pr edit`

## Recovery

- Each doc edit is independently revertable
- PR can be re-drafted with `gh pr ready 53 --undo`
