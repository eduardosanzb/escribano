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
│   (Cap, Whisper, FFmpeg, Ollama, Filesystem)                    │
│   (Concrete implementations of Ports)                           │
├─────────────────────────────────────────────────────────────────┤
│                     APPLICATION (Use Cases)                     │
│   (ProcessSession, ClassifySession, GenerateArtifact)           │
│   (Orchestrates the Domain and calls Ports)                     │
├─────────────────────────────────────────────────────────────────┤
│                       DOMAIN (Core)                             │
│   (Entities: Session, Artifact)                                 │
│   (Value Objects: Transcript, VisualLog, Classification)        │
│   (Pure Business Logic & Rules)                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2. Ports & Adapters

External systems are abstracted behind ports (interfaces). This allows:
- **Swapping implementations:** (e.g., Switch from local `whisper.cpp` to OpenAI API without touching business logic).
- **Testability:** Easy testing with mock adapters.
- **Evolution:** Adding new capabilities (like Video Processing) by adding new Ports, not rewriting the core.

### 3. Domain Events

State changes emit domain events, enabling loose coupling and event-driven automation.
- `SessionRecorded`: A new capture has been detected.
- `VisualLogExtracted`: Screenshots/scenes have been processed.
- `SessionClassified`: The AI has determined the session type.
- `ArtifactGenerated`: A document has been created.

## Domain Model

### Entities
Entities have identity and a lifecycle.

*   **Session:** The core Aggregate Root.
    ```typescript
    interface Session {
      id: SessionId;
      recording: Recording;
      transcripts: TaggedTranscript[]; // Audio data
      visualLogs: VisualLog[];         // Video data
      classification: Classification | null;
      artifacts: Artifact[];
      status: SessionStatus;
    }
    ```
*   **Artifact:** A generated output.
    ```typescript
    interface Artifact {
      id: ArtifactId;
      type: ArtifactType;
      content: string; // Markdown with embedded image links
      format: 'markdown';
    }
    ```

### Value Objects
Immutable data structures.

*   **Recording:** Metadata about the raw capture (Video path, Audio paths).
*   **Transcript:** The text derived from audio.
*   **Visual Log:** The semantic data derived from video.
    ```typescript
    interface VisualLog {
      entries: VisualEntry[];
    }
    interface VisualEntry {
      timestamp: number;
      imagePath: string;
      description?: string; // "User opened VS Code"
    }
    ```
*   **Classification:** Multi-label scoring.
    ```typescript
    interface Classification {
      meeting: number;   // 0-100
      debugging: number; // 0-100
      working: number;   // 0-100
      // ...
    }
    ```

## Application Layer (Use Cases)

Each use case represents a single user intention.

### `ProcessSessionUseCase`
Orchestrates the raw-to-data conversion.
1.  **Audio Track:** Sends audio to `TranscriptionPort` (Whisper).
2.  **Video Track:** Sends video to `VideoPort` (FFmpeg) for scene detection.
3.  **Visual Analysis:** (Future) Sends frames to `VisualIntelligencePort` for description.
4.  **Result:** Updates Session with Transcript and VisualLog.

### `ClassifySessionUseCase`
Determines *what* the session was.
1.  Uses `IntelligencePort` (Fast Model).
2.  Input: Transcript + Visual Summary.
3.  Output: Multi-label Classification.

### `GenerateArtifactUseCase`
Creates the final deliverable.
1.  Uses `IntelligencePort` (Reasoning Model).
2.  Input: Transcript + Visual Log + Classification.
3.  Output: Markdown document (Runbook, Tutorial, etc.).

## Ports (Interfaces)

1.  **CaptureSource:** (`CapAdapter`)
    *   Watches for new `.cap` files.
2.  **TranscriptionService:** (`WhisperAdapter`)
    *   Audio -> Text.
3.  **VideoService:** (`FfmpegAdapter`)
    *   `extractFrames(timestamps)`
    *   `detectScenes(threshold)`
4.  **IntelligenceService:** (`OllamaAdapter`)
    *   **Dual-Model Strategy:**
        *   *Fast Brain:* `qwen3:8b` (Classification).
        *   *Deep Brain:* `qwen3:32b` (Generation).
5.  **StorageService:** (`FilesystemAdapter`)
    *   Persists Sessions (JSON) and Artifacts (Markdown/Images).

## Action Orchestration Flow

This diagram illustrates how data flows through the specific action files in the system.

```text
                                  RAW INPUT
                                (Video + Audio)
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            process-session.ts                               │
│  (Orchestrates raw-to-data conversion)                                      │
├──────────────────────────────────────┬──────────────────────────────────────┤
│           AUDIO TRACKS               │             VIDEO TRACK              │
│       (WhisperAdapter)               │           (FfmpegAdapter)            │
│               │                      │                  │                   │
│               ▼                      │                  ▼                   │
│         transcripts[]                │             visualLogs[]             │
└──────────────────────────────────────┴──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            classify-session.ts                              │
│  (Determines session nature: meeting, debugging, working, etc.)             │
├─────────────────────────────────────────────────────────────────────────────┤
│  Input: transcripts + visualLogs                                            │
│  Adapter: IntelligenceAdapter (Fast Brain: qwen3:8b)                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            extract-metadata.ts                              │
│  (Identifies key moments, technical terms, and speakers)                    │
├─────────────────────────────────────────────────────────────────────────────┤
│  Input: transcripts + visualLogs + classification                           │
│  Adapter: IntelligenceAdapter (Reasoning Brain: qwen3:32b)                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            generate-artifact.ts                             │
│  (Produces Markdown and embeds high-res screenshots)                        │
├─────────────────────────────────────────────────────────────────────────────┤
│  Phase 1: Generate Markdown with [SCREENSHOT: timestamp] tags               │
│  Phase 2: Post-process tags using FfmpegAdapter.extractFrames()             │
│  Adapter: IntelligenceAdapter (Reasoning Brain: qwen3:32b)                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
                                FINAL ARTIFACT
                          (Markdown + Screenshot Folder)
```

## Session Lifecycle

The flow of data through the system.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SESSION LIFECYCLE                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────┐                                                            │
│  │   RAW       │  Recording detected (Audio + Video)                        │
│  └──────┬──────┘                                                            │
│         │                                                                   │
│    PARALLEL PROCESSING ──────────────────────────┐                          │
│         │                                        │                          │
│         ▼                                        ▼                          │
│  [Audio Track]                            [Video Track]                     │
│  TranscriptionPort                        VideoPort (Scene Detect)          │
│         │                                        │                          │
│         ▼                                        ▼                          │
│  ┌─────────────┐                          ┌─────────────┐                   │
│  │ TRANSCRIPT  │                          │ VISUAL LOG  │                   │
│  └──────┬──────┘                          └──────┬──────┘                   │
│         │                                        │                          │
│         └───────────────► MERGE ◄────────────────┘                          │
│                             │                                               │
│                             ▼                                               │
│                      ┌─────────────┐                                        │
│                      │ CLASSIFIED  │  (Multi-Label Analysis)                │
│                      └──────┬──────┘                                        │
│                             │                                               │
│                             ▼                                               │
│                      ┌─────────────┐                                        │
│                      │  ARTIFACTS  │  (Deep Reasoning Generation)           │
│                      └─────────────┘                                        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Automation Flow

The `AutomationService` listens for events and triggers Use Cases.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                        AUTOMATION LEVELS                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Level 0 (Manual):      Recording → STOP (Wait for user)                     │
│                                                                              │
│  Level 1 (Detect):      Recording → Notify User → Process on click           │
│                                                                              │
│  Level 2 (Process):     Recording → Auto Transcribe/Extract → Auto Classify  │
│                         → Notify "Ready to Generate"                         │
│                                                                              │
│  Level 3 (Generate):    ... → Auto Generate Drafts → Notify "Review Draft"   │
│                                                                              │
│  Level 4 (Full Auto):   ... → Auto Publish (Not Recommended yet)             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```
