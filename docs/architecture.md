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
│  │                      VLM BATCH INFERENCE                                 ││
│  │  1. Interleaved batch processing (4 frames/batch)                       ││
│  │  2. MLX-VLM (Qwen3-VL-2B) identifies activity & context                 ││
│  │  3. Store results in Observation entity                                  ││
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
  │  │                                                      ││
  │  │  ┌──────────────────┐                                   ││
  │  │  │ format === 'narrative'?                             ││
  │  │  └────────┬─────────┘                                   ││
  │  │      YES  │   NO (card/standup)                             ││
  │  │           │                                             ││
  │  │          ▼           ▼                                          ││
  │  │  ┌─────────────┐  ┌─────────────────┐                               ││
  │  │  │ generate-   │  │ generate-       │                               ││
  │  │  │ summary-v3  │  │ artifact-v3     │                               ││
  │  │  └──────┬──────┘  └────────┬────────┘                               ││
  │  │         │                  │                                    ││
  │  │         ▼                  ▼                                    ││
  │  │  TopicBlocks →        Subjects →                            ││
  │  │  Activity Timeline    Subject Data                            ││
  │  │         │                  │                                    ││
  │  │         ▼                  ▼                                    ││
  │  │  summary-v3.md         card.md / standup.md                         ││
  │  │  (all vars filled)     (all vars filled)                            ││
  │  │         │                  │                                    ││
  │  │         └────────┬─────────┘                                    ││
  │  │                  ▼                                             ││
  │  │           Markdown Artifact                                    ││
  │  │                                                      ││
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
| `CaptureSource` | `capture.filesystem.adapter.ts` | Direct file input |
| `TranscriptionService` | `transcription.whisper.adapter.ts` | Audio → Text (whisper.cpp) |
| `VideoService` | `video.ffmpeg.adapter.ts` | Frame extraction, visual indexing |
| `AudioPreprocessor` | `audio.silero.adapter.ts` | VAD segmentation & cleanup |
| `IntelligenceService` | `intelligence.mlx.adapter.ts` | VLM inference (MLX-VLM, frame analysis) |
| `IntelligenceService` | `intelligence.ollama.adapter.ts` | LLM inference (summary generation) |
| `EmbeddingService` | `embedding.ollama.adapter.ts` | **(deprecated in V3, kept for future)** |
| `PublishingService` | `publishing.outline.adapter.ts` | Outline wiki publishing |
| `StorageService` | `storage.fs.adapter.ts` | **(deprecated in V3, V1 only)** |

---

## Artifact Format Architecture

Escribano supports three artifact formats, each with distinct data requirements:

### Format Comparison

| Format | Use Case | Data Path | Prompt |
|--------|----------|-----------|--------|
| `card` | Personal review, daily notes | Subject grouping | `card.md` |
| `standup` | Daily standup, async updates | Subject grouping | `standup.md` |
| `narrative` | Retrospectives, blog drafts | Per-segment timeline | `summary-v3.md` |

### Implementation Paths

**Card & Standup** (`generate-artifact-v3.ts`):
1. TopicBlocks → Subject grouping (LLM clustering)
2. Subjects → `{{SUBJECTS_DATA}}` / `{{WORK_SUBJECTS}}`
3. LLM synthesis → Markdown output

**Narrative** (`generate-summary-v3.ts`):
1. TopicBlocks → Subject grouping (for DB linking + personal filtering)
2. TopicBlocks → Activity timeline (`{{ACTIVITY_TIMELINE}}`)
3. Extract apps/URLs from descriptions (`{{APPS_LIST}}`, `{{URLS_LIST}}`)
4. LLM synthesis → Markdown output

### Why Two Paths?

**Narrative** requires chronological detail with specific timestamps and transcripts, producing a flowing work log.

**Card/Standup** benefit from thematic grouping that collapses time into concise bullet points.

### Critical Lesson: Incomplete Template Replacement = Hallucination

A bug in the original implementation demonstrated that **unfilled template placeholders cause LLMs to hallucinate**:

When `summary-v3.md` was used with only 3 of 6 variables replaced, the LLM:
1. Saw empty placeholders (`{{ACTIVITY_TIMELINE}}`, etc.)
2. Found an example block inside the prompt with specific apps/URLs
3. Copied the example pattern and invented matching details

**Solution:** Route narrative through `generate-summary-v3.ts` which correctly builds all required variables from TopicBlocks.
