# ADR-009: Always-On Screen Recorder

## Status

Proposed (2026-03-12)

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
│ analyzed (bool)  │     │ topics[]         │     │ apps[] / topics[]        │
│ width / height   │     │ timestamp        │     │ classification (JSON)    │
└──────────────────┘     └──────────────────┘     │ consumed (bool)          │
                                                   └──────────┬───────────────┘
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

SQLite WAL mode handles concurrency between processes:
- **Swift daemon**: Writer (INSERT frames)
- **Node analyzer**: Reader + Writer (SELECT unanalyzed → INSERT observations)
- **CLI**: Reader + Writer (SELECT observations → INSERT segments/subjects/artifacts)

WAL mode supports one writer + multiple concurrent readers. No Redis or message queue needed.

## Schema Additions

```sql
-- New table: raw captured frames
CREATE TABLE frames (
  id            TEXT PRIMARY KEY,
  display_id    TEXT NOT NULL,
  captured_at   TEXT NOT NULL,        -- ISO 8601
  image_path    TEXT NOT NULL,
  phash         TEXT,                 -- perceptual hash (dedup)
  width         INTEGER,
  height        INTEGER,
  analyzed      INTEGER DEFAULT 0,   -- 0=pending, 1=analyzed
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_frames_analyzed ON frames(analyzed);
CREATE INDEX idx_frames_captured ON frames(captured_at);

-- Extend observations with frame FK
ALTER TABLE observations ADD COLUMN frame_id TEXT REFERENCES frames(id);

-- New table: persisted segments (replaces in-memory segments + topic_blocks)
CREATE TABLE segments (
  id              TEXT PRIMARY KEY,
  recording_id    TEXT REFERENCES recordings(id),
  start_time      REAL NOT NULL,
  end_time        REAL NOT NULL,
  activity_type   TEXT NOT NULL,
  apps            TEXT,               -- JSON array
  topics          TEXT,               -- JSON array
  classification  TEXT,               -- full JSON context
  consumed        INTEGER DEFAULT 0,  -- 0=available, 1=used in artifact
  created_at      TEXT DEFAULT (datetime('now'))
);
```

## MVP Roadmap

| Phase | Scope | Estimate |
|-------|-------|----------|
| **1. Swift Capture Daemon** | ScreenCaptureKit capture, pHash dedup, JPEG + SQLite write, launchd auto-start. Single display first. | ~3-4 days |
| **2. Node Batch Analyzer** | Poll `frames` table, VLM batch on threshold, write observations, mark frames analyzed. Reuses `vlm-service.ts`. | ~2-3 days |
| **3. Segmentation + CLI** | `capture.recorder.adapter.ts`, reuse `activity-segmentation.ts`, persist segments, CLI commands (`escribano cut`, `escribano generate`). | ~2-3 days |
| **4. Menu Bar + Polish** | macOS menu bar status item (Swift), suggested segments UI, format selection, frame cleanup. | ~2-3 days |

## Consequences

### Positive
- **Always-on** — Never forget to capture work
- **Multi-monitor** — All displays captured natively via ScreenCaptureKit
- **No FFmpeg extraction** — Screenshots are already frames (skip video → frame step entirely)
- **Streaming-ready** — Observations available as VLM processes them
- **Agent-native** — Structured observations in DB, queryable by time range

### Negative
- **Two languages** — Swift capture + TypeScript analysis (more build complexity)
- **Disk usage** — Continuous JPEG capture requires cleanup strategy
- **macOS-only** — ScreenCaptureKit locks capture layer to Apple platforms
- **New entity** — `frames` table adds schema complexity

### Neutral
- SQLite WAL handles concurrency (no Redis/message queue)
- Existing VLM/LLM infrastructure unchanged (same MLX bridge)
- Current batch pipeline continues to work alongside recorder

## Deferred Decisions

| Topic | Reasoning |
|-------|-----------|
| **Audio capture** | Adds complexity (CoreAudio + VAD); defer until visual pipeline proven |
| **CaptureSession entity** | Use time ranges for MVP; add session concept if grouping needed later |
| **OCR enrichment** | Add as post-VLM step triggered by activity type (coding → extract code) |
| **Image embeddings (CLIP)** | Useful for similarity search but not needed for segmentation |
| **Cloud offering** | Architecture is reusable (swap Swift for cloud capture) but defer |

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
- [Screen Capture Pipeline Design](../screen_capture_pipeline.md)
- [Apple ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit)
