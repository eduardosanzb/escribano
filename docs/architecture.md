# Escribano Architecture

## Overview

Escribano follows **Domain-Driven Design (DDD)** and **Clean Architecture** principles to ensure the core business logic remains independent of external systems and frameworks.

## Core Principles

### 1. Dependency Rule

Dependencies point inward. The domain layer knows nothing about adapters, databases, or external APIs.

```
┌─────────────────────────────────────────────────────────────────┐
│                         ADAPTERS                                 │
│   (Cap, Whisper, Ollama, Outline, GitHub, S3, OpenCode)        │
├─────────────────────────────────────────────────────────────────┤
│                           PORTS                                  │
│   (Interfaces that adapters implement)                          │
├─────────────────────────────────────────────────────────────────┤
│                      APPLICATION                                 │
│   (Use cases that orchestrate domain logic)                     │
├─────────────────────────────────────────────────────────────────┤
│                         DOMAIN                                   │
│   (Entities, Value Objects, Domain Events)                      │
└─────────────────────────────────────────────────────────────────┘
```

### 2. Ports & Adapters

External systems are abstracted behind ports (interfaces). This allows:
- Swapping implementations without changing business logic
- Easy testing with mock adapters
- Multiple implementations of the same capability

### 3. Domain Events

State changes emit domain events, enabling:
- Loose coupling between components
- Event-driven automation flow
- Audit trail of what happened

## Domain Model

### Entities

Entities have identity and a lifecycle.

#### Session

The core aggregate root. Represents a single recorded work session.

```typescript
interface Session {
  id: SessionId;
  status: SessionStatus;
  type: SessionType | null;
  recording: Recording;
  transcript: Transcript | null;
  classification: Classification | null;
  artifacts: Artifact[];
  appliedPolicy: AutomationLevel;
  pendingApprovals: Approval[];
  metadata: SessionMetadata;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

#### Artifact

Generated outputs from a session.

```typescript
interface Artifact {
  id: ArtifactId;
  sessionId: SessionId;
  type: ArtifactType;
  content: string;
  format: 'markdown' | 'json' | 'image';
  destination: Destination | null;
  publishedAt: Timestamp | null;
}
```

### Value Objects

Immutable objects without identity.

#### Recording

```typescript
interface Recording {
  source: RecordingSource;
  videoPath: string | null;
  audioPath: string;
  duration: Duration;
  capturedAt: Timestamp;
  precomputedTranscript: Transcript | null;
}

interface RecordingSource {
  type: 'cap' | 'meetily' | 'raw';
  originalPath: string;
  metadata: Record<string, unknown>;
}
```

#### Transcript

```typescript
interface Transcript {
  fullText: string;
  segments: TranscriptSegment[];
  speakers: Speaker[];
  language: string;
}

interface TranscriptSegment {
  id: string;
  start: number;  // seconds
  end: number;
  text: string;
  speaker: Speaker | null;
  words: TranscriptWord[];
}
```

#### Classification

```typescript
interface Classification {
  type: SessionType;
  confidence: number;  // 0-1
  detectedEntities: Entity[];
  suggestedActions: ActionSuggestion[];
  reasoning: string;
}

type SessionType = 'meeting' | 'debugging' | 'tutorial' | 'learning';
```

#### AutomationPolicy

```typescript
interface AutomationPolicy {
  level: AutomationLevel;
  sessionTypeOverrides: Map<SessionType, AutomationLevel>;
  rules: AutomationRule[];
}

type AutomationLevel = 0 | 1 | 2 | 3 | 4;

interface AutomationRule {
  condition: RuleCondition;
  action: PolicyOverride;
}
```

### Domain Events

```typescript
type DomainEvent =
  | { type: 'SessionRecorded'; sessionId: SessionId; recording: Recording }
  | { type: 'SessionTranscribed'; sessionId: SessionId; transcript: Transcript }
  | { type: 'SessionClassified'; sessionId: SessionId; classification: Classification }
  | { type: 'ArtifactGenerated'; sessionId: SessionId; artifact: Artifact }
  | { type: 'ArtifactPublished'; artifactId: ArtifactId; destination: Destination }
  | { type: 'ApprovalRequested'; sessionId: SessionId; action: ActionType }
  | { type: 'ApprovalGranted'; sessionId: SessionId; action: ActionType };
```

## Application Layer

### Use Cases

Each use case represents a single user intention.

#### ProcessSessionUseCase

Transcribes a recording (if needed).

```typescript
interface ProcessSessionUseCase {
  execute(sessionId: SessionId): Promise<Session>;
}
```

Flow:
1. Load session
2. If `recording.precomputedTranscript` exists, use it
3. Otherwise, call `TranscriptionPort.transcribe(recording)`
4. Update session with transcript
5. Emit `SessionTranscribed` event

#### ClassifySessionUseCase

Determines session type and suggests actions.

```typescript
interface ClassifySessionUseCase {
  execute(sessionId: SessionId): Promise<Classification>;
}
```

Flow:
1. Load session with transcript
2. Call `IntelligencePort.classify(transcript)`
3. Update session with classification
4. Re-evaluate automation policy based on classification
5. Emit `SessionClassified` event

#### GenerateArtifactUseCase

Creates output artifacts.

```typescript
interface GenerateArtifactUseCase {
  execute(sessionId: SessionId, artifactType: ArtifactType): Promise<Artifact>;
}
```

Flow:
1. Load session with transcript
2. Load appropriate prompt template
3. Call `IntelligencePort.generate(prompt, transcript)`
4. If artifact type is `screenshots`, call `extractScreenshots()`
5. Create artifact entity
6. Emit `ArtifactGenerated` event

#### PublishArtifactUseCase

Delivers artifacts to destinations.

```typescript
interface PublishArtifactUseCase {
  execute(artifactId: ArtifactId, destination: Destination): Promise<void>;
}
```

Flow:
1. Load artifact
2. Call appropriate `PublishingPort.publish(artifact, destination)`
3. Update artifact with `publishedAt`
4. Emit `ArtifactPublished` event

### Automation Service

Orchestrates the automation flow based on policy.

```typescript
interface AutomationService {
  onSessionRecorded(event: SessionRecorded): Promise<void>;
  onSessionTranscribed(event: SessionTranscribed): Promise<void>;
  onSessionClassified(event: SessionClassified): Promise<void>;
}
```

The service listens to domain events and decides what to do next based on the `AutomationPolicy`.

## Ports

Interfaces that adapters must implement.

### TranscriptionPort

```typescript
interface TranscriptionPort {
  transcribe(recording: Recording): Promise<Transcript>;
  getSupportedLanguages(): string[];
}
```

### IntelligencePort

```typescript
interface IntelligencePort {
  classify(transcript: Transcript): Promise<Classification>;
  generate(prompt: string, context: GenerationContext): Promise<string>;
}
```

### StoragePort

```typescript
interface StoragePort {
  saveRecording(recording: Recording): Promise<string>;  // returns URL/path
  saveArtifact(artifact: Artifact): Promise<string>;
  loadSession(id: SessionId): Promise<Session | null>;
  saveSession(session: Session): Promise<void>;
}
```

### PublishingPort

```typescript
interface PublishingPort {
  publish(artifact: Artifact, destination: Destination): Promise<PublishResult>;
  getDestinationType(): string;
}
```

### RecordingWatcherPort

```typescript
interface RecordingWatcherPort {
  watch(callback: (recording: Recording) => void): void;
  stopWatching(): void;
  getSourceType(): string;
}
```

### InteractionPort

```typescript
interface InteractionPort {
  presentSuggestions(suggestions: ActionSuggestion[]): Promise<ActionSuggestion[]>;
  requestApproval(action: ActionType, context: ApprovalContext): Promise<boolean>;
  notify(message: string, level: 'info' | 'success' | 'warning' | 'error'): void;
}
```

## Session Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SESSION LIFECYCLE                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────┐                                                            │
│  │   RAW       │  Recording detected, not yet processed                     │
│  └──────┬──────┘                                                            │
│         │ TranscriptionPort.transcribe() or use precomputed                 │
│         ▼                                                                    │
│  ┌─────────────┐                                                            │
│  │ TRANSCRIBED │  Has transcript, not yet classified                        │
│  └──────┬──────┘                                                            │
│         │ IntelligencePort.classify()                                       │
│         ▼                                                                    │
│  ┌─────────────┐                                                            │
│  │ CLASSIFIED  │  Type known, awaiting artifact generation                  │
│  └──────┬──────┘                                                            │
│         │ User approves (or auto) → GenerateArtifactUseCase                 │
│         ▼                                                                    │
│  ┌─────────────┐                                                            │
│  │ ARTIFACTS   │  Artifacts generated, awaiting publishing                  │
│  │ GENERATED   │                                                            │
│  └──────┬──────┘                                                            │
│         │ User approves (or auto) → PublishArtifactUseCase                  │
│         ▼                                                                    │
│  ┌─────────────┐                                                            │
│  │ COMPLETE    │  All done!                                                 │
│  └─────────────┘                                                            │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Automation Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        AUTOMATION FLOW BY LEVEL                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Level 0 (Manual):                                                           │
│    Recording detected → STOP (wait for user command)                        │
│                                                                              │
│  Level 1 (Detect + Ask):                                                     │
│    Recording detected → Ask "Process?" → User approves → Transcribe        │
│                                                                              │
│  Level 2 (Process + Ask):                                                    │
│    Recording detected → Auto transcribe → Auto classify →                   │
│    Ask "Generate runbook?" → User approves → Generate                       │
│                                                                              │
│  Level 3 (Generate + Ask):                                                   │
│    Recording detected → Auto transcribe → Auto classify →                   │
│    Auto generate → Ask "Publish to Outline?" → User approves → Publish      │
│                                                                              │
│  Level 4 (Full Auto):                                                        │
│    Recording detected → Auto transcribe → Auto classify →                   │
│    Auto generate → Auto publish → Notify "Done!"                            │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Cap Integration Details

### File Locations

```
macOS:
~/Library/Application Support/Cap/
├── recordings/
│   └── {video-id}.cap/
│       ├── recording-meta.json    # Paths to video/audio
│       ├── content/
│       │   └── segments/
│       │       └── segment-0/
│       │           ├── display.mp4
│       │           ├── camera.mp4
│       │           └── audio-input.mp3
│       └── cursor.json
└── captions/
    └── {video-id}/
        └── captions.json          # Transcription
```

### CapAdapter Flow

1. Watch `recordings/` for new `.cap` directories
2. When found, read `recording-meta.json`
3. Check if `captions/{video-id}/captions.json` exists
4. If yes, parse transcript and attach to Recording
5. Emit `SessionRecorded` with pre-transcribed content

## Future: GPU Acceleration

Cap currently uses CPU-only Whisper. A fork could enable:

```toml
# For macOS Metal:
whisper-rs = { version = "0.14.3", features = ["metal"] }

# For CUDA:
whisper-rs = { version = "0.14.3", features = ["cuda"] }
```

This would significantly speed up transcription for raw files processed outside Cap.
