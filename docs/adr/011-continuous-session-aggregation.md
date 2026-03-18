# ADR-011: Continuous Session Aggregation

## Status

| State | Date | Details |
|---|---|---|
| Proposed | 2026-03-17 | Phase 3: continuous TopicBlock generation + time-range artifact queries |

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
│  │  2. Query: topic_blocks WHERE from_ts >= X AND to_ts <= Y    │            │
│  │  3. Generate: LLM → artifact markdown                        │            │
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

#### 2. Gap-Aware Windowing (no session boundary signal needed)

The aggregator doesn't need sleep/wake events, explicit "stop" buttons, or any session-end detection. It operates purely on observation timestamps:

```
Timeline:     9:00  9:05  9:10  ...  12:00  ─── 90 min gap ───  1:30  1:35  1:40
Observations: obs1  obs2  obs3       obs47                       obs48 obs49 obs50
                                        │                          │
                                  gap = 90 min > threshold (20 min)
                                        │                          │
                                        ▼                          ▼
TopicBlocks:  [═══════ TB-1: 9:00-12:00 ═══════]  [═══ TB-2: 1:30-1:40 ═══]
```

**Algorithm:**
```
1. SELECT * FROM observations WHERE tb_id IS NULL ORDER BY captured_at ASC
2. Walk through observations:
   - If gap between obs[i] and obs[i+1] > SESSION_GAP_THRESHOLD → commit window
   - If window has >= TB_MIN_OBSERVATIONS → write topic_block
3. UPDATE observations SET tb_id = ? WHERE id IN (claimed_ids)
```

**Why `captured_at` not `processed_at`:**

Backpressure can pause VLM processing for minutes. All those frames still carry the correct `captured_at` timestamp — when the screen was actually captured. The aggregator operates in historical-truth time, so backpressure pauses never create false session splits.

**Edge cases:**

| Scenario | Behavior |
|---|---|
| Continuous morning work | TBs flow every ~15 min, sized by activity continuity |
| Lunch break (1.5 hrs) | Gap > threshold → separate TB before/after |
| Next-day startup | 16-hour gap → separate TBs per day, auto-backfilled |
| Backpressure pause | `captured_at` is still correct → no false split |
| Machine sleep | Real gap in capture timestamps → correctly splits TBs |
| pHash skipping many frames (idle screen) | VLM bridge idle → good time for aggregator to batch |

**Backfill on startup**: When the aggregator starts, `WHERE tb_id IS NULL` naturally finds all historical unclaimed observations. Combined with gap-aware windowing, this produces correct TBs for every past work session — no special backfill code needed.

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

Both are safe because claiming observations is atomic (`UPDATE ... WHERE tb_id IS NULL`). No double-processing possible. If the background aggregator already processed everything, the on-demand flush is a no-op.

**Why this matters:** If the user runs `generate --today` at 3pm but the Swift aggregator last ran at 2:58pm, there might be 2 minutes of unclaimed observations. The flush catches them before querying TBs for the artifact. The user never sees stale data.

**The reverse case:** If the user requests an artifact and no TBs exist yet (aggregator hasn't run, or recorder just started), the flush-aggregate step in `generate` handles it — no dependency on the background process having run first.

#### 4. TopicBlock Content (no LLM, pure aggregation)

Each TopicBlock contains data already present in the observations from VLM analysis:

```
TopicBlock
┌──────────────────────────────────────────────────────────┐
│ id:                 "tb-2026-03-17-0900"                 │
│ from_ts:            1742216400.0  (9:00 AM)              │
│ to_ts:              1742227200.0  (12:00 PM)             │
│ activity:           "coding"  (mode of obs activities)   │
│ apps:               ["VS Code", "Terminal", "Chrome"]    │
│ topics:             ["API integration", "auth middleware"]│
│ observation_count:  47                                   │
│ classification:     { ... aggregated VLM descriptions }  │
└──────────────────────────────────────────────────────────┘
```

**No LLM call.** The `activity` is the statistical mode of observations in the window. `apps` and `topics` are unions. This keeps the aggregator fast (<1ms per TB) and model-free.

The LLM only runs at artifact generation time (Layer 3), when the user explicitly requests a standup/card/narrative.

#### 5. Small Machine Strategy (M1 Air 16GB)

Current model auto-detection from `model-detector.ts`:

| Machine | VLM (always-on) | LLM (on-demand) | Peak RAM |
|---|---|---|---|
| M4 Max 128GB | Qwen3-VL-2B-4bit (~2GB) | Qwen3-30B-A3B-8bit (~18GB) | ~20GB |
| M1 Air 16GB | Qwen3-VL-2B-4bit (~2GB) | Qwen3-4B-Instruct-4bit (~3GB) | ~5GB |

Sequential model swap via the Python bridge (`mlx_bridge.py`): VLM unloads → LLM loads → generates → LLM unloads → VLM reloads. Capture pauses during swap (~30-60s). Acceptable for on-demand artifact generation.

**POC: VLM-as-LLM (eliminating the swap entirely)**

Qwen3-VL is a vision-language model that also handles text-only generation. If the already-loaded VLM model can produce acceptable standup/card text from observation summaries, we skip loading any separate LLM on small machines — zero swap, zero pause, zero extra RAM.

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
   Swift    JPEG +    VLM runs   Grouped     Artifact   JPEG deleted,
   captures DB row    → obs      into TB     generated  DB rows kept
   screen             created    (tb_id set)             (audit trail)
```

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

CREATE INDEX idx_topic_blocks_time_range ON topic_blocks(from_ts, to_ts);
```

**Additive migrations only** — no data loss, existing topic_blocks from batch pipeline unaffected.

## New Files

```
apps/recorder/Sources/
├── SessionAggregator.swift                 -- actor: gap-aware windowing, periodic poll
├── TopicBlockStore.port.swift              -- port: write topic_blocks, query by time range
└── TopicBlockStore.sqlite.adapter.swift    -- adapter: SQLite implementation

db/migrations/016_session_aggregation.sql   -- schema additions
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
| `ESCRIBANO_SESSION_GAP_THRESHOLD` | `1200` (20 min) | Seconds of inactivity before starting new TopicBlock |
| `ESCRIBANO_TB_MIN_OBSERVATIONS` | `5` | Minimum observations to commit a TopicBlock |
| `ESCRIBANO_TB_POLL_INTERVAL` | `120` (2 min) | Seconds between aggregation polls in Swift actor |

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
- **LLM-free aggregation** — no model load for TB creation, fast (<1ms per TB)
- **Small-machine friendly** — VLM-as-LLM POC could eliminate the two-model split entirely

### Negative
- **TB quality depends on VLM output** — no LLM enrichment at aggregation time; if VLM descriptions are poor, TBs inherit that
- **Gap threshold requires tuning** — 20 min default may not fit all workflows (configurable via env var)
- **Dual-site aggregation** — same logic in Swift + Node.js (~50 lines of SQL + gap detection each); must stay in sync

### Neutral
- Batch pipeline (`--file` mode) unchanged — still uses `recording_id` path
- MCP server, Raycast, menu bar all deferred — unblocked by this ADR but not required
- Existing `activity-segmentation.ts` logic is a reference implementation for the Swift actor

## Alternatives Considered

| Alternative | Rejected Because |
|---|---|
| **Node.js watcher daemon** | Extra always-on process; Swift actor achieves same result with zero process overhead |
| **Session-end detection (sleep/wake via IOKit)** | Gap-aware windowing makes explicit session signals unnecessary; adds OS-level complexity |
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
| **Audio in recorder** | Always-on recorder currently captures visual only; audio capture (CoreAudio + VAD) deferred until visual pipeline proven |

## References

- [ADR-009: Always-On Recorder](009-always-on-recorder.md) — Phase 1 capture + Phase 2 VLM architecture
- [ADR-010: Swift-Native Visual Intelligence](010-swift-native-visual-intelligence.md) — Pivot to Python bridge, port/adapter pattern
- [ADR-005: VLM-First Visual Pipeline](005-vlm-first-visual-pipeline.md) — Activity segmentation logic, VLM-first rationale
- `src/utils/model-detector.ts` — Existing RAM-tier model selection
- `src/services/activity-segmentation.ts` — Segmentation logic to reuse/port to Swift
- `apps/recorder/Sources/FrameAnalyzer.swift` — Actor pattern to follow for SessionAggregator
