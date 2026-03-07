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
- **VLM**: MLX-VLM (local, Qwen3-VL-2B) - frame analysis (~0.7s/frame with 4bit)
- **LLM**: MLX-LM (local, Qwen3.5) or Ollama (local, auto-detected based on RAM) - summary generation
- **Package Manager**: `uv` for Python dependencies (fast, reliable lockfiles)

## Development Environment

- **Machine**: MacBook Pro M4 Max
- **Unified Memory**: 128GB (Optimized for VLM inference)
- **VLM Model**: `Qwen3-VL-2B-Instruct-4bit` (~2GB, ~0.7s per frame) via MLX-VLM
- **LLM Model**: Auto-detected based on RAM (`Qwen3.5-27B` recommended) via MLX-LM or Ollama

### MLX-VLM Setup

**Zero-config** — on first run escribano automatically creates `~/.escribano/venv` and installs `mlx-vlm` there using plain `python3 -m venv`. You only need Python 3 installed.

```bash
# Nothing to do — just run escribano and it handles the rest.
# The first run will print:
#   [VLM] First-time setup: creating Python environment at ~/.escribano/venv
#   [VLM] Installing mlx-vlm into ~/.escribano/venv (first run — this may take a few minutes)...
#   [VLM] mlx-vlm installed successfully.
```

### Python Environment Resolution

The MLX bridge auto-detects the best Python environment using this priority order:

1. **`ESCRIBANO_PYTHON_PATH`** — Explicit override (environment variable)
2. **`~/.escribano/venv`** — Managed venv (preferred once created)
3. **`VIRTUAL_ENV`** — Active virtual environment (skipped if inside project directory)
4. **`UV_PROJECT_ENVIRONMENT`** — uv project environment (skipped if inside project directory)
5. **Project-local `.venv/bin/python3`** — Created by `uv venv` in current directory
6. **`~/.venv/bin/python3`** — Home-level venv (created by `uv venv ~/.venv`)
7. **Auto-setup** — Creates `~/.escribano/venv` and installs `mlx-vlm` automatically

**Note:** Project-local venvs (inside the current working directory) are skipped for steps 3-4 to avoid using dev environments that may not have `mlx-vlm` installed. Once the managed `~/.escribano/venv` exists, it's always preferred.

If you prefer to manage your own environment explicitly:

```bash
# Option A: activate your venv before running (sets VIRTUAL_ENV)
uv venv my_env
source my_env/bin/activate
npx escribano ...

# Option B: use uv sync (sets UV_PROJECT_ENVIRONMENT)
cd my_project
uv sync
npx escribano ...

# Option C: tell escribano which Python to use
ESCRIBANO_PYTHON_PATH=/path/to/your/venv/bin/python3 npx escribano ...
```

## Configuration

Configuration is loaded from multiple sources with priority (highest to lowest):
1. **Shell environment variables** (e.g., `export ESCRIBANO_FRAME_WIDTH=1280`)
2. **`~/.escribano/.env` config file** (auto-created on first run)
3. **Default values** (built-in)

### Config File Management

```bash
# View current config (merged from all sources)
npx escribano config

# Show path to config file
npx escribano config --path

# Edit config manually
vim ~/.escribano/.env
```

The config file is auto-created on first run with sensible defaults and inline comments. You can customize performance, quality, models, and debugging options without setting environment variables.

### Environment Variables & Defaults

| Environment Variable | Description | Default |
|----------------------|-------------|---------|
| `ESCRIBANO_VLM_MODEL` | MLX model for VLM frame analysis | `mlx-community/Qwen3-VL-2B-Instruct-4bit` |
| `ESCRIBANO_VLM_BATCH_SIZE` | Frames per interleaved batch | `2` |
| `ESCRIBANO_VLM_MAX_TOKENS` | Token budget per batch | `2000` |
| `ESCRIBANO_LLM_BACKEND` | LLM backend: `mlx` (default) or `ollama` | `mlx` |
| `ESCRIBANO_LLM_MODEL` | Ollama model (only used if `llmBackend=ollama`) | auto-detected |
| `ESCRIBANO_LLM_MLX_MODEL` | MLX model (only used if `llmBackend=mlx`) | auto-detected |
| `ESCRIBANO_SUBJECT_GROUPING_MODEL` | LLM model for subject grouping (thinking disabled) | auto-detected |
| `ESCRIBANO_ARTIFACT_THINK` | Enable thinking for artifact/card generation (slower, higher quality) | `false` |
| `ESCRIBANO_MLX_SOCKET_PATH` | Unix socket path for MLX bridge | `/tmp/escribano-mlx.sock` |
| `ESCRIBANO_MLX_TIMEOUT` | MLX bridge startup & generation timeout (ms) | `120000` |
| `ESCRIBANO_PYTHON_PATH` | Python executable path (for MLX bridge) | Auto-setup (`~/.escribano/venv`) |
| `ESCRIBANO_SAMPLE_INTERVAL` | Base frame sampling interval (seconds) | `10` |
| `ESCRIBANO_SAMPLE_GAP_THRESHOLD` | Gap detection threshold (seconds) | `15` |
| `ESCRIBANO_SAMPLE_GAP_FILL` | Gap fill interval (seconds) | `3` |
| `ESCRIBANO_FRAME_WIDTH` | Frame extraction width in pixels | `1024` |
| `ESCRIBANO_SCENE_THRESHOLD` | Scene change detection threshold (0-1) | `0.4` |
| `ESCRIBANO_SCENE_MIN_INTERVAL` | Minimum seconds between scene changes | `2` |
| `ESCRIBANO_VERBOSE` | Enable verbose pipeline logging | `false` |
| `ESCRIBANO_DEBUG_OLLAMA` | Debug Ollama request/response logging (includes full prompt) | `false` |
| `ESCRIBANO_DEBUG_VLM` | Debug VLM processing output | `false` |
| `ESCRIBANO_SKIP_LLM` | Skip LLM summary, use template fallback | `false` |
| `ESCRIBANO_OUTLINE_URL` | Outline wiki base URL (for publishing) | — |
| `ESCRIBANO_OUTLINE_TOKEN` | Outline API token | — |
| `ESCRIBANO_OUTLINE_COLLECTION` | Outline collection name | `Escribano Sessions` |
| `OLLAMA_NUM_PARALLEL` | Ollama server inference slots (configure Ollama itself) | `1` |

### Performance Notes
- **Scene Detection**: Uses `-skip_frame nokey` FFmpeg optimization by default for 20x speedup (57 min → 2.8 min for 3-hour videos)
- **VLM Inference**: 4bit quantization + interleaved batching for 2.5x speedup (43 min → 19.6 min)
- **Total Pipeline**: Combined optimizations achieve 4x speedup (102 min → 25.7 min for 3-hour videos)

### Deprecated
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
│   ├── capture.filesystem.adapter.ts  # Video files with auto audio extraction
│   ├── transcription.whisper.adapter.ts # Audio → Text (whisper-cli)
│   ├── audio.silero.adapter.ts        # VAD preprocessing (Python)
│   ├── video.ffmpeg.adapter.ts        # Frame extraction + scene detection
│   ├── intelligence.ollama.adapter.ts # LLM inference (Ollama, for summary generation)
│   └── intelligence.mlx.adapter.ts    # VLM & LLM inference (MLX-VLM for frames, MLX-LM for text)
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
- **CaptureSource**: `capture.cap.adapter.ts` (Cap recordings) or `capture.filesystem.adapter.ts` (video files with auto audio extraction)
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
   ├─ VLM sequential inference (Qwen3-VL-2B-4bit, ~0.7s/frame) → activity + description per frame
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

7. Artifact Generation
   ├─ Load TopicBlocks for recording
   ├─ Load LLM model (MLX or Ollama based on backend setting)
   ├─ Subject grouping via LLM (or reuse existing subjects)
   ├─ Build prompt from format template (card/standup/narrative)
   ├─ LLM call (auto-detected model) → formatted artifact
   ├─ Unload LLM model (if MLX backend)
   ├─ Save markdown to ~/.escribano/artifacts/
   └─ Link artifact to subjects via artifact_subjects join table

8. Outline Publishing (optional, if configured)
   ├─ Publish artifact to Outline wiki
   ├─ Update recording metadata with outline_formats[]
   └─ Rebuild global index showing all format links per recording
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

### Commands

```bash
# Main workflow
npx escribano                           # Process latest Cap recording
npx escribano --file "/path/to/video.mov"  # Process video file
npx escribano --latest "~/Videos"       # Find and process latest video in directory

# Configuration management
npx escribano config                    # Show current configuration (merged from all sources)
npx escribano config --path             # Show path to config file (~/.escribano/.env)

# Prerequisites & help
npx escribano doctor                    # Check dependencies and system requirements
npx escribano --help                    # Show all CLI options
npx escribano --version                 # Show version number

# Development & testing
pnpm quality-test                       # Process all 7 videos with summary (dev)
pnpm quality-test:fast                  # Process without summary generation (dev)
pnpm dashboard                          # Start web dashboard at http://localhost:3456
```

### Options

```bash
# Audio handling
npx escribano --file video.mov --mic-audio mic.wav
npx escribano --file video.mov --system-audio system.wav
npx escribano --file video.mov --mic-audio mic.wav --system-audio system.wav

# Output formats
npx escribano --format card              # Default: time breakdowns per subject
npx escribano --format standup           # What I did / Outcomes / Next
npx escribano --format narrative         # Prose with timeline

# Control pipeline
npx escribano --force                    # Reprocess from scratch (clear cache)
npx escribano --skip-summary             # Process frames only (no artifact generation)

# Output options
npx escribano --include-personal         # Include personal time (filtered by default)
npx escribano --copy                     # Copy artifact to clipboard
npx escribano --stdout                   # Print artifact to stdout instead of file
```

### Audio Handling

| Source | Video | Mic Audio | System Audio |
|--------|-------|-----------|--------------|
| Cap recording | Separate `.mp4` | `.ogg` file | `.ogg` file |
| Video file (`--file`) | Single `.mov`/`.mp4` | Auto-extracted or `--mic-audio` | `--system-audio` only |

For video files (QuickTime recordings, etc.):
- **Auto-extraction**: If no `--mic-audio` flag, audio is automatically detected and extracted to `/tmp/escribano/{id}/audio.wav`
- **Override**: Use `--mic-audio` to provide a separate audio file (skips extraction)
- **System audio**: QuickTime doesn't capture system audio; use `--system-audio` if you have a separate recording

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

## Code Conventions

- Single types file — `0_types.ts` is the source of truth
- Ports & Adapters — External systems accessed through interfaces
- Repository Pattern — Decouples business logic from storage
- Functional over classes — Factory functions return typed interfaces

## Task Tracking

See [BACKLOG.md](BACKLOG.md) for task priorities and progress.

## Deployment

### Landing Page (escribano.work)

- **Location:** `apps/landing/` — Hugo static site
- **Build:** Docker + nginx (see `apps/landing/Dockerfile`)
- **Host:** Coolify server at `46.224.72.233`
- **Auto-deploy:** GitHub Actions on push to `main` (`.github/workflows/landing-deploy.yml`)
- **Required secret:** `COOLIFY_ESCRIBANO_WEBHOOK` — get from Coolify → app → Deploy Webhook

### SSL + Cloudflare

The server runs behind Cloudflare's orange-cloud proxy. Traefik uses **DNS-01 challenge** (not HTTP-01) for SSL certs.

**Full setup guide:** [docs/deployment/coolify-cloudflare-dns.md](docs/deployment/coolify-cloudflare-dns.md)

Key points:
- API token stored in `/data/coolify/proxy/.env` (Coolify UI drops env blocks)
- `delaybeforecheck=30` required to avoid DNS propagation race conditions
- Container port must be set correctly (80 for nginx, 3000 for Node.js)
