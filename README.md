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

# Pull Ollama models
ollama pull qwen3-vl:4b    # Vision model for frame analysis
ollama pull qwen3:32b      # Summary generation

# Initialize database
pnpm db:reset

# Process latest recording
pnpm escribano

# Reprocess from scratch
pnpm escribano --force
```

## Usage

```bash
# Start Ollama (optimized for VLM)
pnpm ollama

# Process latest recording and generate summary
pnpm escribano

# Force reprocessing from scratch
pnpm escribano --force
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
├── services/                     # Pure business logic
│   ├── frame-sampling.ts         # Scene-aware frame reduction
│   ├── vlm-service.ts            # Sequential single-image VLM orchestration
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
VLM Batch Inference (qwen3-vl:4b) → Visual Observations
    ↓
Activity Segmentation → Temporal Audio Alignment
    ↓
TopicBlocks → LLM Summary (qwen3:32b) → Markdown Artifact
```

## Prerequisites

### System Dependencies

- **whisper-cpp**: `brew install whisper-cpp`
- **ffmpeg**: `brew install ffmpeg` (scene detection, frame extraction)
- **sqlite3**: `brew install sqlite3`
- **ollama**: `brew install ollama` (VLM + LLM services)

### Native Modules

This project uses `better-sqlite3`, which requires native compilation. pnpm 10+ requires explicit approval:

```bash
pnpm approve-builds
```

Select `better-sqlite3` when prompted.

### Ollama Setup

1. **Install**: `brew install ollama`
2. **Pull Models**:
   - `ollama pull qwen3-vl:4b` (Vision, frame analysis)
   - `ollama pull qwen3:32b` (Summary generation)

3. **Start Ollama** (use recommended settings):
   ```bash
   pnpm ollama
   # Equivalent to: OLLAMA_NUM_PARALLEL=1 OLLAMA_FLASH_ATTENTION=1 ... ollama serve
   ```

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `ESCRIBANO_VLM_MODEL` | VLM model | `qwen3-vl:4b` |
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

### Current Focus
- OCR on keyframes at artifact generation time (adds actual code/commands/URLs)
- Cross-recording Context queries ("show me all debugging this week")
- VLM pool abstraction for MLX migration (true parallel continuous batching)

### Backlog (P2)
- OCR on keyframes at artifact generation time (actual code/commands/URLs)
- VLM pool abstraction for MLX migration (true parallel continuous batching)
- Outline publishing wired to V3 TopicBlocks
- Cross-recording Context queries ("show me all debugging this week")

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
- VLM benchmark results (qwen3-vl:4b selected as optimal)
- Frame sampling strategies
- Audio preprocessing (Silero VAD + Whisper thresholds)

