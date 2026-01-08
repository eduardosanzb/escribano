# AGENTS.md - Escribano

## Project Overview

**Escribano** ("The Scribe") is an AI-powered session intelligence tool that transforms recordings into actionable knowledge. It automatically captures, transcribes, classifies, and generates artifacts from work sessions.

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

### Current Implementation (Milestone 1)

```
src/
├── 0_types.ts                    # All types, interfaces, Zod schemas
├── index.ts                      # CLI entry point
├── actions/
│   └── process-session.ts        # Recording → Transcript → Session
├── adapters/
│   ├── cap.adapter.ts            # Cap recording source
│   └── whisper.adapter.ts        # Whisper transcription
└── tests/
    ├── integration.test.ts        # Full pipeline tests
    ├── cap.adapter.test.ts       # Cap adapter unit tests
    └── cap-real.test.ts         # Cap adapter integration tests
```

### Key Principle: Port Interfaces

External systems are accessed through **port interfaces** defined in `0_types.ts`:

- **TranscriptionService**: WhisperAdapter (and future adapters)
- **CaptureSource**: CapAdapter (and future adapters)
- **IntelligenceService**: Future - OllamaAdapter, ClaudeApiAdapter

## Session Types

| Type | Description | Default Artifacts |
|------|-------------|-------------------|
| Meeting | Client workshops, 1:1s | Summary, Action Items |
| Debugging | Fixing issues | Runbook, Screenshots |
| Tutorial | Teaching, demos | Step-by-step guide, Screenshots |
| Learning | Exploring tech | Notes |

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

## File Structure

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
- Each adapter in its own directory

## File Structure

See Architecture section above for current flat structure. Future milestones will add:
- `src/adapters/` - More capture sources, transcription services, intelligence adapters
- `src/actions/` - Classification, artifact generation, publishing actions
- `src/infrastructure/` - Config, logging

## Integration with Cap

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
