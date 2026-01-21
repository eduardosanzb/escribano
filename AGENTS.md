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
- **Transcription**: whisper.cpp (via Cap)
- **LLM**: Future: Ollama (local) or Claude API

## Architecture

This project follows **Clean Architecture** principles with a simplified flat structure.

### Current Implementation (Milestone 3.5)

```
src/
├── 0_types.ts                    # Core types, interfaces, Zod schemas
├── index.ts                      # CLI entry point
├── actions/
│   ├── process-recording-v2.ts   # V2 Pipeline: Recording → Observations → Clusters → Contexts
│   ├── create-contexts.ts        # Signals → Context entities
│   ├── create-topic-blocks.ts    # Clusters → TopicBlocks
│   └── ...
├── adapters/
│   ├── capture.cap.adapter.ts
│   ├── transcription.whisper.adapter.ts
│   ├── audio.silero.adapter.ts          # VAD preprocessing
│   ├── video.ffmpeg.adapter.ts
│   ├── intelligence.ollama.adapter.ts
│   ├── embedding.ollama.adapter.ts      # Text embeddings
│   ├── storage.fs.adapter.ts
│   └── publishing.outline.adapter.ts
├── services/                     # Pure business logic (no I/O)
│   ├── clustering.ts             # Agglomerative hierarchical clustering
│   ├── signal-extraction.ts      # Multi-tier signal extraction
│   ├── cluster-merge.ts          # Audio-visual cluster fusion
│   └── vlm-enrichment.ts         # VLM frame selection & description
├── utils/
│   ├── ocr.ts                    # OCR text cleanup
│   └── index.ts                  # Buffer utilities
├── db/
│   ├── index.ts                  # DB connection & repository factory
│   ├── migrate.ts                # Auto-run SQL migrations
│   ├── repositories/             # SQLite implementations
│   └── types.ts                  # Manual DB types
└── domain/
    └── recording.ts              # Recording entity & state machine
```

### Key Principle: Port Interfaces

External systems are accessed through **port interfaces** defined in `0_types.ts`. We use a descriptive naming convention for adapters: `[port].[implementation].adapter.ts`.

- **TranscriptionService**: `transcription.whisper.adapter.ts`
- **CaptureSource**: `capture.cap.adapter.ts`
- **IntelligenceService**: `intelligence.ollama.adapter.ts`
- **StorageService**: `storage.fs.adapter.ts`
- **VideoService**: `video.ffmpeg.adapter.ts`

### Visual Pipeline

The visual pipeline uses a hybrid approach:
- **Python** (`visual_observer_base.py`): Frame analysis (OCR + CLIP)
- **TypeScript** (`src/utils/ocr.ts`): Semantic OCR cleanup
- **TypeScript** (`src/services/clustering.ts`): Agglomerative hierarchical clustering
- **TypeScript** (`src/services/vlm-enrichment.ts`): VLM descriptions via Ollama

## Session Types (Multi-Label Classification)

**Format**: Each type scored 0-100. Sessions can have multiple types (e.g., 85% meeting + 45% learning).

| Type | Description | Indicators | Default Artifacts |
|------|-------------|------------|-------------------|
| meeting | Conversations, interviews, discussions | Multiple speakers, Q&A, decisions being made | Summary, action items |
| debugging | Fixing errors, troubleshooting | Error messages, "not working", investigation steps | Runbook, error screenshots |
| tutorial | Teaching, demonstrating | Step-by-step instructions, teaching tone | Step-by-step guide, screenshots |
| learning | Researching, studying | "Let me understand", research, exploration | Study notes & resources |
| working | Building, coding (not debugging) | Creating files, implementing features | Code snippets, commit message |

**Classification Example**:
```json
{
  "meeting": 85,
  "debugging": 10, 
  "tutorial": 0,
  "learning": 45,
  "working": 20
}
```

## Automation Levels

0. **Manual** - User triggers everything
1. **Detect + Ask** - Detects recordings, asks to process
2. **Process + Ask** - Auto transcribe/classify, asks for generation
3. **Generate + Ask** - Auto generate, asks before publishing
4. **Full Auto** - Everything automatic

## Learnings and Implementation Details

For detailed technical findings on OCR quality, VLM benchmarks, and clustering rationale, see [docs/learnings.md](docs/learnings.md).

## Code Conventions


