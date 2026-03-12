# ADR-009: Always-On Screen Recorder

## Status

Proposed (2026-03-12) | Updated (2026-03-12) — Blocking issues resolved, concurrency & schema refined via research spike

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

Build an always-on screen capture daemon using **Swift ScreenCaptureKit** with three independent processes communicating through SQLite.

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

1. **Swift Capture Daemon** — Always-on, auto-starts on login (launchd). Captures screenshots at configurable intervals, deduplicates via perceptual hash, writes JPEG + DB row.
2. **Node Batch Analyzer** — Polls `frames` table. When unanalyzed frame count exceeds a configurable threshold (e.g., 20 frames), triggers VLM batch analysis. Writes observations.
3. **CLI / Menu Bar** — User-triggered. Runs activity segmentation on observations, suggests natural breaks, user confirms/adjusts, generates artifact.

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

-- New table: persisted segments (replaces in-memory segments + topic_blocks)
-- Segments are immutable; multiple artifacts can reference the same segment
CREATE TABLE segments (
  id              TEXT PRIMARY KEY,
  recording_id    TEXT REFERENCES recordings(id),
  start_time      REAL NOT NULL,       -- Unix epoch (matches frames.timestamp range)
  end_time        REAL NOT NULL,       -- Unix epoch
  activity_type   TEXT NOT NULL,       -- 'coding', 'debugging', 'meeting', etc.
  apps            TEXT,                -- JSON array of app names
  topics          TEXT,                -- JSON array of detected topics
  classification  TEXT,                -- full JSON context (vlm descriptions, etc.)
  created_at      TEXT DEFAULT (datetime('now'))
);

-- Link segments to artifacts via `artifact_segments` join table (segment can appear in multiple artifacts)
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

## MVP Roadmap (Updated)

| Phase | Scope | Estimate |
|-------|-------|----------|
| **Spike: ScreenCaptureKit Feasibility** | Minimal Swift CLI proof-of-concept (launchd LaunchAgent, no UI window, single frame capture). Validates daemon usage + TCC permission model + screenshot mode. | ~2-4h |
| **1. Swift Capture Daemon** | ScreenCaptureKit capture loop, pHash dedup, JPEG + SQLite write (with locking columns), launchd auto-start. Single display first. WAL pragmas. | ~3-4 days |
| **2. Node Batch Analyzer** | Poll `frames` table with row-level locking, VLM batch on threshold, write observations, mark frames analyzed. Reuses `vlm-service.ts`. Stale lock cleanup. | ~2-3 days |
| **3. Segmentation + CLI** | `capture.recorder.adapter.ts` (new CaptureSource), reuse `activity-segmentation.ts`, persist segments, synthetic recording creation. `escribano cut` + `escribano analyze` commands. | ~2-3 days |
| **4. Menu Bar + Polish** | macOS menu bar status item (Swift, dev-only), frame cleanup cron, disk quota warning, `escribano doctor` checks. | ~2-3 days |

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
- **ScreenCaptureKit daemon feasibility unvalidated** — Must spike before committing to Phase 1 (blockers: launchd+UI access, TCC permission model, screenshot interval support)

### Neutral
- SQLite WAL handles concurrency (no Redis/message queue)
- Existing VLM/LLM infrastructure unchanged (same MLX bridge)
- Current batch pipeline continues to work alongside recorder

## Validation Plan: ScreenCaptureKit Spike

**Status**: Required before Phase 1

**Goal**: Prove or disprove that ScreenCaptureKit can run in a launchd background agent without UI framework access.

**Approach**: Minimal Swift proof-of-concept in `apps/recorder-spike/`:

```
apps/recorder-spike/
├── Package.swift                      -- Swift package definition
├── Sources/Spike/main.swift           -- Minimal capture loop
└── com.escribano.spike.plist          -- Test launchd plist (LaunchAgent)
```

**What to validate:**
1. Can `SCShareableContent.current` be called in a launchd daemon (no window server access)?
2. Does TCC Screen Recording permission survive daemon restart? Can it be granted non-interactively?
3. Does `SCStream` support periodic screenshot mode, or is it streaming-only? (If streaming-only, can we capture keyframes efficiently?)
4. Do `SCDisplay` handles work for all connected monitors in daemon context?

**Success criteria:**
- [ ] Compile and run Swift proof-of-concept using Swift Package Manager and Xcode Command Line Tools (no Xcode.app GUI required)
- [ ] Install launchd plist and run as background agent
- [ ] Capture one screenshot successfully to disk
- [ ] Verify screenshot contains expected content (not blank/black screen)
- [ ] Confirm permission prompt appears on first run (or graceful fail if denied)

**Failure scenarios & fallbacks:**
- **SCK requires UI session** → Use `CGWindowListCreateImage()` (older API, no TCC requirement, but single display only)
- **SCK streaming-only** → Use `SCStream` with frame handler + high capture rate + pHash dedup (more CPU)
- **TCC permission not grantable for daemon** → Require user interaction once, then persist permission (same as ffmpeg recorder)

**Ownership**: @opencode agent (explore subagent) — research + validation, no implementation

**Timeline**: 2-4 hours

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
