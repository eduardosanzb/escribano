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

### Current Implementation (Milestone 2)

```
src/
├── 0_types.ts                    # All types, interfaces, Zod schemas
├── index.ts                      # CLI entry point
├── actions/
│   ├── process-session.ts        # Recording → Transcript → Session
│   └── classify-session.ts       # Session → Classification
├── adapters/
│   ├── capture.cap.adapter.ts            # Cap recording source
│   ├── transcription.whisper.adapter.ts  # Whisper transcription
│   ├── video.ffmpeg.adapter.ts           # Video processing (FFmpeg)
│   ├── intelligence.ollama.adapter.ts    # Ollama LLM services
│   └── storage.fs.adapter.ts             # Filesystem session storage
└── tests/
    ├── integration.test.ts               # Full pipeline tests
    ├── capture.cap.adapter.test.ts       # Cap adapter unit tests
    ├── classify-session.test.ts          # Classification action tests
    └── intelligence.ollama.adapter.test.ts # Intelligence adapter tests

prompts/
└── classify.md                   # V2 classification prompt
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
- **Python** (`visual_observer_base.py`): OCR (Tesseract) + CLIP embeddings + clustering
- **TypeScript** (`intelligence.ollama.adapter.ts`): VLM descriptions via Ollama

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

## Code Conventions

### ES Module Rules
- ALL imports must include `.js` extensions: `import { thing } from './0_types.js'`
- Use `tsx` for development (not `ts-node`)
- Build with `tsc` before running with `node dist/index.js`

### Loop & Iteration Style

Prefer modern, declarative iteration patterns:

```typescript
// ❌ AVOID: C-style for loops
for (let i = 0; i < items.length; i++) {
  const item = items[i];
  // ...
}

// ✅ PREFER: for...of when you need the item
for (const item of items) {
  // ...
}

// ✅ PREFER: for...of with entries() when you need index
for (const [index, item] of items.entries()) {
  // ...
}

// ✅ PREFER: Array methods for transformations
const results = items.map(item => transform(item));
const filtered = items.filter(item => item.isValid);
const sum = items.reduce((acc, item) => acc + item.value, 0);

// ❌ AVOID: Nested C-style loops
for (let i = 0; i < n; i++) {
  for (let j = i + 1; j < n; j++) {
    // ...
  }
}

// ✅ PREFER: Named functions for clarity
function computePairs<T>(items: T[]): Array<[T, T]> {
  const pairs: Array<[T, T]> = [];
  for (const [i, itemA] of items.entries()) {
    for (const [j, itemB] of items.entries()) {
      if (j <= i) continue;
      pairs.push([itemA, itemB]);
    }
  }
  return pairs;
}
```

### Algorithm Documentation

Complex algorithms MUST include a header comment explaining:
1. **WHAT** the algorithm does (one sentence)
2. **WHY** this approach was chosen over alternatives
3. **HOW** it works (step-by-step)
4. **EXAMPLE** showing input → output (when helpful)

Example:
```typescript
/**
 * ═══════════════════════════════════════════════════════════════
 * ALGORITHM: Agglomerative Clustering with Time Constraints
 * ═══════════════════════════════════════════════════════════════
 * 
 * WHAT: Groups observations by semantic similarity while respecting time.
 * 
 * WHY: Unlike K-means, no need to specify cluster count upfront.
 * 
 * HOW:
 * 1. Start with each observation as its own cluster
 * 2. Find the two closest clusters
 * 3. If close enough, merge them
 * 4. Repeat until no clusters are close enough
 * 
 * EXAMPLE:
 *   Input:  [A] [B] [C] [D] [E]
 *   Step 1: [A,B] [C] [D] [E]    (A & B merged)
 *   Step 2: [A,B] [C,D] [E]      (C & D merged)
 *   Final:  [A,B,C,D] [E]        (threshold reached)
 */
```

### Domain Layer Rules
- NO external dependencies
- Pure TypeScript, no I/O
- Entities have identity and lifecycle
- Value Objects are immutable

### Application Layer Rules
- Orchestrates domain objects
- Depends only on Domain and Ports (interfaces)
- One use case per file
- Use cases are the only entry points for operations

### Adapter Rules
- Implement port interfaces
- Handle all external I/O
- Can be swapped without changing business logic
- Each adapter in its own file
- **Naming Convention**: `[port].[implementation].adapter.ts` (e.g., `intelligence.ollama.adapter.ts`)
- **Factory Naming**: `create[Implementation][Port]` (e.g., `createOllamaIntelligenceService`)

## Integration with Cap

Cap (https://github.com/CapSoftware/Cap) is the primary capture source. The CapAdapter:

1. Watches `~/Library/Application Support/so.cap.desktop/recordings/` for `.cap` directories
2. Parses `recording-meta.json` for video/audio paths
3. Finds audio files (supports .ogg, .mp3, .wav, .m4a)
4. Finds video files (supports .mp4, .webm, .mov)
5. Returns Recording objects with metadata

### Cap Recording Structure

Each `.cap` directory contains:
- `recording-meta.json` - Metadata with video/audio file references
- Audio/video files - Actual media files
- (Optional) Other metadata files

**Note**: Cap recordings use a different metadata structure than initially expected. Paths are in `meta.segments[0].display.path` and `meta.segments[0].mic.path`.

## OpenCode Plugin

## OpenCode Plugin

The OpenCode plugin exposes these tools to Claude:

- `escribano.process_recording` - Process a recording file
- `escribano.list_pending` - List unprocessed recordings
- `escribano.generate_artifact` - Generate specific artifact
- `escribano.publish` - Publish artifact to destination

## Testing

- Domain layer: Unit tests (pure functions)
- Application layer: Integration tests with mock adapters
- Adapters: Integration tests with real services (where feasible)

## Environment Variables

Escribano uses environment variables for configuration. Copy `.env.example` to `.env` and adjust as needed.

| Variable | Default | Description |
|----------|---------|-------------|
| `ESCRIBANO_PARALLEL_TRANSCRIPTION` | `false` | Enable parallel audio transcription |
| `ESCRIBANO_FRAME_INTERVAL` | `2` | Seconds between extracted frames |
| `ESCRIBANO_FRAME_WIDTH` | `1920` | Frame width in pixels for extraction |

### Visual Pipeline Configuration

The visual pipeline extracts frames, runs OCR, and optionally describes images with a vision model.

- **Frame Interval**: Lower values = more frames, better temporal resolution, slower processing
  - `1` = 1 frame/second (dense, good for fast-changing content)
  - `2` = 1 frame/2 seconds (balanced, default)
  - `5` = 1 frame/5 seconds (sparse, good for static content)

- **Frame Width**: Higher values = better OCR accuracy, larger files
  - `1280` = Minimum for readable UI text
  - `1920` = Good balance (default)
  - `2560` = Best for small text, Retina displays

## Linting and Formatting

This project uses **Biome** for fast linting and formatting.

### Usage
- `pnpm lint` - Check code for issues
- `pnpm lint:fix` - Auto-fix linting issues
- `pnpm format` - Format all files
- `pnpm check` - CI-ready check (fails if changes needed)

### Integration
Biome runs via Neovim LSP for real-time diagnostics and formatting on save.

## Common Tasks

### Adding a New Capture Source
1. Create adapter in `src/adapters/`
2. Implement `CaptureSource` interface
3. Register in configuration

### Adding a New Artifact Type
1. Add type to `ArtifactType` enum in domain
2. Create generation prompt in `/prompts/`
3. Update action to handle new type

### Adding a New Publishing Destination
1. Create adapter in `src/adapters/`
2. Implement `PublishingPort` interface
3. Add configuration options

## Running the Application

### Development
```bash
# Run directly with tsx (no build needed)
pnpm run list
pnpm run transcribe-latest

# Or use tsx directly
npx tsx src/index.ts list
npx tsx src/index.ts transcribe-latest
```

### Production
```bash
# Build TypeScript to JavaScript
pnpm build

# Run from built files
node dist/index.js list
node dist/index.js transcribe-latest
```

### Testing
```bash
# Run all tests
pnpm test

# Run with UI
pnpm test:ui

# Lint and typecheck
pnpm lint && pnpm typecheck
```

## Common Tasks

### Adding a New Capture Source
1. Create adapter in `src/adapters/`
2. Implement `CaptureSource` interface
3. Register in configuration

### Adding a New Artifact Type
1. Add type to `ArtifactType` enum in domain
2. Create generation prompt in `/prompts/`
3. Update action to handle new type

### Adding a New Publishing Destination
1. Create adapter in `src/adapters/`
2. Implement `PublishingPort` interface
3. Add configuration options

## Running the Application

### Development
```bash
# Run directly with tsx (no build needed)
pnpm run list
pnpm run transcribe-latest

# Or use tsx directly
npx tsx src/index.ts list
npx tsx src/index.ts transcribe-latest
```

### Production
```bash
# Build TypeScript to JavaScript
pnpm build

# Run from built files
node dist/index.js list
node dist/index.js transcribe-latest
```

### Testing
```bash
# Run all tests
pnpm test

# Run with UI
pnpm test:ui

# Lint and typecheck
pnpm lint && pnpm typecheck
```

## Milestone 3: Artifacts, Visuals & Outline Sync ✅

**Completed Date:** January 15, 2026

### Implemented Features

- **Artifact Generation**
  - **8 Types**: summary, action-items, runbook, step-by-step, notes, code-snippets, blog-research, blog-draft.
  - **Ollama Generator**: Uses larger model (qwen3:32b) for high-quality Markdown production.
  - **Visual Integration**: LLM can request screenshots via `[SCREENSHOT: timestamp]`.

- **Visual Pipeline (The Observer)**
  - **OCR + CLIP**: Uses Python + Tesseract + OpenCLIP to extract semantic meaning from screen recordings.
  - **Scene Clustering**: Agglomerative clustering to detect activity segments (e.g., code editor, browser).
  - **VLM Descriptions**: Native Ollama API integration for `minicpm-v:8b` vision model.
  - **Configurable**: `ESCRIBANO_FRAME_INTERVAL` (2s) and `ESCRIBANO_FRAME_WIDTH` (1920px).

- **Knowledge Base Sync (Outline)**
  - **Outline Adapter**: Native REST API client for Outline wiki.
  - **Nested Structure**: Session parent document with artifact child documents.
  - **Global Index**: Auto-updated `📋 Session Index` document grouping sessions by month.
  - **Change Detection**: Content hashing to skip redundant uploads.

- **CLI Improvements**
  - **Numbered Shortcuts**: `#1`, `#2` instead of long session IDs.
  - **Commands**: `sessions`, `generate`, `artifacts`, `sync`, `sync-all`.
  - **ID Normalization**: Clean filesystem-safe IDs (no spaces, special chars).

### Files Created/Modified

```text
src/0_types.ts                      ✅ Updated: normalizeSessionId, OutlineSyncState, PublishingPort
src/adapters/capture.cap.adapter.ts ✅ Updated: ID normalization on parse
src/adapters/publishing.outline.adapter.ts ✅ Created: Outline REST API integration
src/actions/sync-to-outline.ts      ✅ Created: Sync orchestration with global index
src/scripts/visual_observer_base.py ✅ Created: Python OCR + CLIP clustering
src/adapters/video.ffmpeg.adapter.ts ✅ Updated: Frame extraction logic
src/index.ts                         ✅ Updated: New CLI commands & shortcuts
```

### Usage Examples

```bash
# 1. List latest sessions
pnpm run sessions

# 2. Generate all recommended artifacts for latest session
pnpm run generate latest all

# 3. Sync everything to Outline
pnpm run sync-all
```

---

## Next Milestone: Milestone 3.5 - Smart Segmentation
Focus on breaking "working" sessions into activity-based chunks for visual-first classification.

