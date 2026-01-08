# AGENTS.md - Escribano

## Project Overview

**Escribano** ("The Scribe") is an AI-powered session intelligence tool that transforms recordings into actionable knowledge. It automatically captures, transcribes, classifies, and generates artifacts from work sessions.

## Architecture

This project follows **Domain-Driven Design (DDD)** and **Clean Architecture** principles.

### Bounded Contexts

1. **Capture Context** - Detecting and ingesting recordings from various sources
2. **Transcription Context** - Converting audio/video to text
3. **Intelligence Context** - Classifying sessions and understanding content
4. **Artifact Context** - Generating outputs (runbooks, summaries, etc.)
5. **Publishing Context** - Delivering artifacts to destinations
6. **Interaction Context** - User interaction and approval workflows

### Layer Structure

```
Domain Layer (innermost)
  └── Entities: Session, Artifact
  └── Value Objects: Recording, Transcript, Classification, AutomationPolicy
  └── Domain Events: SessionRecorded, SessionTranscribed, SessionClassified, ArtifactGenerated

Application Layer
  └── Use Cases: ProcessSession, Classify, GenerateArtifact, Publish, DeterminePolicy

Ports (Interfaces)
  └── TranscriptionPort, IntelligencePort, StoragePort, PublishingPort, InteractionPort

Adapters (Infrastructure) - outermost
  └── CapAdapter, WhisperAdapter, OllamaAdapter, OutlineAdapter, GitHubAdapter, S3Adapter
```

### Key Principle: Ports & Adapters

External systems are accessed through **ports** (interfaces). Multiple **adapters** can implement each port:

- **TranscriptionPort**: WhisperAdapter, FasterWhisperAdapter, DeepgramAdapter
- **IntelligencePort**: OllamaAdapter, ClaudeApiAdapter
- **StoragePort**: LocalFileSystemAdapter, HetznerS3Adapter
- **PublishingPort**: OutlineApiAdapter, GitHubProjectsAdapter
- **RecordingWatcherPort**: CapAdapter, MeetilyAdapter, FileSystemWatcherAdapter

## Technology Stack

- **Language**: TypeScript
- **Runtime**: Node.js / Bun
- **Integration**: OpenCode Plugin
- **LLM**: Ollama (local) or Claude API
- **Transcription**: whisper.cpp (via Cap/Meetily) or standalone

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

```
src/
├── domain/
│   ├── entities/
│   │   ├── Session.ts
│   │   └── Artifact.ts
│   ├── valueObjects/
│   │   ├── Recording.ts
│   │   ├── Transcript.ts
│   │   ├── Classification.ts
│   │   └── AutomationPolicy.ts
│   └── events/
│       └── DomainEvents.ts
├── application/
│   ├── useCases/
│   │   ├── ProcessSessionUseCase.ts
│   │   ├── ClassifySessionUseCase.ts
│   │   ├── GenerateArtifactUseCase.ts
│   │   └── PublishArtifactUseCase.ts
│   └── services/
│       └── AutomationService.ts
├── ports/
│   ├── TranscriptionPort.ts
│   ├── IntelligencePort.ts
│   ├── StoragePort.ts
│   ├── PublishingPort.ts
│   └── RecordingWatcherPort.ts
├── adapters/
│   ├── capture/
│   │   ├── CapAdapter.ts
│   │   ├── MeetilyAdapter.ts
│   │   └── FileSystemWatcherAdapter.ts
│   ├── transcription/
│   │   └── WhisperAdapter.ts
│   ├── intelligence/
│   │   └── OllamaAdapter.ts
│   ├── storage/
│   │   ├── LocalFileSystemAdapter.ts
│   │   └── S3Adapter.ts
│   └── publishing/
│       ├── OutlineAdapter.ts
│       └── GitHubProjectsAdapter.ts
└── infrastructure/
    ├── config/
    │   └── ConfigLoader.ts
    └── logging/
        └── Logger.ts
```

## Integration with Cap

Cap (https://github.com/CapSoftware/Cap) is the primary capture source. The CapAdapter:

1. Watches `~/.config/Cap/recordings/` for `.cap` directories
2. Parses `recording-meta.json` for video/audio paths
3. Reads `captions.json` for pre-computed transcripts
4. Returns Session with Recording + Transcript already populated

### Cap Transcript Format
```json
{
  "segments": [
    {
      "id": "segment-0-0",
      "start": 0.5,
      "end": 2.3,
      "text": "Hello world",
      "words": [
        {"text": "Hello", "start": 0.5, "end": 0.9},
        {"text": "world", "start": 1.0, "end": 2.3}
      ]
    }
  ]
}
```

## LLM Prompts

Classification and generation prompts are stored in `/prompts/`:

- `classify-session.md` - Determines session type from transcript
- `generate-summary.md` - Meeting summaries
- `generate-runbook.md` - Debugging runbooks
- `generate-tutorial.md` - Step-by-step tutorials
- `extract-actions.md` - Action item extraction

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

## Common Tasks

### Adding a New Capture Source
1. Create adapter in `src/adapters/capture/`
2. Implement `RecordingWatcherPort` interface
3. Register in configuration

### Adding a New Artifact Type
1. Add type to `ArtifactType` enum in domain
2. Create generation prompt in `/prompts/`
3. Update `GenerateArtifactUseCase` to handle new type

### Adding a New Publishing Destination
1. Create adapter in `src/adapters/publishing/`
2. Implement `PublishingPort` interface
3. Add configuration options
