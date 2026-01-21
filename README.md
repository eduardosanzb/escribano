# Escribano

> *The scribe who transforms recordings into living knowledge*

AI-powered session intelligence tool that automatically captures, transcribes, classifies, and transforms your work sessions.

## Quick Start

```bash
# Install dependencies
pnpm install

# Approve native module builds (required once for better-sqlite3)
pnpm approve-builds

# Install prerequisites
brew install whisper-cpp ffmpeg sqlite3 ollama

# Initialize database
pnpm db:reset

# Run tests
pnpm test

# Build
pnpm build
```

## Project Status

See [MILESTONES.md](./MILESTONES.md) for complete roadmap and current progress.

**Current Focus:** Milestone 3.5 - Smart Segmentation & Context-First Architecture

### Completed ✅
- [x] Milestone 1: Core Pipeline (Transcribe Last Cap Recording)
- [x] Milestone 2: Intelligence (Classification & Entity Extraction)
- [x] Milestone 3: Artifacts, Visuals & Outline Sync
- [x] Context-First Architecture Redesign (ADR-003)
- [x] SQLite Storage Layer with Repository Pattern (ADR-004)
- [x] Multi-label Classification & Semantic Clustering
- [x] Outline Wiki Integration

## Architecture (v2)

Escribano follows a **Context-First** observation model, separating raw data from semantic meaning.

```
src/
├── 0_types.ts           # Core types, interfaces, and Zod schemas
├── index.ts              # CLI entry point
├── actions/             # Use cases (process-session, sync-to-outline, etc.)
├── adapters/            # Port implementations (whisper, ollama, outline, cap)
├── db/                  # Persistence layer
│   ├── migrate.ts       # SQL migration runner
│   ├── repositories/    # SQLite implementations of repository ports
│   └── index.ts         # DB connection and repository factory
└── tests/               # Unit + integration tests
```

### Key Entities

- **Recording**: Raw capture (video/audio paths)
- **Observation**: Atomic multimodal evidence (OCR text, audio transcript segment, etc.)
- **Context**: Cross-recording semantic label (project, app, topic)
- **TopicBlock**: Recording segment grouped by semantic context
- **Artifact**: Generated Markdown content (summary, runbook, etc.)

## Design Principles

- **Single types file** - `0_types.ts` is the source of truth
- **Ports & Adapters** - External systems (LLMs, Wiki, DB) are accessed through interfaces
- **Synchronous Persistence** - Local-first SQLite with `better-sqlite3`
- **Repository Pattern** - Decouples business logic from storage implementation
- **Functional over classes** - Factory functions return typed interfaces

## Prerequisites

### System Dependencies

- **whisper-cpp**: `brew install whisper-cpp`
- **ffmpeg**: `brew install ffmpeg` (audio/video processing)
- **sqlite3**: `brew install sqlite3`
- **ollama**: `brew install ollama` (LLM/VLM services)

### Native Modules

This project uses `better-sqlite3`, which requires native compilation. pnpm 10+ requires explicit approval for packages that run build scripts:

```bash
pnpm approve-builds
```

Select `better-sqlite3` when prompted. This creates a `.pnpm-builds.yaml` file (committed to git) so future installs work automatically.

### Ollama Setup

1. **Install**: `brew install ollama`
2. **Pull Models**:
   - `ollama pull qwen3:8b` (Classification)
   - `ollama pull qwen3:32b` (Artifact generation)
   - `ollama pull minicpm-v:8b` (Vision/VLM)
   - `ollama pull nomic-embed-text` (Semantic embeddings)

## Testing

```bash
# Run all tests
pnpm test

# Run repository tests specifically
npx vitest run src/tests/db/repositories.test.ts
```
