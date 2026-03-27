# ADR-011: Continuous Session Aggregation

## Status

| State | Date | Details |
|---|---|---|
| Proposed | 2026-03-17 | Phase 3: continuous TopicBlock generation + time-range artifact queries |
| Accepted (amended) | 2026-03-27 | Phase 3a implemented in PR #53. Layer 2 changed: LLM-based semantic grouping replaces pure gap-aware windowing. See Addendum. |

## Context

### Current State (After Phase 2)

Phases 1 and 2 established a continuous observation pipeline:

```
┌───────────────────────────────────────────────────────┐
│  Swift Recorder (always-on daemon)                    │
│                                                       │
│  StreamCapture ──► frames table ──► FrameAnalyzer ──► observations table
│                    (JPEG+pHash)      (VLM via bridge)  (activity, apps, topics)
└───────────────────────────────────────────────────────┘
```

Everything downstream — segmentation, TopicBlock creation, artifact generation — requires **manual CLI invocation**:

```bash
npx escribano              # process a Cap recording (video file)
npx escribano --file X     # process a video file
```

There is no bridge from the recorder's continuous observation stream to TopicBlocks or artifacts. The recorder produces observations, but nothing consumes them automatically.

### Problem

1. **Manual trigger required**: User must remember to run CLI after work sessions
2. **No time-range queries**: Artifacts are tied to a `recording_id`, not a time window
3. **No session concept for recorder**: Batch pipeline assumes discrete video files; the always-on recorder has no "recording" boundaries
4. **Two-model RAM pressure**: VLM (~2GB always loaded) + LLM (8-15GB on-demand) creates peak RAM issues on small machines (M1 Air 16GB)

### Opportunity

The key insight:

> "The constant Topic Block / Segment can be generated in Batches because [it] aggregates Observations on frames."

TopicBlocks should be generated **continuously in the background** — the same way observations are. Artifact generation becomes an **on-demand query over a time range**, decoupled from recording sessions entirely.

## Decision

### Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           LAYER 1: PERCEPTION (always-on)                    │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────┐            │
│  │  Swift Recorder Daemon                                       │            │
│  │                                                              │            │
│  │  ┌─────────────────┐    ┌────────────────┐                   │            │
│  │  │  StreamCapture   │    │  FrameAnalyzer  │                  │            │
│  │  │  • SCStream 1s   │    │  • Poll frames  │    ┌──────────┐ │            │
│  │  │  • pHash dedup   ├───▶│  • VLM batch   ├───▶│  Bridge   │ │            │
│  │  │  • Backpressure  │    │  • Write obs    │    │  (Python) │ │            │
│  │  └─────────────────┘    └────────────────┘    │  mlx-vlm  │ │            │
│  │        │                        │              └──────────┘ │            │
│  │        ▼                        ▼                           │            │
│  │   frames table           observations table                 │            │
│  └──────────────────────────────────────────────────────────────┘            │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│                        LAYER 2: AGGREGATION (periodic)                       │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────┐            │
│  │  SessionAggregator (Swift actor, in same daemon)             │            │
│  │                                                              │            │
│  │  • Polls observations WHERE tb_id IS NULL every 120s         │            │
│  │  • Gap-aware windowing (gap > 20min → new TopicBlock)        │            │
│  │  • Pure aggregation — NO LLM, NO model loading               │            │
│  │  • "Gets ahead of the user" — TBs ready before you ask       │            │
│  │                                                              │            │
│  │  observations table ──▶ topic_blocks table                   │            │
│  └──────────────────────────────────────────────────────────────┘            │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│                       LAYER 3: GENERATION (on-demand)                        │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────┐            │
│  │  Node.js CLI (not a daemon, invoked by user or agent)        │            │
│  │                                                              │            │
│  │  1. Flush: run aggregation on any unclaimed observations     │            │
│  │  2. Query: topic_blocks WHERE from_ts < Y AND to_ts > X  -- overlap       │
│  │  3. Group: VLM text-only prompt → Subjects                   │            │
│  │  4. Generate: model → artifact markdown                      │            │
│  │                                                              │            │
│  │  $ escribano generate --today --format standup               │            │
│  │  $ escribano generate --from 9am --to 12pm --format card     │            │
│  └──────────────────────────────────────────────────────────────┘            │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

#### 1. SessionAggregator as Swift actor (zero new process)

The aggregator lives inside the existing recorder daemon as a third async task alongside StreamCapture and FrameAnalyzer. Same SQLite connection, same process, zero extra RAM.

```
Swift Recorder Process
├── Task 1: StreamCapture       (frame producer)
├── Task 2: FrameAnalyzer       (observation producer)
└── Task 3: SessionAggregator   (TopicBlock producer)  ← NEW
```

Why Swift and not a separate Node.js daemon:
- **Zero new process** — no extra LaunchAgent plist, no extra RAM (~30MB saved)
- **Shared DB connection** — no WAL contention with a third writer
- **Same actor pattern** — follows established FrameAnalyzer design
- **Maintainability** — one daemon owns all always-on work; Node.js stays on-demand only

#### 2. LLM-Based Semantic Grouping (via shared VLM bridge)

The aggregator doesn't need sleep/wake events, explicit "stop" buttons, or any session-end detection. It operates purely on observation timestamps, using the VLM model's text backbone for semantic grouping:

```
Timeline:     9:00  9:05  9:10  ...  12:00  ─── 90 min gap ───  1:30  1:35  1:40
Observations: obs1  obs2  obs3       obs47                       obs48 obs49 obs50
                                         │                          │
                                   LLM groups by semantic          │
                                   similarity, not gaps             │
                                         │                          ▼
TopicBlocks:  [═════ TB-1: "Debugging pipeline" ═════]  [═ TB-2: "Code review" ═]
              [═══ TB-3: "Reading docs" ═══]            [═ TB-4: "Terminal" ════]
```

**Algorithm:**
```
1. fetchUnclaimed(limit: maxObsPerCycle) — WHERE tb_id IS NULL AND frame_id IS NOT NULL
2. if count < minObservations → sleep, continue
3. Split into sub-batches of llmBatchSize to keep prompts under ~3K tokens
4. For each sub-batch:
     a. buildGroupingPrompt(observations) — includes time, activity, apps, topics, VLM description
     b. textService.generateText(prompt, maxTokens: 4000) — via Python bridge text_infer
     c. parseGroupingResponse(response) → groups[] (label + observation IDs)
     d. If 0 groups parsed → fallback: single TB for entire sub-batch
5. For each group:
     a. Create TopicBlockInsert (id, from_ts, to_ts, label, apps, topics, observation_count)
     b. tbStore.save(block)
     c. obsStore.claimObservations(ids, tbId) — WHERE tb_id IS NULL guard prevents double-claim
6. Claim any unassigned observations → catch-all TB
7. sleep(pollInterval) if no TBs created; otherwise process next batch immediately
```

**Implementation note**: Gap-based windowing (`splitByGap`) was removed during development — the LLM prompt naturally handles activity boundaries and time gaps. Fragmenting small batches into gap-based windows caused a hot loop bug (100% CPU spin when windows fell below `minObservations`).

**Backfill on startup**: When the aggregator starts, `WHERE tb_id IS NULL` naturally finds all historical unclaimed observations. The LLM groups them semantically, producing correct TBs for every past work session — no special backfill code needed.

#### 3. Dual-Site Aggregation (background + on-demand flush)

The aggregation logic is callable from **two places**:

```
┌───────────────────────────┐     ┌──────────────────────────────────┐
│  Swift (background)       │     │  Node.js (on-demand)              │
│                           │     │                                   │
│  SessionAggregator actor  │     │  escribano generate --today       │
│  runs every 120s          │     │                                   │
│  "gets ahead of user"     │     │  Step 1: flush-aggregate          │
│                           │     │    (same SQL, same gap logic)     │
│  observations → TBs       │     │  Step 2: query TBs in range      │
│                           │     │  Step 3: LLM → artifact           │
└───────────────────────────┘     └──────────────────────────────────┘
         │                                      │
         └──────────── same SQLite DB ──────────┘
```

Both are safe because claiming observations is done atomically: we claim rows via a single `UPDATE` like `UPDATE observations SET tb_id = ? WHERE tb_id IS NULL AND id IN (...)` inside a transaction, and we check the number of rows updated before creating the `TopicBlock`. This `tb_id IS NULL` guard plus the rows-updated check prevents double-processing and avoids orphan `TopicBlock`s if two aggregators race. If the background aggregator already processed everything, the on-demand flush is a no-op.

**Why this matters:** If the user runs `generate --today` at 3pm but the Swift aggregator last ran at 2:58pm, there might be 2 minutes of unclaimed observations. The flush catches them before querying TBs for the artifact. The user never sees stale data.

**The reverse case:** If the user requests an artifact and no TBs exist yet (aggregator hasn't run, or recorder just started), the flush-aggregate step in `generate` handles it — no dependency on the background process having run first.

#### 4. TopicBlock Content (LLM-backed grouping via shared VLM bridge)

Each TopicBlock is created by an LLM grouping pass over the observations. The VLM model's text backbone (`text_infer` on the same Python bridge) groups observations by semantic similarity:

```
TopicBlock
┌──────────────────────────────────────────────────────────┐
│ id:                 "tb-2026-03-17-0900"                 │
│ from_ts:            1742216400.0  (9:00 AM)              │
│ to_ts:              1742227200.0  (12:00 PM)             │
│ label:              "MLX Pipeline Debugging"  (LLM)      │
│ activity:           "debugging"  (mode of obs activities) │
│ apps:               ["VS Code", "Terminal", "Chrome"]    │
│ topics:             ["API integration", "auth middleware"]│
│ observation_count:  47                                   │
│ classification:     { ... LLM-generated label + data }   │
└──────────────────────────────────────────────────────────┘
```

**LLM-backed grouping.** The VLM model groups observations into 1-6 semantic segments via a text-only prompt. Labels are generated by the LLM (e.g., "MLX Pipeline Debugging", "Code Review & Documentation"). The `activity` is the statistical mode of observations in the group. `apps` and `topics` are unions from VLM descriptions. The `text_infer` call reuses the already-loaded VLM model — zero extra RAM, same process, same socket.

Layer 3 still uses model-backed grouping, matching the current TypeScript pipeline: TopicBlocks are grouped into Subjects with a text-only prompt over the aggregated blocks. In this ADR, that grouping should use the already-loaded multimodal VLM path (Qwen3-VL / Qwen3.5), so there is no separate model swap just to build Subjects.

Artifact generation remains on-demand at Layer 3, when the user explicitly requests a standup/card/narrative.

#### 5. Small Machine Strategy (M1 Air 16GB)

Current model auto-detection from `model-detector.ts`:

| Machine | VLM (always-on) | LLM (on-demand) | Peak RAM |
|---|---|---|---|
| M4 Max 128GB | Qwen3-VL-2B-4bit (~2GB) | Qwen3-30B-A3B-8bit (~18GB) | ~20GB |
| M1 Air 16GB | Qwen3-VL-2B-4bit (~2GB) | Qwen3-4B-Instruct-4bit (~3GB) | ~5GB |

Sequential model swap via the Python bridge (`mlx_bridge.py`): VLM unloads → LLM loads → generates → LLM unloads → VLM reloads. Capture pauses during swap (~30-60s). Acceptable for on-demand artifact generation.

**POC: VLM-as-LLM (eliminating the swap entirely)**

Qwen3-VL is a vision-language model that also handles text-only generation. Subject grouping should already reuse this path. The remaining POC is whether the already-loaded VLM model can produce acceptable standup/card/narrative text from observation summaries, so we can skip loading any separate LLM on small machines — zero swap, zero pause, zero extra RAM.

```
POC scope:
1. Send text-only prompt to mlx_bridge.py --mode vlm (no images)
2. Prompt: same subject-grouping / artifact-generation prompt used today
3. Compare output quality vs Qwen3-4B-Instruct (current minimum LLM tier)
4. If pass → add "vlm-as-llm" fallback tier in model-detector.ts
```

This is the multimodal convergence path: one model for everything. On M1 Air 16GB, `Qwen3-VL-4B-4bit` (~4-5GB) stays loaded, handles both frame analysis and artifact generation. No model swap, no capture pause.

### Domain Model (Updated)

```
Frame                    Observation              TopicBlock
┌──────────────────┐     ┌──────────────────┐     ┌───────────────────────────┐
│ id               │     │ id               │     │ id                        │
│ display_id       │────▶│ frame_id (FK)    │────▶│ from_ts / to_ts           │
│ captured_at      │     │ tb_id (FK) NEW   │     │ activity_type             │
│ image_path       │     │ vlm_description  │     │ apps[] / topics[]         │
│ phash            │     │ activity_type    │     │ observation_count         │
│ analyzed (0/1/2) │     │ apps[]           │     │ classification (JSON)     │
└──────────────────┘     │ topics[]         │     └───────────┬───────────────┘
                         │ timestamp        │                  │
                         └──────────────────┘    (time-range query)
                                                               │
                                              Artifact         │
                                    ┌──────────────────┐       │
                                    │ id               │       │
                                    │ format           │◀──────┘
                                    │ from_ts / to_ts  │
                                    │ markdown         │
                                    │ created_at       │
                                    └──────────────────┘
```

**Key change from ADR-009 domain model:** The entity chain for the always-on recorder becomes:

```
Frame → Observation → TopicBlock → Artifact
                  (aggregated     (on-demand
                   by gap logic)   by time range)
```

No `recording_id`, no `segments` entity, no synthetic recordings for the recorder path. TopicBlocks are first-class, directly queryable by time range.

### Observation Lifecycle (Updated)

```
Captured → Stored → Analyzed → Aggregated → Consumed → Cleaned
   │          │         │           │            │          │
   Swift    JPEG +    VLM runs   Grouped     Artifact   JPEG retained
   captures DB row    → obs      into TB     generated  until batch cleanup,
                                                      DB rows kept
   screen             created    (tb_id set)             (audit trail)
```

### JPEG Retention Policy

JPEGs are kept after aggregation so they remain available for later processing, including OCR and other reanalysis. Cleanup happens in batches when disk usage crosses a configurable threshold, not immediately after a TopicBlock is consumed.

Proposed policy:
- Keep JPEGs on disk by default
- Trigger batch cleanup on disk pressure
- Delete oldest JPEGs first until usage returns below a lower-water mark
- Preserve database rows as the audit trail

## Schema Changes

Migration `016_session_aggregation.sql`:

```sql
-- Link observations to their TopicBlock
ALTER TABLE observations ADD COLUMN tb_id TEXT REFERENCES topic_blocks(id);
CREATE INDEX idx_observations_tb ON observations(tb_id);

-- Time-range columns on topic_blocks (first-class, not buried in JSON)
ALTER TABLE topic_blocks ADD COLUMN from_ts REAL;
ALTER TABLE topic_blocks ADD COLUMN to_ts REAL;
ALTER TABLE topic_blocks ADD COLUMN observation_count INTEGER DEFAULT 0;

-- Relax NOT NULL constraints so recorder-generated TopicBlocks do not
-- need a recording_id/context_ids. Existing ingest pipelines may still
-- populate these fields as before.
-- NOTE: In SQLite this is implemented via table recreation; this ADR
-- shows the logical effect of the migration:
-- ALTER TABLE topic_blocks ALTER COLUMN recording_id DROP NOT NULL;
-- ALTER TABLE topic_blocks ALTER COLUMN context_ids DROP NOT NULL;

CREATE INDEX idx_topic_blocks_time_range ON topic_blocks(from_ts, to_ts);
```

**Additive migrations only** — no data loss, existing topic_blocks from batch pipeline unaffected.  
Recorder-generated TopicBlocks are permitted to have `NULL` `recording_id`
and `context_ids`, relying instead on their time range and `tb_id`
linkage from observations. Pipelines that already write `recording_id` /
`context_ids` continue to do so unchanged.

## New Files

```
apps/recorder/Sources/
├── SessionAggregator.swift                 -- actor: LLM-based semantic grouping, periodic poll
├── TopicBlockStore.port.swift              -- port: write topic_blocks, query by time range
└── TopicBlockStore.sqlite.adapter.swift    -- adapter: SQLite implementation

migrations/016_session_aggregation.sql      -- schema additions
scripts/poc-vlm-as-llm/                     -- POC: VLM text-only generation quality test
```

## Modified Files

```
apps/recorder/Sources/main.swift            -- wire SessionAggregator task
src/actions/generate-summary-v3.ts          -- accept from_ts/to_ts, add flush-aggregate step
src/utils/model-detector.ts                 -- add vlm-as-llm fallback tier (post-POC)
BACKLOG.md                                  -- Phase 3 tasks, cleanup stale items
```

## New Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ESCRIBANO_TB_POLL_INTERVAL` | `120` (2 min) | Seconds between aggregation polls in Swift actor |
| `ESCRIBANO_TB_MIN_OBSERVATIONS` | `3` | Minimum observations to commit a TopicBlock |
| `ESCRIBANO_TB_MAX_OBS_PER_CYCLE` | `300` | Max observations processed per aggregation cycle |
| `ESCRIBANO_TB_LLM_BATCH_SIZE` | `100` | Observations per LLM sub-batch (keeps prompts small) |
| `ESCRIBANO_QUEUE_REALTIME_STREAK` | `10` | Max consecutive realtime tasks before normal task runs |
| `ESCRIBANO_JPEG_HIGH_WATER_GB` | `10` | Disk usage threshold that triggers JPEG cleanup (deferred) |
| `ESCRIBANO_JPEG_LOW_WATER_GB` | `5` | Disk target after JPEG cleanup (deferred) |

## Phased Rollout

| Phase | Scope | Notes |
|---|---|---|
| **POC: VLM-as-LLM** | Test text-only generation via existing VLM bridge | Validates small-machine strategy before committing |
| **3a: SessionAggregator** | Swift actor + schema migration + aggregation logic | Zero new process, background TB creation |
| **3b: Time-range generation** | `generate --today`, `--from/--to`, flush-aggregate | Decouples artifacts from recordings |
| **3c: MCP server** | `get_current_context()`, `get_work_summary()` | Deferred |
| **3d: Human surfaces** | Raycast extension, Swift menu bar | Deferred |

## Consequences

### Positive
- **Continuous TBs** — ready before user asks, background aggregation stays ahead
- **Time-range artifacts** — "give me the standup from this morning" without recording boundaries
- **Flush-on-demand** — `generate` never misses recent observations, even if aggregator hasn't caught up
- **Zero new process** — SessionAggregator is a Swift actor, not a separate daemon
- **LLM-backed aggregation** — groups observations semantically via the already-loaded VLM bridge text backbone; zero extra RAM, ~5s per batch of 30 observations
- **Model-backed subject grouping** — reuses the already-loaded multimodal VLM path, matching the current TS pipeline without a separate model swap
- **Small-machine friendly** — VLM-as-LLM POC could eliminate the two-model split entirely

### Negative
- **TB quality depends on VLM output** — no LLM enrichment at aggregation time; if VLM descriptions are poor, TBs inherit that
- **JPEGs stay on disk longer** — cleanup is deferred to batch disk-pressure policy so files remain available for OCR and future processing
- **Sub-batch LLM prompts** — large observation sets split into sub-batches of `llmBatchSize` to keep prompts under ~3K tokens; grouping quality may vary across sub-batches
- **Dual-site aggregation** — same logic in Swift + Node.js (~50 lines of SQL + gap detection each); must stay in sync

### Neutral
- Batch pipeline (`--file` mode) unchanged — still uses `recording_id` path
- MCP server, Raycast, menu bar all deferred — unblocked by this ADR but not required
- Existing `activity-segmentation.ts` logic is a reference implementation for the Swift actor

## Alternatives Considered

| Alternative | Rejected Because |
|---|---|
| **Node.js watcher daemon** | Extra always-on process; Swift actor achieves same result with zero process overhead |
| **Session-end detection (sleep/wake via IOKit)** | LLM-based grouping makes explicit session signals unnecessary; adds OS-level complexity |
| **LLM-enriched TBs** | Adds model load to aggregation path; LLM at artifact time is sufficient |
| **Reactive aggregation (trigger on VLM completion)** | Over-eager; periodic batching is simpler, allows pHash-idle windows to naturally batch |
| **Separate `segments` entity** | TopicBlocks already serve this role; extra entity adds schema complexity with no value |

## Deferred Decisions

| Topic | Reason |
|---|---|
| **MCP server** | Time-range CLI covers primary use case; MCP deferred until agent integration needed |
| **Raycast extension** | Unblocked by Phase 3b (reads artifacts dir); deferred until 3b ships |
| **Swift menu bar** | Natural extension of daemon; deferred until recorder is stable |
| **Multimodal convergence** | Contingent on VLM-as-LLM POC results; tracked as strategic bet |
| **Cross-recording queries** | Likely covered by time-range queries over TBs; revisit if semantic search needed |
| **JPEG OCR / reprocessing** | Enabled by retained JPEGs; cleanup policy keeps them available until disk pressure requires removal |
| **Audio in recorder** | Always-on recorder currently captures visual only; audio capture (CoreAudio + VAD) deferred until visual pipeline proven |

## References

- [ADR-009: Always-On Recorder](009-always-on-recorder.md) — Phase 1 capture + Phase 2 VLM architecture
- [ADR-010: Swift-Native Visual Intelligence](010-swift-native-visual-intelligence.md) — Pivot to Python bridge, port/adapter pattern
- [ADR-005: VLM-First Visual Pipeline](005-vlm-first-visual-pipeline.md) — Activity segmentation logic, VLM-first rationale
- `src/utils/model-detector.ts` — Existing RAM-tier model selection
- `src/services/activity-segmentation.ts` — Segmentation logic to reuse/port to Swift
- `apps/recorder/Sources/FrameAnalyzer.swift` — Actor pattern to follow for SessionAggregator

## Addendum: Layer 2 Implementation Reality (2026-03-27)

### What Changed

The original ADR specified Layer 2 (SessionAggregator) as **"Pure aggregation — NO LLM, NO model loading"** with gap-aware windowing using `SESSION_GAP_THRESHOLD` (20 min default). The actual implementation (PR #53) replaced this with **LLM-based semantic grouping**:

| ADR-011 Design | Actual Implementation (PR #53) |
|---|---|
| Gap-aware windowing splits by time gaps | LLM reads observation descriptions, groups semantically |
| `SESSION_GAP_THRESHOLD` (20 min) for splits | Gap windowing removed (`splitByGap()` deleted as redundant) |
| Activity = statistical mode of observations | Activity = LLM-assigned label from semantic analysis |
| No model loading, <1ms per TB | Uses `text_infer` via Python bridge (reuses loaded VLM) |
| Pure aggregation from VLM outputs | Semantic understanding of observation descriptions |

### Why the Change

Pure gap-aware windowing produced correct time boundaries but poor semantic labels. The VLM descriptions alone (activity type as statistical mode) couldn't distinguish meaningful work sessions — e.g., "coding in VS Code" appearing across multiple unrelated tasks would merge into one block. LLM grouping reads the actual descriptions and produces contextually meaningful TopicBlock labels like "API authentication implementation" vs "CI pipeline debugging."

### Architecture Impact

- **WorkQueue actor** serializes bridge access: `FrameAnalyzer` submits at `.realtime` priority, `SessionAggregator` at `.normal`. Configurable via `ESCRIBANO_QUEUE_REALTIME_STREAK` (default 10).
- **Sub-batching**: Large observation sets are split into batches of `ESCRIBANO_TB_LLM_BATCH_SIZE` (default 100) per LLM call.
- **Fallback**: On LLM parse failure, creates a single catch-all TopicBlock for the batch.
- **`ESCRIBANO_SESSION_GAP_THRESHOLD` deprecated** — no longer used. Grouping is purely semantic.

### New Environment Variables (from PR #53)

| Variable | Default | Description |
|---|---|---|
| `ESCRIBANO_TB_POLL_INTERVAL` | `120` | Seconds between aggregation polls |
| `ESCRIBANO_TB_MIN_OBSERVATIONS` | `3` | Min observations to trigger aggregation (was 5 in ADR) |
| `ESCRIBANO_TB_MAX_OBS_PER_CYCLE` | `300` | Max observations processed per cycle |
| `ESCRIBANO_TB_LLM_BATCH_SIZE` | `100` | Observations per LLM sub-batch |
| `ESCRIBANO_QUEUE_REALTIME_STREAK` | `10` | Max consecutive realtime tasks before yielding to normal priority |
