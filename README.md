# Escribano

> *The scribe who transforms recordings into living knowledge*

AI-powered session intelligence tool that automatically captures, transcribes, classifies, and transforms your work sessions.

## Quick Start

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Typecheck
pnpm typecheck

# Build
pnpm build
```

## Project Status

See [MILESTONES.md](./MILESTONES.md) for complete roadmap and current progress.

**Current Focus:** Milestone 1 - Core Pipeline (Transcribe Last Cap Recording)

### Completed ✅
- [x] Project structure setup
- [x] Core types and interfaces (`0_types.ts`)
- [x] Cap adapter (reads filesystem recordings)
- [x] Whisper adapter (transcribes audio)
- [x] Process session action
- [x] Unit and integration tests
- [x] TypeScript configuration
- [x] Package scripts
- [x] CLI entry point
- [x] Model download and management
- [x] Whisper adapter completion (large-v3 model, cwd support)

### In Progress 🚧
- [ ] End-to-end integration testing

### Next Steps
1. Run integration tests
2. Test with real Cap recordings
3. Add intelligence adapter (Ollama) - Milestone 2
4. Create classification action - Milestone 2
5. Generate artifacts (Milestone 3)

```bash
# Run tests
pnpm test

# Watch mode
pnpm test --watch

# Run against real Cap recordings
pnpm test src/tests/cap-real.test.ts
```

## Architecture

```
src/
├── 0_types.ts           # All types and interfaces
├── adapters/
│   ├── cap.adapter.ts    # Read Cap recordings
│   └── whisper.adapter.ts # Transcribe with whisper
├── actions/
│   └── process-session.ts  # Transcribe recording → Session
└── tests/
    └── *.test.ts        # Unit + integration tests
```

## Design Principles

- **Single types file** - `0_types.ts` contains everything
- **Functions over classes** - Adapters are factory functions returning interfaces
- **Go-style** - Pure functions with explicit dependencies
- **Minimal viable** - Build just what's needed for the milestone
