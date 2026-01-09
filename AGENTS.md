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
│   ├── cap.adapter.ts            # Cap recording source
│   ├── whisper.adapter.ts        # Whisper transcription (audio conversion)
│   ├── intelligence.adapter.ts   # Ollama LLM classification
│   └── storage.adapter.ts        # Filesystem session storage
└── tests/
    ├── integration.test.ts        # Full pipeline tests
    ├── cap.adapter.test.ts       # Cap adapter unit tests
    ├── classify-session.test.ts  # Classification action tests
    └── intelligence.adapter.test.ts # Intelligence adapter tests

prompts/
└── classify.md                   # V2 classification prompt
```

### Key Principle: Port Interfaces

External systems are accessed through **port interfaces** defined in `0_types.ts`:

- **TranscriptionService**: WhisperAdapter (with automatic audio format conversion)
- **CaptureSource**: CapAdapter (and future adapters)
- **IntelligenceService**: OllamaAdapter (local LLM classification)
  - `classify()` - Multi-label session classification (5 scores 0-100)
  - `generate()` - Artifact generation (placeholder for M3)

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

## Milestone 2: Intelligence - Multi-Label Classification ✅

**Completed Date:** January 9, 2026

### Implemented Features
- **Ollama Integration**
  - Intelligence adapter with REST API (OpenAI-compatible format)
  - Retry logic (3 attempts, exponential backoff)
  - Timeout handling (300s default)
  - Health check integrated into adapter
  - System prompt for JSON-only output
  - **Ultra-simple parser** (10 lines - extracts JSON & validates)
  - Handles multiple response formats (0-1 or 0-100 percentages)

- **Multi-Label Classification**
  - **New format**: 5 scores 0-100 (meeting, debugging, tutorial, learning, working)
  - **Removed**: Old single-type format with confidence + entities
  - Added **"working"** session type for coding/building (non-debugging)
  - V2 prompt with detailed examples & indicators per type
  - Visual bar chart display (█ repeats)
  - Primary/secondary type identification
  - Artifact suggestions based on scores >50%

- **Session Persistence**
  - Storage adapter for filesystem-based session storage
  - Save sessions to `~/.escribano/sessions/`
  - Load session by ID
  - List all sessions

- **Transcript Reuse**
  - `classify-latest` checks for existing sessions before transcribing
  - Reuses transcript if available (saves time/resources)
  - `classify <id>` loads existing session
  - Clear error messages for missing transcripts

- **CLI Commands**
  - `classify-latest` - Classifies most recent session
  - `classify <id>` - Classifies specific session by ID
  - Pretty formatting with scores and bar charts
  - Relevance threshold: only show types ≥25%
  - Fixed: Display bugs (threshold, filter function)
  - Removed: Entity display code (deferred to M3)

- **Tests**
  - Intelligence adapter unit tests (3/5 passing, 2 expected failures)
  - Classification action unit tests (5/5 passing)
  - Session storage tests (integration)
  - Updated all test expectations for new format

- **PR Comments Addressed**
  - ✅ Moved `checkOllamaHealth()` into intelligence adapter
  - ✅ Added TODO comment for cache skip option
  - ✅ Removed TODO comment (cap.adapter.ts line 99)
  - ✅ Researched Ollama streaming (kept non-streaming - better for structured outputs)
  - ✅ Deleted `src/tests/cap-real.test.ts`
  - ✅ Fixed `cap.adapter.test.ts` (tests updated, all passing)

### Architecture Changes
**Old Schema:**
```typescript
{
  type: "meeting" | "debugging" | "tutorial" | "learning",
  confidence: 0.0-1.0,
  entities: [...]
}
```

**New Schema:**
```typescript
{
  meeting: 0-100,
  debugging: 0-100,
  tutorial: 0-100,
  learning: 0-100,
  working: 0-100  // NEW TYPE
}
```

### Files Created/Modified
```
src/0_types.ts                      ✅ Updated: Entity types removed, new Classification schema
src/adapters/intelligence.adapter.ts  ✅ Created: Ollama REST API, retry, health check, simple parser
src/adapters/storage.adapter.ts      ✅ Created: Filesystem session storage
src/actions/classify-session.ts      ✅ Created: Multi-label classification with transcript reuse
src/index.ts                         ✅ Updated: Classify commands, display formatting, bug fixes
prompts/classify.md                  ✅ V2 prompt with examples & indicators (replaced simple version)
src/tests/intelligence.adapter.test.ts   ✅ Updated: Tests for new format
src/tests/classify-session.test.ts ✅ Updated: Tests for new format
src/tests/cap.adapter.test.ts        ✅ Fixed and passing
```

### Usage Examples
```bash
# Start Ollama
ollama serve

# Pull model (example)
ollama pull qwen3:32b

# Full pipeline: transcribe + classify
pnpm run transcribe-latest && pnpm run classify-latest

# Reuse transcript (second run only classifies)
pnpm run classify-latest

# Expected output:
# 📊 Session Type Analysis:
#    🎯 meeting    █████████████████ 85%
#    📌 learning   █████████ 45%
#
# 🏷️  Primary Type: MEETING (85%)
#   📌 Secondary: learning (45%)
#
# 💡 Suggested Artifacts:
#    • Meeting summary & action items
```

### Key Achievements
- **Multi-label classification** handles mixed sessions correctly
- **Ultra-simple parser** (10 lines) vs over-engineered alternative
- **Fail-fast error handling** with clear, actionable messages
- **Works with multiple models** tested: qwen3:32b, llama3.1:8b, mistral:7b
- **No prompt versioning complexity** - single V2 prompt as source of truth
- **All PR comments addressed** - clean, maintainable codebase

### Next Milestone
Milestone 3: Artifacts - Generate Actionable Outputs
- Generate summary, action items, runbooks, guides, notes
- Add entity extraction and artifact prompts
- Screenshot extraction at entity timestamps

