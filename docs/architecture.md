# Escribano Architecture

## Overview

Escribano follows **Domain-Driven Design (DDD)** and **Clean Architecture** principles to ensure the core business logic remains independent of external systems and frameworks.

Its mission is to **observe, understand, and document work sessions** by processing multimodal inputs (Audio + Video), enabling deep understanding of both spoken meetings and silent coding sessions.

## Core Principles

### 1. The Dependency Rule (Inward Dependencies)

Dependencies point inward. The domain layer knows **nothing** about adapters, databases, or external APIs.

```text
┌─────────────────────────────────────────────────────────────────┐
│                     INFRASTRUCTURE (Adapters)                   │
│   (cap, whisper, ffmpeg, ollama, fs)                            │
│   (Naming: [port].[implementation].adapter.ts)                  │
│├─────────────────────────────────────────────────────────────────┤
│                     APPLICATION (Use Cases)                     │
│   (ProcessSession, ClassifySession, GenerateArtifact)           │
│   (Orchestrates the Domain and calls Ports)                     │
│├─────────────────────────────────────────────────────────────────┤
│                       DOMAIN (Core)                             │
│   (Entities: Session, Artifact)                                 │
│   (Value Objects: Transcript, VisualLog, Classification)        │
│   (Pure Business Logic & Rules)                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2. Ports & Adapters

External systems are abstracted behind ports (interfaces). This project follows a strict naming convention: `src/adapters/[port].[implementation].adapter.ts`.

This allows:
- **Swapping implementations:** (e.g., Switch from local `whisper.cpp` to OpenAI API by adding `transcription.openai.adapter.ts` without touching business logic).
- **Testability:** Easy testing with mock adapters.
- **Evolution:** Adding new capabilities (like Video Processing) by adding new Ports, not rewriting the core.

### 3. Domain Events

State changes emit domain events, enabling loose coupling and event-driven automation.
- `SessionRecorded`: A new capture has been detected.
- `VisualLogExtracted`: Screenshots/scenes have been processed.
- `SessionClassified`: The AI has determined the session type.
- `ArtifactGenerated`: A document has been created.

## Domain Model (v3: VLM-First)

> **Note**: This model evolves the v2 model to a VLM-first approach. See ADR-005 for rationale.

### Aggregate Roots

Escribano uses four separate aggregate roots to enable cross-recording queries and normalized data:

```mermaid
erDiagram
    Recording ||--o{ Observation : contains
    Observation }o--o{ Context : "tagged via"
    Context ||--o{ TopicBlock : "referenced by"
    TopicBlock }o--|| Recording : "belongs to"
    Artifact }o--o{ TopicBlock : "sources from"
    Artifact }o--o{ Context : "sources from"

    Recording {
        string id PK
        string videoPath
        string audioMicPath
        string audioSystemPath
        number duration
        date capturedAt
        string status "raw|processing|processed|error"
        string sourceType "cap|file"
    }

    Observation {
        string id PK "UUIDv7"
        string recordingId FK
        string type "visual|audio"
        number timestamp
        string imagePath "nullable"
        string vlmDescription "nullable"
        string activityType "nullable"
        string text "nullable"
        string audioSource "nullable"
        string audioType "nullable"
        blob embedding "nullable (disabled in v3)"
    }

    Context {
        string id PK "UUIDv7"
        string type "extensible string"
        string name
        date createdAt
        json metadata "nullable"
    }

    ObservationContext {
        string observationId FK
        string contextId FK
    }

    TopicBlock {
        string id PK "UUIDv7"
        string recordingId FK
        json contextIds "FK array"
        json classification "nullable"
    }

    Artifact {
        string id PK "UUIDv7"
        string type
        string content
        string format "markdown"
        date createdAt
        json sourceBlockIds "FK array"
        json sourceContextIds "FK array"
    }
```

### Entity Definitions

**Recording** - Raw capture from screen recording tool
- Aggregate root for observations
- Status tracks processing lifecycle
- References original source metadata

**Observation** - Timestamped evidence from a recording
- Visual: frame + VLM description + Activity Type
- Audio: transcript segment + source (mic/system) + type (speech/silence/music)
- Immutable content, can add enrichments

**Context** - Semantic label, cross-recording
- Types: project, app, url, topic, etc. (extensible)
- Persists across recordings
- Matched by name or semantic similarity

**TopicBlock** - Coherent segment of work
- Per-recording, references contexts
- Observations derived via `ObservationContext` join table
- Optional classification enrichment

**Artifact** - Generated content
- Sources from blocks (single recording) or contexts (cross-recording)
- Markdown format with embedded images

---

## Processing Pipeline (v3: VLM-First)

> **See ADR-005 for detailed rationale.**

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                      PROCESSING PIPELINE (v3)                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────┐                                                            │
│  │  CAPTURE    │  Recording detected (Cap watcher or direct file input)     │
│  └──────┬──────┘                                                            │
│         │                                                                   │
│         ▼                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                      FRAME SAMPLING                                      ││
│  │  Adaptive Sampling: 10s base + gap fill (>15s)                          ││
│  │  Output: ~25% of original frames                                        ││
│  └──────────────────────────────────────────────────────────────────────────┘│
│         │                                                                   │
│         ▼                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                      VLM SEQUENTIAL INFERENCE                            ││
    │  1. Sequential single-image processing (one image per request)          ││
    │  2. VLM (qwen3-vl:4b) identifies activity & context                     ││
│  │  3. Store results in Observation entity                                 ││
│  └──────────────────────────────────────────────────────────────────────────┘│
│         │                                                                   │
│         ▼                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                      ACTIVITY SEGMENTATION                               ││
│  │  1. Group consecutive observations by activity continuity                ││
│  │  2. Each segment = TopicBlock                                           ││
│  └──────────────────────────────────────────────────────────────────────────┘│
│         │                                                                   │
│         ▼                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                      TEMPORAL ALIGNMENT                                  ││
│  │  Attach audio transcripts to TopicBlocks by timestamp overlap           ││
│  │  (Eliminates unreliable semantic embedding merge)                        ││
│  └──────────────────────────────────────────────────────────────────────────┘│
│         │                                                                   │
│         ▼                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                     CONTEXT DERIVATION                                   ││
│  │  Extract labels (apps, topics) from VLM descriptions                     ││
│  │  Match to existing Contexts or create new                               ││
│  └──────────────────────────────────────────────────────────────────────────┘│
│         │                                                                   │
│         ▼                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
  │  │  ARTIFACT GENERATION                                  ││
  │  │  LLM synthesis of VLM descriptions + audio transcripts                   ││
  │  │  Model: qwen3:32b  |  Output: Markdown summary                           ││
│  └──────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Audio Preprocessing (Whisper Hallucination Prevention)

Based on dialectical research, Escribano uses a hybrid approach:

1. **Silero VAD** for semantic speech detection (not FFmpeg amplitude)
2. **Whisper threshold parameters** for recovery from hallucination loops
3. **Post-filtering** known hallucination patterns as final safety net

```text
Audio File
    │
    ▼
┌─────────────────────────────────────┐
│  Silero VAD                         │
│  min_silence_duration: 1000ms       │
│  (semantic speech detection)        │
└───────────────┬─────────────────────┘
                │ Speech segments only
                ▼
┌─────────────────────────────────────┐
│  Whisper with thresholds            │
│  no_speech_threshold: 0.5           │
│  compression_ratio_threshold: 2.4   │
│  logprob_threshold: -1.0            │
└───────────────┬─────────────────────┘
                │
                ▼
┌─────────────────────────────────────┐
│  Hallucination Filter               │
│  - "Untertitel der Amara.org"       │
│  - "Thanks for watching"            │
│  - Repetition loops (.{20,})\1{4,}  │
└───────────────┬─────────────────────┘
                │
                ▼
           AudioObservation[]
```

---

## Storage Layer (SQLite)

Escribano uses SQLite for persistent storage, located at `~/.escribano/escribano.db`.

**Stack**:
- **better-sqlite3**: Synchronous driver for Node.js
- **Manual Types**: TypeScript interfaces matching the database schema in `src/db/types.ts`
- **Custom migrations**: SQL files in `migrations/` directory at project root

**Configuration**:
```sql
PRAGMA journal_mode = WAL;    -- Write-ahead logging
PRAGMA synchronous = NORMAL;  -- Balance safety/speed
```

### Repository Pattern

Domain code accesses data through repository interfaces:

```typescript
interface ContextRepository {
  findById(id: string): Context | null;
  findByTypeAndName(type: string, name: string): Context | null;
  findSimilar(name: string, threshold: number): Context[];
  save(context: Context): void;
}

interface TopicBlockRepository {
  findById(id: string): TopicBlock | null;
  findByRecording(recordingId: string): TopicBlock[];
  findByContext(contextId: string): TopicBlock[];  // Cross-recording query
  save(block: TopicBlock): void;
}
```

This enables storage backend swaps (e.g., SQLite → Turso) without changing domain code.

---

## Ports (v3)

| Port | Adapter | Purpose |
|------|---------|---------|
| `CaptureSource` | `capture.cap.adapter.ts` | Watch for Cap recordings |
| `TranscriptionService` | `transcription.whisper.adapter.ts` | Audio → Text (whisper.cpp) |
| `VideoService` | `video.ffmpeg.adapter.ts` | Frame extraction, visual indexing |
| `AudioPreprocessor` | `audio.silero.adapter.ts` | VAD segmentation & cleanup |
| `IntelligenceService` | `intelligence.ollama.adapter.ts` | VLM classification & generation |
| `EmbeddingService` | `embedding.ollama.adapter.ts` | **(deprecated in V3, kept for future)** |
| `StorageService` | `storage.fs.adapter.ts` | **(deprecated in V3, V1 only)** |
| `PublishingService` | `publishing.outline.adapter.ts` | **(deprecated in V3, V1 only)** |
