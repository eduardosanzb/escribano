# ADR 015: Two-Layer Aggregation Model

## Status

Accepted

## Context

The original `SessionAggregator` used an LLM-based approach to group observations into TopicBlocks. In 42 hours of real-world use, it created **1,007 TopicBlocks**, of which **74% were under 30 seconds** — nearly useless for artifact generation. The system produced more noise than signal.

Three root causes drove the fragmentation:

1. **`minObservations` was an input gate, not a save gate.** The parameter controlled how many observations had to accumulate before the aggregator *started* an LLM cycle, but the LLM could still return 6 groups from 8 observations, each saved with a new UUID. Small groups sailed through.

2. **Plain INSERT with new UUIDs every cycle.** Each aggregation cycle created brand-new TopicBlocks with fresh UUIDs. There was no upsert logic — if the same activity spanned two polling intervals, two separate blocks were created.

3. **Catch-all fallback.** When the LLM returned malformed or empty JSON, the aggregator fell back to a catch-all group that dumped all remaining observations into a single block with no semantic value.

Additionally, the LLM-based approach consumed the Python VLM bridge every 120 seconds, requiring `InferenceQueue` access to coordinate with `FrameAnalyzer`. This blocked the aggregator whenever VLM inference was in progress and burned battery on continuous semantic analysis of what is essentially a streaming time-series problem.

## Decision

Adopt a **two-layer aggregation model** that separates real-time block formation from semantic analysis:

### Layer 1: Time-Based Heuristic (Real-Time, Swift)

A pure Swift actor that runs every 5 seconds and applies a **60-second gap heuristic**: if the time between the last observation in the current block and the next unclaimed observation exceeds 60 seconds, start a new block. Otherwise, upsert the existing block.

Key properties:
- **Zero ML/LLM cost.** Pure arithmetic (`obs.timestamp - latest.toTs <= 60.0`) plus SQL.
- **Upsert, not insert.** Uses `tbStore.fetchLatest()` + `tbStore.save()` to extend the most recent block rather than creating new UUIDs.
- **No Python bridge, no InferenceQueue.** The aggregator never touches the Unix socket. It only reads/writes SQLite.
- **Smart heuristic naming.** Block title = first observation's `apps` field (e.g., "Xcode, Terminal"). Block summary = first observation's `vlm_description`. Zero-cost, no LLM needed.
- **Fast polling.** 5-second poll interval (vs 120s LLM cycles) means blocks appear in the UI almost immediately.

### Layer 2: Semantic Grouping (On-Demand, LLM)

Higher-level semantic grouping happens **only** during artifact generation or explicit user/agent request. The `ArtifactGenerator` reads existing Layer 1 TopicBlocks and applies LLM-based grouping to produce a coherent narrative. This is the only path that touches the Python bridge for text generation.

### Data Flow

```
┌──────────────┐    ~1s frames    ┌───────────────┐
│   SCStream   │ ──────────────►  │  FrameStore   │
└──────────────┘    (writes)      │  (frames tbl) │
                                  └───────┬───────┘
                                          │ polls unanalyzed
                                          ▼
                                  ┌───────────────────┐
                                  │  FrameAnalyzer     │
                                  │  (VLM bridge)      │
                                  └───────┬───────────┘
                                          │ writes
                                          ▼
                                  ┌───────────────────┐
                                  │ ObservationStore   │
                                  │ (observations tbl) │
                                  └───────┬───────────┘
                                          │ polls unclaimed
                                          ▼
                                  ┌───────────────────┐
                                  │ SessionAggregator  │
                                  │ 60s gap heuristic  │
                                  └───┬───────────┬───┘
                                      │           │
                              fetchLatest     save
                          + upsert logic      ▼
                                      │  ┌────────────────┐
                                      └─►│ TopicBlockStore │
                                         │ (topic_blocks)  │
                                         └───────┬────────┘
                                                 │ reads blocks
                                                 ▼
                                      ┌─────────────────────┐
                                      │    Layer 2 (LLM)     │
                                      │ ArtifactGenerator    │
                                      │ (on-demand only)     │
                                      └─────────────────────┘
```

### Before vs After

| Aspect | OLD (LLM-Based) | NEW (Two-Layer) |
|--------|-----------------|-----------------|
| **Grouping method** | LLM semantic analysis every 120s | 60s gap heuristic every 5s |
| **Database operation** | Plain INSERT (new UUID each cycle) | UPSERT (extends existing block) |
| **Python bridge** | Required (sends observation batches) | Not used by Layer 1 |
| **InferenceQueue** | Required (coordinates bridge access) | Not needed (pure arithmetic + SQL) |
| **Battery cost** | Continuous LLM inference | Zero ML cost in real-time path |
| **Poll interval** | 120s (waiting for LLM batches) | 5s (fast SQL queries) |
| **TopicBlocks in 42h** | 1,007 (74% under 30s) | Expected: ~50–100 meaningful blocks |
| **Fallback on failure** | Catch-all dump group | N/A (no LLM to fail) |
| **Block naming** | LLM-generated titles | First observation's `apps` field |
| **Semantic grouping** | Baked into real-time path | On-demand during artifact gen |

### Why InferenceQueue Was Removed

The old aggregator sent batches of observations to the Python VLM bridge over Unix sockets for semantic grouping. Because the bridge is a shared resource (also used by `FrameAnalyzer`), the aggregator needed `InferenceQueue` to coordinate access — queuing its requests behind VLM inference and respecting realtime streak limits.

The new aggregator is pure arithmetic (`obs.timestamp - latest.toTs <= 60.0`) and SQL (`fetchLatest`, `save`, `claimObservations`). It never calls the Python bridge, never sends data over Unix sockets, and never competes for inference resources. `InferenceQueue` is no longer needed. The `queue` parameter was kept in the init signature temporarily for API compatibility but is never referenced.

### Smart Heuristic Naming

Rather than running an LLM to generate block titles, the aggregator uses data already available in the observation:

- **Title**: The first observation's `apps` array, joined with commas (e.g., "Xcode, Terminal"). This gives an immediate, useful label at zero cost.
- **Summary**: The first observation's `vlm_description` — the description the VLM already generated during frame analysis.

This approach leverages work already done by the VLM pipeline, avoiding redundant computation.

## Migration Strategy

### TopicBlockMigrator

A `TopicBlockMigrator` runs on app launch to handle the transition from old LLM-based blocks to new heuristic blocks:

1. **Gate**: Checks `UserDefaults.standard.bool(forKey: "hasRun60sMigration")`. If `true`, skips entirely.
2. **Wipe**: Deletes all existing TopicBlocks (old LLM-generated fragments).
3. **Unclaim**: Resets all observation `topic_block_id` fields to `NULL`.
4. **Rebuild**: Walks through all observations in chronological order, applying the 60s gap rule to reconstruct clean blocks.
5. **Mark**: Sets `hasRun60sMigration = true` in UserDefaults.

This is a one-time migration. After the first launch post-update, the heuristic aggregator takes over and the migrator never runs again.

## Consequences

### Positive

- **Battery savings.** Eliminates continuous LLM inference from the real-time path. The Python bridge only activates during on-demand artifact generation.
- **Clean blocks.** 60s gap heuristic produces semantically coherent blocks (one per continuous work session) instead of hundreds of 10–20 second fragments.
- **Fast real-time UI.** 5-second polling means new TopicBlocks appear in the menu bar almost instantly, not 2 minutes later.
- **Simpler architecture.** No bridge coordination, no InferenceQueue dependency, no LLM failure modes in the real-time path.
- **Layer 2 is on-demand only.** Semantic grouping happens when the user actually needs it (artifact generation), not speculatively every 2 minutes.

### Negative

- **No real-time semantic refinement.** Blocks are formed purely on time gaps. A 10-minute coding session followed by a 5-minute Slack break with no gap will be one block. Layer 2 (artifact generation) must handle this splitting.
- **Migration required.** Existing TopicBlocks are wiped and rebuilt. Any downstream data referencing old block IDs will be orphaned.
- **Fixed 60s threshold.** The gap heuristic is not adaptive. Users with very fast context-switching workflows may find blocks too large; users with slow workflows may find them too small. The threshold could be made configurable in a future iteration.

## References

- [BACKLOG.md](/BACKLOG.md) — Phase 3b: Integrated Artifact Generation
- `apps/recorder/Sources/SessionAggregator.swift` — Implementation
- `apps/recorder/Sources/TopicBlockMigrator.swift` — Migration logic
