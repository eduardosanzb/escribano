# Escribano

> *The scribe who transforms recordings into living knowledge*

AI-powered session intelligence tool that automatically captures, transcribes, classifies, and generates narrative summaries from your work sessions.

## Quick Start

```bash
# Install dependencies
pnpm install

# Approve native module builds (required once for better-sqlite3)
pnpm approve-builds

# Install prerequisites
brew install whisper-cpp ffmpeg sqlite3 ollama

# Pull Ollama model (for summary generation)
ollama pull qwen3:32b

# Install MLX-VLM for frame analysis (Python)
pip install mlx-vlm

# Initialize database
pnpm db:reset

# Process latest Cap recording
pnpm escribano

# Process a specific video file
pnpm escribano --file "~/Desktop/Screen Recording.mov"

# Reprocess from scratch
pnpm escribano --force
```

## Usage

```bash
# Start Ollama (for LLM summary generation)
pnpm ollama

# Process latest Cap recording
pnpm escribano

# Process a specific video file
pnpm escribano --file "/path/to/video.mp4"

# Process only (skip summary generation)
pnpm escribano --skip-summary

# Force reprocessing from scratch
pnpm escribano --force

# Show help
pnpm escribano --help
```

Output: Markdown summary saved to `~/.escribano/artifacts/`

## Architecture (V3 — VLM-First)

Escribano uses a **VLM-first visual pipeline** that directly analyzes screenshots with a Vision-Language Model, rather than extracting and clustering OCR text.

```
src/
├── 0_types.ts                    # Core types and interfaces
├── index.ts                      # CLI entry point
├── actions/
│   ├── process-recording-v3.ts   # V3 pipeline orchestrator
│   └── generate-summary-v3.ts    # LLM summary generation
├── adapters/                     # External system implementations
│   ├── intelligence.mlx.adapter.ts   # VLM inference (MLX-VLM)
│   ├── intelligence.ollama.adapter.ts # LLM inference (Ollama)
│   ├── capture.cap.adapter.ts        # Cap recording discovery
│   ├── capture.filesystem.adapter.ts # Direct file input
│   └── ...
├── services/                     # Pure business logic
│   ├── frame-sampling.ts         # Scene-aware frame reduction
│   ├── vlm-service.ts            # VLM orchestration
│   ├── activity-segmentation.ts  # Group by activity continuity
│   └── temporal-alignment.ts     # Audio attachment by timestamp
├── db/                          # SQLite persistence layer
└── domain/                      # Entity state machines
```

### Key Entities

- **Recording**: Raw capture from Cap (video/audio paths, metadata)
- **Observation**: Timestamped evidence — visual frame with VLM description, or audio transcript
- **TopicBlock**: Coherent work segment with activity type, VLM descriptions, and aligned audio
- **Context**: Cross-recording semantic label (app, topic) — created for future cross-recording queries
- **Artifact**: Generated Markdown summary

## Design Principles

- **VLM-First**: Screenshots are analyzed directly by vision model, not OCR + clustering
- **Scene Detection**: ffmpeg scene filter identifies visual changes for smarter sampling
- **Activity Segmentation**: Groups consecutive frames by detected activity (debugging, coding, meeting, etc.)
- **Temporal Alignment**: Audio attaches by timestamp overlap, not semantic similarity
- **Crash-Safe Resume**: Pipeline saves progress after each batch, resumes from last completed step
- **Clean Architecture**: Dependencies point inward; domain knows nothing of adapters

## Processing Pipeline

```
Recording → Frame Extraction → Scene Detection → Adaptive Sampling (~100-150 frames)
    ↓
Audio Pipeline (parallel) ───────────────────────┐
    │                                            │
Silero VAD → Whisper → Audio Observations        │
    │                                            │
VLM Batch Inference (MLX-VLM, Qwen3-VL-2B) → Visual Observations
    ↓
Activity Segmentation → Temporal Audio Alignment
    ↓
TopicBlocks → LLM Summary (Ollama, qwen3:32b) → Markdown Artifact
```

## Prerequisites

### System Dependencies

- **whisper-cpp**: `brew install whisper-cpp`
- **ffmpeg**: `brew install ffmpeg` (scene detection, frame extraction)
- **sqlite3**: `brew install sqlite3`
- **ollama**: `brew install ollama` (LLM summary generation)
- **Python 3**: For MLX-VLM frame analysis

### Native Modules

This project uses `better-sqlite3`, which requires native compilation. pnpm 10+ requires explicit approval:

```bash
pnpm approve-builds
```

Select `better-sqlite3` when prompted.

### Ollama Setup

1. **Install**: `brew install ollama`
2. **Pull Model**: `ollama pull qwen3:32b` (Summary generation)
3. **Start Ollama**:
   ```bash
   pnpm ollama
   ```

### MLX-VLM Setup (VLM Frame Analysis)

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

| Variable | Description | Default |
|----------|-------------|---------|
| `ESCRIBANO_VLM_MODEL` | MLX-VLM model for frame analysis | `mlx-community/Qwen3-VL-2B-Instruct-bf16` |
| `ESCRIBANO_VLM_BATCH_SIZE` | Frames per interleaved batch | `4` |
| `ESCRIBANO_VLM_MAX_TOKENS` | Token budget per batch | `2000` |
| `ESCRIBANO_MLX_SOCKET_PATH` | Unix socket for MLX bridge | `/tmp/escribano-mlx.sock` |
| `ESCRIBANO_PYTHON_PATH` | Python executable for MLX | Auto-detected |
| `ESCRIBANO_SAMPLE_INTERVAL` | Base sampling (seconds) | `10` |
| `ESCRIBANO_SAMPLE_GAP_THRESHOLD` | Gap detection (seconds) | `15` |
| `ESCRIBANO_SAMPLE_GAP_FILL` | Gap fill interval (seconds) | `3` |
| `ESCRIBANO_VERBOSE` | Verbose logging | `false` |
| `ESCRIBANO_SKIP_LLM` | Use template instead of LLM | `false` |

## Roadmap

### Completed ✅
- **M1**: Core Pipeline — Cap → Whisper → Transcript
- **M2**: Intelligence — Multi-label Classification
- **M3**: Artifacts — Generation + Outline Sync
- **M4**: VLM-First Pipeline — Frame Sampling → Scene Detection → VLM Batch → Activity Segmentation → LLM Summary
- **MLX Migration**: 4.7x faster VLM inference via MLX-VLM (ADR-006)

### Current Focus
- Validate artifact quality with real sessions
- Auto-process watcher for new recordings

### Backlog (P2)
- OCR on keyframes at artifact generation time (actual code/commands/URLs)
- Cross-recording Context queries ("show me all debugging this week")
- MCP server for AI assistant integration

### Cleanup (P3)
- Remove deprecated V2 code (OCR-based clustering)
- Remove deprecated V1 code (file-based sessions)
- Schema migration: `clusters` → `segments`
- Split `0_types.ts` into focused modules

## Testing

```bash
# Run all tests
pnpm test

# Run specific test file
npx vitest run src/tests/db/repositories.test.ts
```

Focus on unit tests for core business logic (services/). Integration tests deferred until core pipeline is stable.

## Database

SQLite database located at `~/.escribano/escribano.db`

**Reset**: `pnpm db:reset` (deletes all data, useful for testing)

## Learnings

See [docs/learnings.md](docs/learnings.md) for detailed technical findings:
- MLX-VLM migration and benchmark results (ADR-006)
- VLM benchmark results (qwen3-vl series)
- Frame sampling strategies
- Audio preprocessing (Silero VAD + Whisper thresholds)

