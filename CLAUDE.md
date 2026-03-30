# CLAUDE.md - Escribano

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
- **VLM/LLM**: MLX-VLM (local) — **Qwen3.5 is multimodal** (handles both frame analysis AND text generation in a single model). The recorder uses one Qwen3.5 model for everything: VLM frame analysis + `text_infer` for session aggregation. No separate LLM model needed.
- **LLM (batch fallback)**: MLX-LM or Ollama (local, auto-detected based on RAM) — only used by the batch pipeline when a separate text-only LLM is needed
- **Package Manager**: `uv` for Python dependencies (fast, reliable lockfiles)

## Development Environment

- **Machine**: MacBook Pro M4 Max
- **Unified Memory**: 128GB (Optimized for VLM inference)
- **VLM/LLM Model**: `Qwen3.5-2B-6bit` (multimodal — handles both frame analysis and text generation) via MLX-VLM. On 16GB machines: `Qwen3.5-0.8B-8bit` also works well.
- **LLM Model (batch only)**: Auto-detected based on RAM (`Qwen3.5-27B` recommended) via MLX-LM or Ollama — only needed for the batch pipeline's separate `generateText` path

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
| `ESCRIBANO_VLM_MODEL` | MLX model (Qwen3.5 is multimodal — one model for frame analysis + text generation). RAM-aware default: `Qwen3.5-2B-6bit` (>=32GB) or `Qwen3.5-0.8B-8bit` (16GB). | auto-detected |
| `ESCRIBANO_ANALYZE_BATCH_SIZE` | Batch size (frames) claimed by the recorder VLM analyzer each cycle. | `5` |
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
| `ESCRIBANO_BRIDGE_PATH` | Path to `mlx_bridge.py` script (recorder uses deployed copy by default) | `~/.escribano/scripts/mlx_bridge.py` |
| `ESCRIBANO_MLX_LOG_FILE` | File path for MLX bridge logs (uses stderr if unset) | — |
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
| **Recorder (Always-On)** | | |
| `ESCRIBANO_PHASH_THRESHOLD` | Hamming distance threshold for pHash dedup (skip frame if distance ≤ this) | `4` |
| `ESCRIBANO_DEBUG_PHASH` | Log every pHash comparison + rolling stats every 100 frames | `false` |
| `ESCRIBANO_CAPTURE_HIGH_WATER` | Pause capture when this many frames are pending analysis | `500` |
| `ESCRIBANO_CAPTURE_LOW_WATER` | Resume capture when pending frames drop below this | `100` |
| `ESCRIBANO_MLX_RECORDER_SOCKET` | Unix socket path for recorder's Python VLM bridge | `/tmp/escribano-recorder-vlm.sock` |
| `ESCRIBANO_TB_POLL_INTERVAL` | Seconds between SessionAggregator polls | `120` |
| `ESCRIBANO_TB_MIN_OBSERVATIONS` | Minimum observations to trigger aggregation | `3` |
| `ESCRIBANO_TB_MAX_OBS_PER_CYCLE` | Max observations per aggregation cycle | `300` |
| `ESCRIBANO_TB_LLM_BATCH_SIZE` | Observations per LLM sub-batch (keeps prompts small) | `50` |
| `ESCRIBANO_QUEUE_REALTIME_STREAK` | Max consecutive realtime tasks before normal task runs (WorkQueue fairness) | `10` |

**Note:** Recorder variables are injected into the LaunchAgent plist at install time. If you change these values in `~/.escribano/.env`, you must re-run `npx escribano recorder install` for the changes to take effect in the background agent.

### Performance Notes
- **Scene Detection**: Uses `-skip_frame nokey` FFmpeg optimization by default for 20x speedup (57 min → 2.8 min for 3-hour videos)
- **VLM Inference**: 4bit quantization + interleaved batching for 2.5x speedup (43 min → 19.6 min)
- **Total Pipeline**: Combined optimizations achieve 4x speedup (102 min → 25.7 min for 3-hour videos)

### Deprecated
- `ESCRIBANO_SESSION_GAP_THRESHOLD` — Removed (gap-based windowing no longer used; LLM prompt handles activity boundaries)
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
├── config.ts                          # Config file loader (~/.escribano/.env)
├── prerequisites.ts                   # Doctor checks (dependency validation)
├── python-deps.ts                     # Python venv setup & mlx-vlm install
├── python-utils.ts                    # Python environment resolution helpers
├── actions/
│   ├── process-recording-v3.ts        # V3 Pipeline: Recording → VLM → Segments → TopicBlocks
│   ├── generate-summary-v3.ts         # V3 Narrative: TopicBlocks → LLM → Markdown
│   ├── generate-artifact-v3.ts        # V3 Card/Standup: Subject grouping → LLM → Markdown
│   ├── analyze-frames.ts              # Standalone VLM frame analysis action
│   ├── outline-index.ts               # Rebuild Outline global index
│   ├── publish-summary-v3.ts          # Publish single artifact to Outline
│   └── sync-to-outline.ts             # Sync all artifacts to Outline
├── adapters/
│   ├── capture.cap.adapter.ts         # Cap recording discovery
│   ├── capture.filesystem.adapter.ts  # Video files with auto audio extraction
│   ├── transcription.whisper.adapter.ts # Audio → Text (whisper-cli)
│   ├── audio.silero.adapter.ts        # VAD preprocessing (Python)
│   ├── video.ffmpeg.adapter.ts        # Frame extraction + scene detection
│   ├── intelligence.ollama.adapter.ts # LLM inference (Ollama, for summary generation)
│   ├── intelligence.mlx.adapter.ts    # VLM & LLM inference (MLX-VLM for frames, MLX-LM for text)
│   └── publishing.outline.adapter.ts  # Outline wiki publishing adapter
├── services/                          # Pure business logic (no I/O)
│   ├── frame-sampling.ts              # Adaptive frame reduction
│   ├── vlm-service.ts                 # VLM orchestration (backend-agnostic)
│   ├── activity-segmentation.ts       # Group by activity continuity
│   ├── temporal-alignment.ts          # Attach audio by timestamp
│   └── app-normalization.ts           # Normalize app names for context matching
├── stats/                             # Pipeline telemetry
│   ├── index.ts
│   ├── observer.ts                    # Phase timing observer
│   ├── repository.ts                  # Run history persistence
│   ├── resource-tracker.ts            # Memory/CPU tracking
│   └── types.ts                       # Telemetry types
├── db/
│   ├── index.ts                       # DB connection & repository factory
│   ├── migrate.ts                     # Auto-run SQL migrations
│   ├── helpers.ts                     # Query helpers
│   ├── repositories/                  # SQLite implementations
│   └── types.ts                       # Manual DB types
├── domain/
│   ├── recording.ts                   # Recording entity & state machine
│   ├── classification.ts              # Classification domain logic
│   ├── time-range.ts                  # Time range value object
│   └── transcript.ts                  # Transcript value object
├── pipeline/
│   └── context.ts                     # AsyncLocalStorage observability
└── utils/
    ├── index.ts                       # Buffer utilities
    ├── model-detector.ts              # RAM-based LLM model auto-selection
    ├── env-logger.ts                  # Log env vars for debugging
    ├── id-normalization.ts            # ID normalization helpers
    └── parallel.ts                    # Parallel processing utilities
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

# Recorder subcommands
npx escribano recorder install          # Build Swift binary, install LaunchAgent, register with launchctl
npx escribano recorder status           # Show agent state, pending frames, disk usage
npx escribano recorder restart          # Restart the LaunchAgent

# Development & testing
pnpm quality-test                       # Process all 7 videos with summary (dev)
pnpm quality-test:fast                  # Process without summary generation (dev)
pnpm dashboard                          # Start web dashboard at http://localhost:3456
pnpm recorder:dev                       # swift build -c release + run recorder binary (dev mode)
pnpm recorder:monitor                   # Monitor recorder resource usage
pnpm build:recorder                     # Build Swift recorder binary only
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

## Code Quality Rules

### Architecture: Clean Architecture with Ports & Adapters

This project follows strict Clean Architecture. **The dependency rule is non-negotiable: dependencies point inward.**

```
ADAPTERS (infrastructure) → ACTIONS (use cases) → SERVICES (pure logic) → DOMAIN (core)
```

#### Layer Rules

**Domain** (`src/domain/*.ts`):
- NEVER import from adapters, actions, db, config, or utils
- Pure value objects and state machines only
- No side effects, no I/O, no `process.env`

**Services** (`src/services/*.ts`):
- NEVER import from adapters or actions
- May import from domain and peer services
- Must be **pure functions**: no file I/O, no network calls, no `process.env` reads
- If a service needs I/O, it belongs in `src/actions/` instead
- Receive dependencies (intelligence service, etc.) as parameters via port interfaces

**Actions** (`src/actions/*.ts`):
- May import from domain, services, and adapter interfaces (ports)
- NEVER import from other actions
- This is the orchestration layer — file reads, LLM calls, DB writes happen here
- Use `withPipeline()` + `step()` from `pipeline/context.ts` for observability

**Adapters** (`src/adapters/*.ts`):
- NEVER import from other adapters (no cross-adapter dependencies)
- NEVER import `config.ts` directly — receive config through factory function parameters
- NEVER access the database directly — that's the repository layer's job
- Always implement a port interface from `0_types.ts`
- Export a factory function: `createXxxService()` returning the port interface type

#### Naming Conventions

| What | Pattern | Example |
|------|---------|---------|
| Adapter files | `[port].[implementation].adapter.ts` | `intelligence.mlx.adapter.ts` |
| Adapter factories | `createXxxService()` | `createMlxIntelligenceService()` |
| Swift port files | `[Port].port.swift` | `FrameStore.port.swift` |
| Swift adapter files | `[Port].[impl].adapter.swift` | `FrameStore.sqlite.adapter.swift` |
| Test files | `src/tests/**/*.test.ts` or co-located `*.test.ts` | `temporal-alignment.test.ts` |

### Configuration

- **Always use `loadConfig()`** from `src/config.ts` — NEVER read `process.env.ESCRIBANO_*` directly
- All env var defaults must be defined in the Zod schema in `config.ts` — never in adapter code
- Adapters receive config via factory function parameters or by calling `loadConfig()` inside the factory

### Logging

- **Always use `createLogger(prefix)`** from `src/utils/logger.ts` — NEVER use bare `console.log` in library code
- `debug()` is gated by config flags — use it for verbose output
- `info()`, `warn()`, `error()` always emit
- Prefixes: `[MLX]`, `[Ollama]`, `[FFmpeg]`, `[Pipeline]`, etc.

### Error Handling

- Use domain error types from `src/domain/errors.ts` for typed errors
- Cleanup code (process teardown, socket cleanup) must log errors at debug level — NEVER use empty `catch {}`
- Loops over collections (publishing, frame processing) must collect errors and continue — NEVER stop on first failure
- Always include context in error messages: file path, frame index, recording ID

### Type Safety

- NEVER use `z.any()` in Zod schemas — use typed unions
- NEVER use `as any` to access internal library APIs
- Validate DB query results before type assertions — don't blindly cast `as DbRecording`

### Multi-Language Boundaries (TypeScript ↔ Python ↔ Swift)

- **NDJSON protocol**: All IPC uses newline-delimited JSON over Unix domain sockets
- **SQLite shared access**: Both TS and Swift use WAL mode + `busy_timeout = 5000`
- **Schema versioning**: Both languages check `PRAGMA user_version` at startup
- **XML in plists**: Always escape `&`, `<`, `>`, `"`, `'` when generating XML plist files
- **Python path**: Use the resolution chain in `python-utils.ts` — never hardcode paths

### Testing

- All pure services (`src/services/`) must have corresponding test files
- Follow existing patterns in `tests/services/frame-sampling.test.ts`
- Use factory helpers (e.g., `createObservation()`) for test data — don't inline object literals
- Test file location: `src/tests/` mirroring source structure

### Post-Change Audit Checklist

After writing or modifying code, verify:
- [ ] No new `process.env.ESCRIBANO_*` reads outside `config.ts`
- [ ] No new imports between adapters
- [ ] No new `console.log` in library code (use `createLogger`)
- [ ] No empty `catch {}` blocks (log at debug level)
- [ ] No `z.any()` or `as any` in type definitions
- [ ] Services in `src/services/` remain pure (no `fs`, no `fetch`, no `process.env`)
- [ ] New public functions have corresponding test coverage
- [ ] Factory functions return port interface types, not concrete types

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
