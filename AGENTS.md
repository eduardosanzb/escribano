# AGENTS.md - Escribano

## Project Overview

**Escribano** ("The Scribe") is an AI-powered session intelligence tool that automatically captures, transcribes, classifies, and generates artifacts from work sessions.

## Technology Stack

- **Language**: TypeScript
- **Runtime**: Node.js
- **Module System**: ES Modules (package.json: "type": "module")
- **Development**: tsx (for running TypeScript directly)
- **Testing**: Vitest
- **Linting/Formatting**: Biome
- **Database**: SQLite (better-sqlite3)
- **Transcription**: whisper.cpp (whisper-cli)
- **VLM**: MLX-VLM (local, Qwen3-VL-2B) - frame analysis (~1.7s/frame)
- **LLM**: Ollama (local, qwen3:32b) - summary generation

## Development Environment

- **Machine**: MacBook Pro M4 Max
- **Unified Memory**: 128GB (Optimized for VLM inference)
- **VLM Model**: `Qwen3-VL-2B-Instruct-bf16` (~4GB, ~1.7s per frame) via MLX-VLM
- **LLM Model**: `qwen3:32b` (for high-quality narrative generation) via Ollama

### MLX-VLM Setup

Install Python dependency:
```bash
# With uv (recommended)
uv pip install mlx-vlm

# Or with pip
pip install mlx-vlm
```

The adapter auto-detects Python in this priority:
1. `ESCRIBANO_PYTHON_PATH` environment variable
2. Active virtual environment (`VIRTUAL_ENV`)
3. `~/.venv/bin/python3` (common uv venv location)
4. System `python3`

## Configuration

| Environment Variable | Description | Default |
|----------------------|-------------|---------|
| `ESCRIBANO_VLM_MODEL` | MLX model for VLM frame analysis | `mlx-community/Qwen3-VL-2B-Instruct-bf16` |
| `ESCRIBANO_VLM_BATCH_SIZE` | Frames per interleaved batch | `16` |
| `ESCRIBANO_VLM_MAX_TOKENS` | Token budget per batch | `4000` |
| `ESCRIBANO_VLM_REPETITION_PENALTY` | Repetition penalty for generation (1.0=disabled) | `1.15` |
| `ESCRIBANO_MLX_SOCKET_PATH` | Unix socket path for MLX bridge | `/tmp/escribano-mlx.sock` |
| `ESCRIBANO_MLX_STARTUP_TIMEOUT` | MLX bridge model loading timeout (ms) | `60000` |
| `ESCRIBANO_PYTHON_PATH` | Python executable path (for MLX bridge) | Auto-detected (venv > system) |
| `ESCRIBANO_SAMPLE_INTERVAL` | Base frame sampling interval (seconds) | `10` |
| `ESCRIBANO_SAMPLE_GAP_THRESHOLD` | Gap detection threshold (seconds) | `15` |
| `ESCRIBANO_SAMPLE_GAP_FILL` | Gap fill interval (seconds) | `3` |
| `ESCRIBANO_VERBOSE` | Enable verbose pipeline logging | `false` |
| `ESCRIBANO_DEBUG_OLLAMA` | Debug Ollama request/response logging | `false` |
| `ESCRIBANO_SKIP_LLM` | Skip LLM summary, use template fallback | `false` |
| `OLLAMA_NUM_PARALLEL` | Ollama inference slots (sequential processing) | `1` |

### Performance Notes
- **Scene Detection**: Uses `-skip_frame nokey` FFmpeg optimization by default for 20x speedup (57 min → 2.8 min for 3-hour videos)
- **VLM Inference**: Interleaved batching with 16-frame batches for optimal M4 Max throughput

### Deprecated
- `ESCRIBANO_VLM_BACKEND` — VLM is always MLX, LLM is always Ollama (explicit in index.ts)
- `ESCRIBANO_VLM_NUM_PREDICT` — Ollama VLM no longer used
- `ESCRIBANO_EMBED_MODEL` — Embeddings disabled in V3
- `ESCRIBANO_EMBED_BATCH_SIZE` — Embeddings disabled in V3
- `ESCRIBANO_CLUSTER_TIME_WINDOW` — Clustering disabled in V3
- `ESCRIBANO_CLUSTER_DISTANCE_THRESHOLD` — Clustering disabled in V3

## Architecture

This project follows **Clean Architecture** principles with a simplified flat structure.

### Current Implementation (Milestone 4 — VLM-First MVP)

```
src/
├── 0_types.ts                         # Core types, interfaces, Zod schemas
├── index.ts                           # CLI entry point (single command)
├── batch-context.ts                   # Shared init/processing for batch runs
├── actions/
│   ├── process-recording-v3.ts        # V3 Pipeline: Recording → VLM → Segments → TopicBlocks
│   └── generate-summary-v3.ts         # V3 Summary: TopicBlocks → LLM → Markdown
├── adapters/
│   ├── capture.cap.adapter.ts         # Cap recording discovery
│   ├── transcription.whisper.adapter.ts # Audio → Text (whisper-cli)
│   ├── audio.silero.adapter.ts        # VAD preprocessing (Python)
│   ├── video.ffmpeg.adapter.ts        # Frame extraction + scene detection
│   ├── intelligence.ollama.adapter.ts # LLM inference (Ollama, for summary generation)
│   └── intelligence.mlx.adapter.ts    # VLM inference (MLX-VLM, for frame analysis)
├── services/                          # Pure business logic (no I/O)
│   ├── frame-sampling.ts              # Adaptive frame reduction
│   ├── vlm-service.ts                 # VLM orchestration (backend-agnostic)
│   ├── activity-segmentation.ts       # Group by activity continuity
│   └── temporal-alignment.ts          # Attach audio by timestamp
├── db/
│   ├── index.ts                       # DB connection & repository factory
│   ├── migrate.ts                     # Auto-run SQL migrations
│   ├── repositories/                  # SQLite implementations
│   └── types.ts                       # Manual DB types
├── domain/
│   └── recording.ts                   # Recording entity & state machine
├── pipeline/
│   └── context.ts                     # AsyncLocalStorage observability
└── utils/
    └── index.ts                       # Buffer utilities
```

### Deprecated (V2)
```
src/
├── actions/
│   ├── process-recording-v2.ts        # OCR → Embedding → Clustering pipeline
│   ├── create-contexts.ts             # Signal extraction
│   └── create-topic-blocks.ts         # V2 block formation
├── adapters/
│   └── embedding.ollama.adapter.ts    # Text embeddings (disabled)
├── services/
│   ├── clustering.ts                  # Agglomerative clustering
│   ├── signal-extraction.ts           # Regex signal extraction
│   ├── cluster-merge.ts               # Audio-visual merge
│   └── vlm-enrichment.ts              # V2 VLM on representative frames
└── utils/
    └── ocr.ts                         # OCR text cleanup
```

### Key Principle: Port Interfaces

External systems are accessed through **port interfaces** defined in `0_types.ts`. We use a descriptive naming convention for adapters: `[port].[implementation].adapter.ts`.

- **TranscriptionService**: `transcription.whisper.adapter.ts`
- **CaptureSource**: `capture.cap.adapter.ts`
- **IntelligenceService**: `intelligence.ollama.adapter.ts`
- **VideoService**: `video.ffmpeg.adapter.ts`
- **AudioPreprocessor**: `audio.silero.adapter.ts`

## V3 Pipeline Flow

```
1. Input (Cap recording)
   └─ Latest recording detected via Cap watcher

2. Audio Pipeline (reused from V2)
   ├─ Silero VAD → speech segments
   ├─ Whisper transcription per segment
   └─ Save as Observation rows (type='audio')

3. Visual Pipeline (VLM-First)
   ├─ ffmpeg extracts frames at 2s intervals (~1776 frames/hour)
   ├─ Scene detection (ffmpeg) → timestamps of visual changes
   ├─ Adaptive sampling (10s base + scene changes + gap fill) → ~100-150 frames
   ├─ VLM sequential inference (qwen3-vl:4b, 1 image/request, 30k tokens) → activity + description per frame
   └─ Save as Observation rows (type='visual', vlm_description)

4. Activity Segmentation
   ├─ Group consecutive frames by activity continuity
   ├─ Merge short segments (<30s) into neighbors
   └─ Extract apps/topics from VLM descriptions

5. Temporal Audio Alignment
   ├─ Attach audio transcripts to segments by timestamp overlap (>=1s)
   └─ Audio becomes metadata on visual segments

6. Context & Topic Block Creation
   ├─ Create/find Context rows for apps/topics (INSERT OR IGNORE)
   ├─ Create TopicBlock with full context in classification JSON
   └─ Recording marked as 'processed'

7. Summary Generation
   ├─ Read TopicBlocks + observations
   ├─ Build prompt from template (prompts/summary-v3.md)
   ├─ LLM call (qwen3:32b) → narrative summary
   └─ Save markdown to ~/.escribano/artifacts/
```

## Activity Types (V3 Per-Segment)

| Type | Detection Keywords | Description |
|------|-------------------|-------------|
| `debugging` | debugging, troubleshooting, error, stack trace, fixing bug | Investigating errors |
| `coding` | writing code, implementing, developing, programming | Writing/editing code |
| `review` | reviewing pr, pull request, code review | Code review workflow |
| `meeting` | zoom, google meet, slack huddle, video call | Video calls/collaboration |
| `research` | browsing, stack overflow, googling, researching | Information gathering |
| `reading` | reading documentation, reading docs | Reading docs/articles |
| `terminal` | in terminal, in iterm, command line, running git | CLI operations |
| `other` | (fallback) | Unclassified activity |

## CLI

```bash
# Process latest recording and generate summary
pnpm escribano

# Reprocess from scratch
pnpm escribano --force

# Process only (skip summary generation)
pnpm escribano --skip-summary

# Batch quality testing
pnpm quality-test          # Process all 7 videos with summary
pnpm quality-test:fast     # Process without summary generation

# Dashboard for reviewing results
pnpm dashboard             # Start at http://localhost:3456
```

Output: Markdown summary saved to `~/.escribano/artifacts/`

## Dashboard

Web UI for reviewing processing results:

```bash
pnpm dashboard
```

Opens at `http://localhost:3456` with:
- **Overview** (`/overview.html`) — Aggregate stats, recordings table, summary viewer
- **Debug** (`/debug.html`) — Frame-by-frame inspection with VLM descriptions
- **Stats** (`/stats.html`) — Processing run history and phase breakdowns

## Resume Safety

The pipeline saves progress aggressively to enable crash recovery:

| Step | Saved To | Resume Behavior |
|------|----------|----------------|
| Audio processing | `observations` table | Skipped if already completed |
| Scene detection | `recordings.source_metadata` | Loaded from DB |
| VLM inference | `observations` table (per batch) | Skips already-processed frames |
| Segmentation | In-memory (fast) | Re-runs from observations |
| Context/TopicBlock | `contexts` + `topic_blocks` tables | Uses UNIQUE INDEX for idempotency |

## Database Schema

### Active Tables (V3)

- **recordings** — One row per recording with metadata
- **observations** — Visual frames (vlm_description) + audio transcripts
- **contexts** — Semantic labels (app, topic) — created but not yet used for queries
- **observation_contexts** — Join table (created but not yet used)
- **topic_blocks** — Work segments with full classification JSON

### Deprecated Tables (V2, not used)

- **clusters** — Embedding-based groupings
- **observation_clusters** — Join table
- **cluster_merges** — Audio-visual merge records

## Backlog

**Strategic Context**: See [Balanced Scorecard](./docs/escribano-balanced-scorecard.md). Critical constraint: March 2026 bandwidth drop (new role = 10-15 hrs/week). Must ship essentials before March.

### P0 — Critical Path (Pre-March Sprint)

**Existential: Validate the product works**
- ☐ **Validate artifact quality** — Process 5 real sessions, identify bottleneck layer — *2-3h, do this NOW*
  - Test with QuickTime recordings (primary workflow)
  - Rate VLM descriptions, segmentation, summary quality
- ✅ **MLX-VLM Migration** — ADR-006 complete. 3.5x speedup achieved.
  - Token budget: 4000 per batch (16 frames)
  - Adapter: `intelligence.mlx.adapter.ts` + `scripts/mlx_bridge.py`
  - VLM/LLM separation: MLX for images, Ollama for text (explicit in `index.ts`)

**Quick UX Win**
- ☐ **Auto-process watcher** — Watch recordings folder, auto-run Escribano on new files — *2-3h*
  - Removes manual `pnpm escribano` step
  - Works with Cap or QuickTime recordings

### P1 — Launch Blockers (Pre-March)

**Must have for public launch**
- ☐ **README with before/after** — First impression for every GitHub visitor — *1-2h*
- ☐ **Make repo public** — Unlocks all distribution channels — *15min*
- ☐ **Landing page** — Single page for HN/Twitter links — *3-4h*
- ☐ **2-min Loom demo** — Shows the product, not describes it — *1h*
- ☐ **ADR-005 blog post** — "Why OCR-based screen intelligence fails" — best marketing asset — *2-3h*

### P2 — Next Iteration (Post-March)

**When bandwidth drops to 10-15 hrs/week**
- ☐ **Real-time capture pipeline** — Rust-based always-on capture — *20+ h* — See `docs/screen_capture_pipeline.md`
  - Removes Cap/QuickTime dependency
  - Enables automatic session recording (no forgetting to start)
- ☐ **MCP server** — Expose TopicBlocks via MCP for AI assistant integration — *8-12h*
- ☐ **Cross-recording Context queries** — "show me all debugging sessions this week" — *4-6h*
- ☐ **Compare pages (SEO)** — "Escribano vs Screenpipe", "Escribano vs Granola" — *4-6h*
- ☐ OCR on keyframes at artifact generation time — *6-8h*

### P3 — Cleanup (Post-Launch)

**Technical debt when product is validated**
- ☐ Schema migration: rename `clusters` → `segments`, delete `cluster_merges`
- ☐ Remove deprecated V2 code (`clustering.ts`, `signal-extraction.ts`, `cluster-merge.ts`, etc.)
- ☐ Remove deprecated V1 code (`process-session.ts`, `classify-session.ts`, etc.)
- ☐ Split `0_types.ts` into domain/port/config modules

### Deferred (6+ months)

- ☐ Cloud inference tier — $15-25/mo SaaS option
- ☐ Team/Enterprise features — Per-seat pricing

## Code Conventions

- Single types file — `0_types.ts` is the source of truth
- Ports & Adapters — External systems accessed through interfaces
- Repository Pattern — Decouples business logic from storage
- Functional over classes — Factory functions return typed interfaces
