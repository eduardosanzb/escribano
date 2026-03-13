# ADR-009: Always-On Screen Recorder

## Status

Proposed (2026-03-12) | Updated (2026-03-12) — Blocking issues resolved, concurrency & schema refined via research spike | **Accepted (2026-03-12) — Phase A (SCScreenshotManager) + Phase B (SCStream) both validated; SCStream confirmed as Phase 1 capture API** | Revised (2026-03-12) — Backpressure, LaunchAgent terminology, segment semantics, and tech debt annotations added per architectural review

## Context

### Current State
- Escribano processes pre-recorded video files (Cap, QuickTime, MP4)
- Pipeline: Video file → FFmpeg frame extraction → scene detection → VLM → observations → artifact
- Depends on external capture tools
- No way to "always capture" — user must remember to start/stop recording

### Problem

1. **External dependency**: Capture relies on third-party tools (Cap, QuickTime)
2. **Post-hoc processing**: Video files require expensive FFmpeg frame extraction + scene detection
3. **No multi-monitor**: Video files capture a single display
4. **Always-on impossible**: Can't run continuous capture without owning the recorder
5. **6K reliability**: FFmpeg MJPEG encoder fails on retina displays >4096px

### Opportunity

Owning the capture layer transforms Escribano from a batch video processor into a **streaming work memory system**:
- Capture screenshots directly (skip FFmpeg frame extraction entirely)
- Multi-monitor from day one (ScreenCaptureKit supports all displays)
- Always-on recording with intelligent deduplication
- Agent-native: structured observations available as VLM processes them

## Decision

Build an always-on screen capture process using **Swift ScreenCaptureKit**, managed as a **macOS LaunchAgent** (user-session process, not a root LaunchDaemon), with three independent processes communicating through SQLite.

> **Critical constraint**: ScreenCaptureKit requires TCC `kTCCServiceScreenCapture` permission, which is only grantable to processes running in a user session. LaunchDaemons (root, outside user session) cannot receive this grant — Apple explicitly blocks screen capture from daemons. The capture process **must** be a LaunchAgent. This has been validated in the POC spike (see `docs/SCREENCAPTUREKIT-POC-SPIKE.md`), though LaunchAgent-specific TCC behavior (as opposed to interactive terminal) remains to be validated in Phase 1.

### Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         SQLite (WAL mode)                            │
│                                                                      │
│  ┌──────────┐  ┌──────────────┐  ┌──────────┐  ┌─────────────────┐  │
│  │  frames   │  │ observations │  │ segments │  │ subjects/       │  │
│  │          │  │              │  │          │  │ artifacts       │  │
│  └────▲─────┘  └──────▲───────┘  └────▲─────┘  └───────▲─────────┘  │
│       │               │               │                │            │
└───────┼───────────────┼───────────────┼────────────────┼────────────┘
        │               │               │                │
   ┌────┴──────┐   ┌────┴───────┐  ┌────┴────────────────┴───────┐
   │  Swift    │   │   Node     │  │       CLI / Menu Bar         │
   │  Capture  │   │   Batch    │  │                              │
   │  Daemon   │   │   Analyzer │  │  • Segment + generate       │
   │           │   │            │  │  • Manual time range cut     │
   │ • Screenshot  │ • Poll DB  │  │  • Confirm suggested breaks  │
   │   every Ns    │ • VLM when │  │  • Format selection          │
   │ • pHash       │   threshold│  └──────────────────────────────┘
   │   dedup       │   reached  │
   │ • Write       │ • Write    │
   │   frames      │   obs      │
   └───────────────┘ └──────────┘
```

**Three processes, one shared database:**

1. **Swift Capture Process** (LaunchAgent) — Always-on, auto-starts on login via launchd LaunchAgent plist. Captures screenshots at configurable intervals, deduplicates via perceptual hash, writes JPEG + DB row. Implements backpressure: pauses capture when unanalyzed frame count exceeds a configurable high-water mark (see Backpressure section below).
2. **Node Batch Analyzer** — Polls `frames` table (Phase 1–2: via launchd `StartInterval`; future: push-based trigger from capture process). When unanalyzed frame count exceeds a configurable threshold (e.g., 20 frames), triggers VLM batch analysis. Writes observations.
3. **CLI / Menu Bar** — User-triggered. Runs activity segmentation on observations, suggests natural breaks, user confirms/adjusts, generates artifact.

> **Note on "daemon" terminology**: Throughout this document, "capture process" or "capture LaunchAgent" refers to the Swift process managed by launchd. We avoid the term "daemon" because in launchd terminology, a LaunchDaemon runs as root outside the user session — which is incompatible with ScreenCaptureKit's TCC requirements. The capture process is a LaunchAgent (runs in user session).

### Domain Model

```
Frame                    Observation              Segment
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────────────┐
│ id               │     │ id               │     │ id                       │
│ display_id       │────▶│ frame_id (FK)    │────▶│ recording_id (FK)        │
│ captured_at      │     │ vlm_description  │     │ start_time / end_time    │
│ image_path       │     │ activity_type    │     │ activity_type            │
│ phash            │     │ apps[]           │     │ observations[] (FK)      │
│ analyzed (0/1/2) │     │ topics[]         │     │ apps[] / topics[]        │
│ width / height   │     │ timestamp        │     │ classification (JSON)    │
└──────────────────┘     └──────────────────┘     └──────────┬───────────────┘
                                                              │
                                          Subject             │     Artifact
                                ┌──────────────────┐          │  ┌──────────────────┐
                                │ id               │◀─────────┘  │ id               │
                                │ title            │             │ format           │
                                │ segments[]       │────────────▶│ markdown         │
                                │ total_duration   │             │ subject_ids (FK) │
                                └──────────────────┘             │ created_at       │
                                                                 └──────────────────┘
```

**Key simplification**: TopicBlock is absorbed by Segment (now persisted to DB). The entity chain becomes:

```
Frame → Observation → Segment → Subject → Artifact
```

### Multi-Display + Subject Grouping

Frames from different displays at the same timestamp produce separate Observations and Segments. Subject grouping (LLM) merges related segments across displays into a unified work thread:

```
Display 1 (Code Editor)            Display 2 (Browser)
┌─────────────┬──────────────┐     ┌─────────────┬──────────────┐
│ Frame 10:00 │ Frame 10:10  │     │ Frame 10:00 │ Frame 10:10  │
│  VS Code    │  VS Code     │     │  MDN Docs   │  Stack Ovfl  │
└──────┬──────┴──────┬───────┘     └──────┬──────┴──────┬───────┘
       │             │                    │             │
       ▼             ▼                    ▼             ▼
  Obs: coding    Obs: coding         Obs: research  Obs: research
       │             │                    │             │
       └──────┬──────┘                    └──────┬──────┘
              ▼                                  ▼
     Segment: "coding               Segment: "research
      in VS Code, 20min"             on MDN/SO, 20min"
              │                                  │
              └──────────────┬───────────────────┘
                             ▼
                   Subject: "API Integration"
                   (LLM groups by semantic thread)
```

### Frame Lifecycle

```
Captured → Stored → Analyzed → Segmented → Consumed → Cleaned
   │          │         │          │           │          │
   Swift    JPEG +    VLM runs   Grouped    Artifact   JPEG deleted,
   captures DB row    → Obs      into       generated  DB row kept
   screenshot         created    Segments              (audit trail)
```

### Concurrency Model

SQLite WAL mode handles multi-process coordination using **single-writer/multi-reader semantics** plus atomic row-claim updates to prevent analyzer storms:

**Process roles:**
- **Swift daemon**: Continuous writer (INSERT frames)
- **Node analyzer**: Periodic reader+writer (SELECT claimable → INSERT observations)
- **CLI**: User-triggered reader+writer (SELECT observations → INSERT segments/subjects/artifacts)

**WAL concurrency facts & mitigations:**
- SQLite WAL allows one writer + multiple concurrent readers
- Multiple writers serialize (no parallel writes), but can hit `SQLITE_BUSY` without busy timeouts
- **Mitigation**: Set `pragma busy_timeout = 5000` on all connections (5 second retry)
- POSIX lock cancellation bug in SQLite <3.52.0 when `close()` happens mid-write
- **Mitigation**: Pin SQLite ≥3.52.0; prefer GRDB.swift (Swift) + better-sqlite3 (Node) which handle this
- Checkpoint starvation if readers hold WAL file indefinitely
- **Mitigation**: Enable `pragma wal_autocheckpoint = 1000` on all connections (automatic checkpoint every 1000 page writes; reserve `wal_checkpoint(RESTART)` for operational maintenance only)

**Analyzer concurrency guard** (prevents parallel VLM runs):
```sql
-- Analyzer atomically claims up to 20 unanalyzed frames in a deterministic order
UPDATE frames
  SET processing_lock_id = $analyzer_uuid,
      processing_started_at = datetime('now')
  WHERE rowid IN (
    SELECT rowid
    FROM frames
    WHERE analyzed = 0 AND processing_lock_id IS NULL
    ORDER BY rowid
    LIMIT 20
  );

-- Stale lock cleanup: after 10min of no progress, unlock (crashed analyzer recovery)
UPDATE frames
  SET processing_lock_id = NULL, processing_started_at = NULL
  WHERE processing_started_at < datetime('now', '-10 minutes')
    AND analyzed = 0
    AND processing_lock_id IS NOT NULL;
```

This prevents concurrent VLM invocations (MLX model can only load once) and race conditions on `analyzed` flag.

### Backpressure

The Swift capture process writes frames continuously. Without a safety valve, if the analyzer falls behind (MLX model fails to load, disk full, process crash), the frames table and disk grow unboundedly. At a 5s capture interval, this is 17,280 frames/day (~3.4 GB/day of JPEGs).

**Mechanism**: Before writing a new frame, the capture process periodically checks `SELECT COUNT(*) FROM frames WHERE analyzed = 0`:

- **High-water mark** (`ESCRIBANO_BACKPRESSURE_LIMIT`, default: 500 frames): When exceeded, capture pauses and logs `[Capture] Paused: analyzer backlog exceeds {limit} unanalyzed frames`.
- **Low-water mark** (20% of high-water, i.e., 100 frames by default): Capture resumes when unanalyzed count drops below this threshold.
- **Check frequency**: Every 10th capture (not every frame, to avoid per-frame DB reads).

This prevents silent disk accumulation while keeping the implementation simple. The check is a single indexed query against `idx_frames_analyzed`.

**Failure modes addressed:**
- Analyzer process not running → frames accumulate → capture pauses at 500
- Disk full → SQLite write fails → capture process logs error, does not crash (retry next interval)
- VLM model fails to load → analyzer exits without processing → frames accumulate → capture pauses

## Schema Additions

```sql
-- New table: raw captured frames
CREATE TABLE frames (
  id                    TEXT PRIMARY KEY,
  display_id            TEXT NOT NULL,
  captured_at           TEXT NOT NULL,        -- ISO 8601 (human-readable)
  timestamp             REAL NOT NULL,        -- Unix epoch (for joins with segments)
  image_path            TEXT NOT NULL,        -- JPEG on disk
  phash                 TEXT,                 -- perceptual hash (deduplication)
  width                 INTEGER,
  height                INTEGER,
  analyzed              INTEGER DEFAULT 0,    -- 0=pending, 1=complete, 2=failed
  processing_lock_id    TEXT,                 -- UUID of analyzer; NULL = available
  processing_started_at TEXT,                 -- SQLite datetime; NULL = not claimed
  retry_count           INTEGER DEFAULT 0,    -- Incremented on VLM failure
  failed_at             TEXT,                 -- SQLite datetime; set after max retries
  created_at            TEXT DEFAULT (datetime('now'))  -- SQLite datetime
);

CREATE INDEX idx_frames_analyzed ON frames(analyzed);
CREATE INDEX idx_frames_captured ON frames(timestamp);          -- for range queries
CREATE INDEX idx_frames_processing ON frames(processing_lock_id); -- unlock stale

-- Extend observations with frame FK
ALTER TABLE observations ADD COLUMN frame_id TEXT REFERENCES frames(id);
CREATE INDEX idx_observations_frame_id ON observations(frame_id);

-- Discriminator: observations with frame_id IS NULL originate from the video file pipeline
-- (process-recording-v3.ts); observations with frame_id IS NOT NULL originate from the
-- recorder pipeline (batch analyzer). This is implicit — no explicit discriminator column needed.

-- New table: persisted segments (replaces in-memory segments + topic_blocks)
--
-- Immutability convention: Segments are append-only. Re-cutting (e.g., adjusting a time
-- range via `escribano cut`) creates NEW segment rows under a new synthetic recording.
-- Existing segments are never updated or deleted. This is enforced by application convention,
-- not database constraints. The `artifact_segments` join table ensures old artifacts continue
-- to reference their original segments even after re-cutting.
CREATE TABLE segments (
  id              TEXT PRIMARY KEY,
  recording_id    TEXT REFERENCES recordings(id),
  start_time      REAL NOT NULL,       -- Unix epoch (matches frames.timestamp range)
  end_time        REAL NOT NULL,       -- Unix epoch
  activity_type   TEXT NOT NULL,       -- 'coding', 'debugging', 'meeting', etc.
  apps            TEXT,                -- JSON array of app names
  topics          TEXT,                -- JSON array of detected topics
  classification  TEXT,                -- full JSON context (vlm descriptions, etc.)
                                       -- NOTE: For MVP, queries over classification use json_extract()
                                       -- with full table scan. If query performance becomes an issue,
                                       -- add SQLite generated columns with indexes:
                                       --   ALTER TABLE segments ADD COLUMN dominant_app TEXT
                                       --     GENERATED ALWAYS AS (json_extract(classification, '$.dominant_app')) STORED;
                                       --   CREATE INDEX idx_segments_app ON segments(dominant_app);
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_segments_recording ON segments(recording_id);
CREATE INDEX idx_segments_time_range ON segments(start_time, end_time);

-- Link segments to artifacts via `artifact_segments` join table (segment can appear in multiple artifacts)
CREATE TABLE artifact_segments (
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  segment_id  TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  PRIMARY KEY (artifact_id, segment_id)
);

CREATE INDEX idx_artifact_segments_segment ON artifact_segments(segment_id);
```

**Key changes from initial ADR:**
- `timestamp REAL` (Unix epoch) added for deterministic joins with segments
- `captured_at TEXT` kept for human readability
- `processing_lock_id` + `processing_started_at` for analyzer concurrency guard
- `retry_count` + `failed_at` for crash recovery and stale frame cleanup
- `consumed` flag removed from segments; instead, use join table `artifact_segments` (segment can appear in multiple artifacts)


## Blocking Issues & Resolutions

This section documents critical architectural questions resolved during the review spike (2026-03-12).

### 1. Discrete Recordings vs. Continuous Capture

**Issue**: The `segments` table references `recordings(id)`, but always-on recording has no discrete "recordings" — it's continuous capture. How do segments get a `recording_id`?

**Resolution**: **Synthetic recording per `cut` command**
- Each user invocation of `escribano cut` creates a `recordings` row with:
  - `source_type = 'recorder'` (distinguishes from video file source)
  - `video_path = NULL`
  - `captured_at = cut start time` (segment range start)
  - `duration = cut end time - cut start time`
- This maintains backward compatibility with existing artifact generation code (no changes to `generate-summary-v3.ts`)
- Segments always belong to a synthetic recording representing a user's work session

**Acknowledged tech debt**: The `recordings` entity was designed for video files (`video_path`, `duration` as an inherent property, `captured_at` as a single timestamp). Synthetic recordings repurpose this model with `video_path = NULL` and computed fields. The `source_type = 'recorder'` discriminator is the right approach, but downstream code must be aware that recorder-origin recordings have different semantics:
- `video_path` is always NULL (no video file exists)
- `duration` is computed from the cut range, not from a video file
- `captured_at` represents the range start, not a single capture timestamp

`generate-summary-v3.ts` only reads `id`, `duration`, and `captured_at` — so synthetic recordings work without code changes. The `process-recording-v3.ts` pipeline is not used for the recorder path at all.

**Post-MVP refactoring**: Consider splitting `recordings` into a proper union type or adding explicit columns for the recorder path (e.g., `cut_start`, `cut_end`) rather than overloading existing nullable fields. Track in BACKLOG.md cleanup section.

### 2. Analyzer Concurrency Guard

**Issue**: launchd with `StartInterval=120` spawns a new Node process every 2 minutes. If VLM analysis takes >120s, multiple analyzers run concurrently. MLX can only load one model at a time; race conditions on `analyzed` flag are inevitable.

**Resolution**: **Row-level locking via `processing_lock_id`**
- Analyzer atomically claims unanalyzed frames using UUID before starting VLM
- Protocol:
  1. `UPDATE frames SET processing_lock_id = $uuid WHERE analyzed = 0 AND processing_lock_id IS NULL LIMIT 20`
  2. Only process frames with matching `processing_lock_id` in local variable
  3. On completion: `UPDATE frames SET analyzed = 1 WHERE processing_lock_id = $uuid`
- Stale lock cleanup: `UPDATE frames SET processing_lock_id = NULL WHERE processing_started_at < datetime('now', '-10 minutes')` (crashed analyzer recovery)
- This prevents concurrent VLM invocations and ensures each frame is analyzed at most once

### 3. Timestamp Consistency

**Issue**: `frames.captured_at` is `TEXT` (ISO 8601), but `segments.start_time/end_time` are `REAL`. No consistent join key between them.

**Resolution**: **Add `timestamp REAL` to frames table**
- `frames.timestamp` = Unix epoch seconds (for deterministic joins)
- `frames.captured_at` = ISO 8601 (for human readability)
- `segments.start_time/end_time` = Unix epoch REAL (consistent with `observations.timestamp`)
- Joins: `SELECT segments.* FROM segments WHERE start_time <= frames.timestamp AND frames.timestamp < end_time`
- This aligns with existing pipeline's use of REAL timestamps for observations

### 4. Distribution Model

**Issue**: `npx escribano` is pure TypeScript. Adding a Swift binary requires a build/distribution strategy.

**Resolution**: **Dev-only Swift binary for MVP**
- Swift package built locally via `swift build` (requires Xcode Command Line Tools; bail gracefully if missing)
- Binary stored in `apps/recorder/` alongside source
- No npm distribution, no notarization — for development validation only
- Post-MVP: move to pre-built binaries + GitHub Releases when architecture is validated
- This defers the distribution complexity until the recorder itself is proven

### 5. SQLite WAL Concurrency Details

**Issue**: Initial ADR claimed "WAL mode supports one writer + multiple readers; no Redis needed." This is oversimplified.

**Resolutions applied**:
- **Busy timeout**: Set `pragma busy_timeout = 5000` on all connections (SQLite default is 0 = fail immediately on lock contention)
- **Lock cancellation bug**: Use SQLite ≥3.52.0 (fixes POSIX lock cancellation in `close()`)
- **Preferred libraries**: GRDB.swift (Swift) and better-sqlite3 (Node.js) both handle WAL robustly
- **Checkpoint strategy**: `pragma wal_autocheckpoint = 1000` (checkpoint every 1000 page writes) to prevent starvation
- This makes the WAL architecture practical for the three-process model

### 6. Analyzer Trigger Model (Polling vs. Push)

**Issue**: launchd `StartInterval=120` spawns a new Node process every 2 minutes. If VLM analysis exceeds 120s, overlapping analyzer processes exist simultaneously. The `processing_lock_id` guard prevents double-processing, but zombie processes waste memory.

**Resolution for MVP**: **Keep launchd polling** — At expected throughput (20 frames × ~0.7s VLM = ~14s), analysis completes well within the 120s window. The `processing_lock_id` guard handles edge cases. Overlapping processes are short-lived (they check for claimable frames, find none, and exit).

**Future direction (Phase 2+)**: Migrate to a push-based signal. The Swift capture process knows exactly when frames are written. Options in order of preference:
1. **Sentinel file + `fs.watch()`** — Capture process touches `~/.escribano/analyze-trigger` after writing N frames; a long-lived Node process watches it and kicks off analysis. Simplest, no IPC protocol needed.
2. **Long-lived Node process with DB polling** — Single Node process polls `frames WHERE analyzed = 0` every 5-10s. Eliminates launchd as analyzer dependency entirely.
3. **Unix domain socket** — Capture process sends a message to the analyzer. Most complex, most responsive.

This eliminates the overlapping-spawn problem and reduces memory overhead. Not blocking for MVP because the lock guard is sufficient.

## MVP Roadmap (Updated)

| Phase | Scope | Estimate |
|-------|-------|----------|
| **Spike: ScreenCaptureKit Feasibility** | Minimal Swift CLI proof-of-concept (LaunchAgent, no UI window, single frame capture). Validates LaunchAgent + TCC permission model + screenshot mode. **Complete.** | ~2-4h |
| **Spike: pHash Dedup Threshold** | 6-scenario POC testing pHash, dHash, VN FeaturePrint, SCFrameStatus across IDLE, CLOCK_TICK, CURSOR_BLINK, MOUSE_MOVE, TYPING, WINDOW_SWITCH. **Complete (2026-03-12)** — pHash threshold=8 validated. | ~4h |
| **1. Swift Capture Process** | SCStream capture loop, pHash dedup (threshold=8 — validated by POC), JPEG + SQLite write (with locking columns), **backpressure** (pause at high-water mark), LaunchAgent plist auto-start. Single display first. WAL pragmas. **Validate TCC in LaunchAgent context** (not just interactive terminal). | ~3-4 days |
| **2. Node Batch Analyzer** | Poll `frames` table with row-level locking, VLM batch on threshold, write observations with `frame_id` + index, mark frames analyzed. Reuses `vlm-service.ts`. Stale lock cleanup. | ~2-3 days |
| **3. Segmentation + CLI** | `capture.recorder.adapter.ts` (new CaptureSource), reuse `activity-segmentation.ts`, persist segments (append-only convention), synthetic recording creation with documented discriminator. `escribano cut` + `escribano analyze` commands. | ~2-3 days |
| **4. Menu Bar + Polish** | macOS menu bar status item (Swift, dev-only), frame cleanup cron, **JPEG orphan reconciliation**, disk quota warning, `escribano doctor` checks. | ~2-3 days |

## Consequences

### Positive
- **Always-on** — Never forget to capture work
- **Multi-monitor** — All displays captured natively via ScreenCaptureKit
- **No FFmpeg extraction** — Screenshots are already frames (skip video → frame step entirely)
- **Streaming-ready** — Observations available as VLM processes them
- **Agent-native** — Structured observations in DB, queryable by time range

### Negative
- **Two languages** — Swift capture + TypeScript analysis (more build complexity; deferred until validated)
- **Disk usage** — Continuous JPEG capture requires cleanup strategy (JPEG deleted after analysis, stale frame purge every 7 days)
- **macOS-only** — ScreenCaptureKit locks capture layer to Apple platforms (intentional, cross-platform deferred)
- **New entity** — `frames` table adds schema complexity (mitigated by clear FK chain: Frame → Observation → Segment)
- **ScreenCaptureKit daemon feasibility** — **Phase A (SCScreenshotManager) + Phase B (SCStream) + Phase C (pHash dedup) all validated (2026-03-12).** SCStream confirmed as the Phase 1 capture API; pHash threshold=8 confirmed as dedup signal. See `docs/SCREENCAPTUREKIT-POC-SPIKE.md` for full results, Swift 6 concurrency patterns, and build toolchain gotchas.

### Neutral
- SQLite WAL handles concurrency (no Redis/message queue)
- Existing VLM/LLM infrastructure unchanged (same MLX bridge)
- Current batch pipeline continues to work alongside recorder

---

## Deferred Decisions

| Topic | Reasoning |
|-------|-----------|
| **Audio capture** | Adds complexity (CoreAudio + VAD); defer until visual pipeline proven. Design schema for `audio_observations` table now; implement later. |
| **Multi-display capture** | Phase 1 targets single display; Phase 4 extends to all displays via `display_id` grouping |
| **Menu bar UI** | Phase 4 polish; dev-only status text in CLI for MVP |
| **OCR enrichment** | Add as post-VLM step triggered by activity type (coding → extract code). Not needed for MVP. |
| **Image embeddings (CLIP)** | Useful for similarity search but not needed for segmentation MVP |
| **Cloud offering** | Architecture is reusable (swap Swift for cloud capture) but defer to post-MVP |
| **Swift binary distribution** | Dev-only local build for MVP; GitHub Releases + pre-built binaries post-validation |
| **JPEG orphan reconciliation** | If analyzer crashes between disk write and DB commit, orphan JPEGs accumulate. Add a periodic reconciliation pass in Phase 4: walk `~/.escribano/frames/`, cross-reference against `frames.image_path WHERE analyzed = 1`, delete orphans. Low severity — the failure window is narrow and bounded by disk quota. |
| **Read model separation** | The "agent-native" query layer currently targets SQLite (time-range, activity type, app filters). If semantic search or vector similarity queries are needed, separate the write model (capture + analysis pipeline) from a read model (Postgres + pgvector, sqlite-vec). The current schema supports streaming observations to a separate read replica without restructuring the write path. Defer until query requirements are concrete. |
| **SQLite-as-IPC refactoring** | The `frames` table currently serves as storage, job queue, lock registry, and WIP tracker. This is acceptable at MVP throughput but if coordination logic grows complex (priority, throttling, complex retry), consider separating job lifecycle into a lightweight queue. The job columns (`processing_lock_id`, `processing_started_at`, `retry_count`) are cleanly separated from data columns and can be moved without touching the data schema. |
| **SCFrameStatus as dedup layer** | Validated in Phase C POC (2026-03-12). SCFrameStatus fires ~1% of frames at 1fps capture intervals — useless at 5s intervals. Designed for 30/60fps streaming where it can detect "no change since last frame." At 5s intervals, something on macOS always changes within the window. **Dropped from Phase 1.** |
| **VN FeaturePrint for dedup** | Validated in Phase C POC (2026-03-12). 4.5–6.5ms per frame on ANE vs ~0ms for pHash. Adds no value — pHash threshold=8 already cleanly separates noise from content. **Dropped from Phase 1.** |
| **dHash as primary dedup** | Validated in Phase C POC (2026-03-12). dHash is blind to clock ticks (max=0 hamming in CLOCK_TICK scenario) because it compares horizontal gradients which don't change for localized digit updates in a 9×8 resize. pHash's DCT captures low-frequency structure changes correctly. **Dropped from Phase 1.** |
| **Cross-platform capture (Windows/Linux)** | ScreenCaptureKit locks the Swift capture layer to Apple platforms. 30% of Escribano website visitors use Windows, representing a real future market. The Node.js analysis pipeline (VLM, segmentation, artifact generation) is already platform-agnostic. The correct architecture when Windows support is warranted: thin OS-specific `CaptureSource` adapters per platform — `capture.screencapturekit.adapter.swift` on macOS; `capture.winrt.adapter.cs` on Windows via the `Windows.Graphics.Capture` WinRT API — sharing the entire Node.js pipeline and SQLite coordination layer. The Swift LaunchAgent is not generalizable; replace it with a native equivalent per platform. Defer until macOS recorder is validated and Windows traffic converts to meaningful demand. |
| **Windows Task Scheduler (vs. launchd)** | macOS LaunchAgent manages capture + analyzer processes via plist registration. Windows equivalent is Task Scheduler (`schtasks.exe` / WinRT). The scheduler invocation is platform-specific, but the coordination layer (SQLite WAL concurrency, `processing_lock_id`, row-level claiming) is identical. When Windows capture is implemented, the Node.js analyzer will port directly; the Swift binary is replaced with a C# equivalent using `Windows.Graphics.Capture`. Track in BACKLOG.md as Phase 4+ work. |

## Alternatives Considered

| Alternative | Rejected Because |
|-------------|------------------|
| **Rust + scap** | Cross-platform but more build complexity; macOS-first doesn't need it |
| **FFmpeg screen capture** | No native multi-monitor; still requires post-processing |
| **Cap integration** | External dependency; doesn't solve always-on requirement |
| **Time-based VLM trigger** | Frame count threshold is more responsive to activity changes |
| **Redis for IPC** | Overkill; SQLite WAL handles the concurrency pattern |

## References

- [ADR-005: VLM-First Visual Pipeline](005-vlm-first-visual-pipeline.md)
- [ADR-006: MLX-VLM Intelligence Adapter](006-mlx-vlm-adapter.md)
- [ADR-008: MLX-LM Backend](008-mlx-lm-backend.md)
- [SQLite WAL Documentation](https://www.sqlite.org/wal.html) — Concurrency model, locking, checkpoint semantics
- [SQLite How to Corrupt](https://www.sqlite.org/howtocorrupt.html) — POSIX lock cancellation bug (fixed in 3.52.0), mitigation strategies
- [SQLite FAQ: Multiple Processes](https://www.sqlite.org/faq.html#q1) — Multi-process coordination patterns
- [GRDB.swift Concurrency](https://github.com/groue/GRDB.swift) — WAL mode + connection pooling for Swift
- [better-sqlite3 Performance](https://github.com/JoshuaWise/better-sqlite3/blob/master/docs/performance.md) — WAL mode + busy timeout configuration for Node.js
- [Apple ScreenCaptureKit Documentation](https://developer.apple.com/documentation/screencapturekit) — Daemon usage, permissions, API reference
- [Screen Capture Pipeline Design](../screen_capture_pipeline.md)
