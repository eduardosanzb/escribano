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

1.  **CaptureSource:** (`capture.cap.adapter.ts`)
    *   Watches for new `.cap` files.
2.  **TranscriptionService:** (`transcription.whisper.adapter.ts`)
    *   Audio -> Text.
3.  **VideoService:** (`video.ffmpeg.adapter.ts`)
    *   `extractFrames(timestamps)`
    *   `detectScenes(threshold)`
4.  **IntelligenceService:** (`intelligence.ollama.adapter.ts`)
    *   **Dual-Model Strategy:**
        *   *Fast Brain:* `qwen3:8b` (Classification).
        *   *Deep Brain:* `qwen3:32b` (Generation).
5.  **StorageService:** (`storage.fs.adapter.ts`)
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
│    (transcription.whisper)           │           (video.ffmpeg)             │
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
│  Adapter: intelligence.ollama (Fast Brain: qwen3:8b)                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            extract-metadata.ts                              │
│  (Identifies key moments, technical terms, and speakers)                    │
├─────────────────────────────────────────────────────────────────────────────┤
│  Input: transcripts + visualLogs + classification                           │
│  Adapter: intelligence.ollama (Reasoning Brain: qwen3:32b)                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            generate-artifact.ts                             │
│  (Produces Markdown and embeds high-res screenshots)                        │
├─────────────────────────────────────────────────────────────────────────────┤
│  Phase 1: Generate Markdown with [SCREENSHOT: timestamp] tags               │
│  Phase 2: Post-process tags using video.ffmpeg.extractFrames()              │
│  Adapter: intelligence.ollama (Reasoning Brain: qwen3:32b)                  │
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

---

## Visual Intelligence Pipeline (The Observer)

### Problem Statement

For **silent working sessions** (no audio), the system cannot classify or suggest artifacts 
without understanding the visual content. Processing every frame through a Vision LLM is 
prohibitively slow (~18 minutes for a 1-hour session at naive 1 frame/10s).

### Research Findings

Based on dialectical research into OCR, CLIP embeddings, and Vision LLMs:

| Technique | Speed | Output | Best For |
|-----------|-------|--------|----------|
| **OCR (Tesseract/PaddleOCR)** | ~200ms/frame | Raw text from screen | Code, terminal, UI text |
| **CLIP Embeddings (ViT-B/32)** | ~70ms/frame | Semantic vector | Clustering similar frames |
| **Vision LLM (minicpm-v:8b)** | ~3s/frame | Natural language | Understanding context |

**Key Insight:** OCR + CLIP handles 70-90% of the work. VLMs are reserved for segments 
that lack audio context or have low OCR density (images, diagrams, videos).

### Solution: Visual Indexing Pipeline

A unified Python script (`visual_observer_base.py`) handles the heavy lifting of visual understanding:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│               SCRIPT: visual_observer_base.py                               │
├─────────────────────────────────────────────────────────────────────────────┤
│  Input: frames/ directory                                                    │
│  Operations:                                                                 │
│    1. OCR each frame → extract text/code (Tesseract)                         │
│    2. Compute CLIP embedding → semantic vector (OpenCLIP ViT-B/32)            │
│    3. Cluster by cosine similarity (Agglomerative Clustering)                │
│    4. Label clusters heuristically (via CLIP zero-shot + UI categories)      │
│    5. Compute per-cluster metadata (avgOcrChars, timeRange, mediaIndicators) │
│  Output: visual-index.json                                                   │
│  Performance: High-speed processing without LLM dependencies.                │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Visual Intelligence (VLM) Strategy

While OCR and CLIP handle semantic indexing, complex visual scenes (diagrams, UI changes without text) are described using a **Vision LLM (MiniCPM-V)** via Ollama. 

To maintain performance, Escribano uses **Discriminator Logic** to only describe segments that lack audio context or have low OCR density.

### Discriminator Logic: Per-Cluster Analysis

```text
FOR each cluster in visual-index.json:

  needsVLM = FALSE

  // Check 1: Audio overlap
  IF cluster.timeRange has < 5 seconds of transcript overlap:
    needsVLM = TRUE  // No audio explains this segment

  // Check 2: OCR density (images, diagrams, videos)
  ELSE IF cluster.avgOcrCharacters < 500:
    needsVLM = TRUE  // Low text = visual content

  // Check 3: Media indicators
  ELSE IF cluster.mediaIndicators contains ["youtube", "video", ".png", ".jpg"]:
    needsVLM = TRUE  // User watching/viewing media

  IF needsVLM:
    Add cluster.representativeIdx to VLM queue
```

### Multi-Frame VLM Batching

When using vision models like `minicpm-v:8b`, Escribano batches multiple frames into single prompts where supported, significantly reducing the overhead of multiple LLM calls.

### Python Integration

Node.js spawns the Python pipeline via `uv`:

```text
spawn("uv", ["run", "src/scripts/visual_observer_base.py", ...])
```

### Storage Structure

```text
~/.escribano/sessions/{id}/
├── frames/                   # Extracted keyframes (1 FPS)
├── visual-index.json         # OCR + CLIP results
└── visual-descriptions.json  # VLM results (if generated)
```

