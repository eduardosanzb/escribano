# ADR-005: VLM-First Visual Pipeline

## Status
Accepted

> **Note**: VLM inference now uses MLX-VLM (see ADR-006 for implementation details). This ADR describes the architectural shift from OCR-based to VLM-first processing, which remains valid. The inference engine changed from Ollama to MLX-VLM for 4.7x better throughput.

## Implementation Status
- Phase 1 (Core Pipeline): Implemented ✓
- Phase 2 (Audio Alignment): Implemented ✓
- Phase 3 (Context & TopicBlock): Implemented ✓ (simplified)
- Phase 4 (Schema Migration): Deferred
- Phase 5 (Artifact Generation): In progress (LLM summary)
- Phase 6 (Cleanup): Deferred

## Date
2026-01-22

## Context

### Problem Statement

The V2 visual pipeline (ADR-003) uses **OCR text → embeddings → semantic clustering** to segment recordings. In production testing on a 59-minute recording (2026-01-15), this approach **catastrophically failed**:

| Metric | Expected | Actual |
|--------|----------|--------|
| Visual observations | 1,776 | 1,776 |
| Visual clusters | 5-15 segments | **1 giant blob** |
| Contexts extracted | ~20 useful | **746 garbage** (94% URLs like `0.667`, `0001.jpg`) |
| Topic blocks | Multiple | **1** |
| Audio-visual merge | Meaningful | YouTube video (car subscriptions) merged with debugging |

### Root Cause Analysis

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ WHY THE V2 PIPELINE FAILED                                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. OCR TEXT SIMILARITY IS TOO UNIFORM                                      │
│     ────────────────────────────────────                                    │
│     All code screens produce similar OCR:                                   │
│     ["const", "function", "import", "return", "export", ...]                │
│                                                                             │
│     → Text embeddings cluster together (high cosine similarity)             │
│     → 1776 frames → 1 cluster                                               │
│                                                                             │
│  2. OCR REGEX EXTRACTS GARBAGE                                              │
│     ────────────────────────────────                                        │
│     Version numbers parsed as URLs: "0.667", "0.984", "1.2.3"               │
│     Filenames parsed as URLs: "0001.jpg", "index.ts"                        │
│     Timestamps parsed: "00.49.15", "32.972401z"                             │
│                                                                             │
│     → 746 "URL" contexts created (garbage)                                  │
│                                                                             │
│  3. SEMANTIC MERGE ≠ CONTEXTUAL RELEVANCE                                   │
│     ─────────────────────────────────────                                   │
│     YouTube video about "car subscriptions" playing in background           │
│     Similarity score with debugging session: 0.628                          │
│                                                                             │
│     → Merged into same TopicBlock (makes no sense)                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### User Insight

> "Why not just detect big screen changes and put all together, then batch to the VLM? Do we truly need OCR? It's adding a lot of entropy."

This insight led to researching VLM-first approaches that use **visual understanding** as the primary signal, rather than extracted text.

## Decision

Adopt a **VLM-First Visual Pipeline** that inverts the current approach:

| Aspect | V2 (Failed) | V3 (VLM-First) |
|--------|-------------|----------------|
| **Primary signal** | OCR text | VLM visual understanding |
| **Segmentation** | Embedding clustering | Activity continuity from VLM |
| **Audio alignment** | Semantic similarity merge | Temporal alignment only |
| **OCR usage** | Clustering + context extraction | Deferred to artifact generation |
| **Embeddings** | Required for clustering | Disabled (kept for future semantic search) |

### Core Changes

#### 1. Adaptive Frame Sampling

Reduce frames before VLM processing:

```text
Before: 1 frame / 2 seconds  → 1776 frames (100%)
After:  1 frame / 10 seconds → 354 frames (20%)
        + Gap fill (>15s)    → ~450 frames (25%)
```

**Research backing:**
- FOCUS (arXiv:2510.27280): <2% frames achieve SOTA accuracy.
- PRISM (arXiv:2601.12243): <5% frames retain 84% semantic content.

#### 2. Multi-Image VLM Batching

Send 10 images per Ollama `/api/chat` request:

```text
Before: 450 requests × 0.5s/request = 225 seconds
After:  45 batches  × 0.8s/batch   = 36 seconds (6x faster)
```

**Critical configuration:**
```bash
# Sequential batching, NOT parallel (counterintuitive but faster)
OLLAMA_NUM_PARALLEL=1
```

**Research backing:** Parallel VLM requests cause memory thrashing on unified memory architectures (40% slower than sequential batching).

#### 3. VLM-Driven Segmentation

Replace embedding clustering with activity continuity:

```text
VLM Output (per batch):
[
  {"index": 0, "activity": "debugging", "context": "Terminal, Python error"},
  {"index": 1, "activity": "debugging", "context": "Terminal, reading traceback"},
  {"index": 2, "activity": "research", "context": "Chrome, Stack Overflow"},
  ...
]

Segmentation Logic:
- Group consecutive frames with same activity
- Split when activity changes significantly
- Result: Natural TopicBlocks (not embedding blobs)
```

#### 4. Temporal Audio Alignment

No semantic similarity for audio-visual merge:

```text
Before: embed(audio) ↔ embed(visual) → merge if similarity > 0.6
After:  audio[T=100s] → attach to visual[T=100s] (same timestamp)
```

Audio becomes **secondary metadata**, not a clustering signal.

#### 5. Defer OCR to Artifact Generation

```text
Before: OCR every frame → embed → cluster → extract contexts (garbage)
After:  VLM describes frames → segment by activity → generate artifact
        └─> At artifact time: Run OCR on keyframes for code/command context
```

## Processing Pipeline (V3)

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                      PROCESSING PIPELINE (V3: VLM-First)                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐                                                           │
│  │   CAPTURE    │  Recording detected (Cap watcher)                         │
│  └──────┬───────┘                                                           │
│         │                                                                   │
│         ▼                                                                   │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  FRAME SAMPLING                                                      │   │
│  │  • Base: 1 frame / 10 seconds                                        │   │
│  │  • Gap fill: if gap > 15s, sample every 3s                           │   │
│  │  • Output: ~450 frames (25% of original)                             │   │
│  └───────────────────────────────────┬──────────────────────────────────┘   │
│                                      │                                      │
│         ┌────────────────────────────┴────────────────────────┐             │
│         │                                                     │             │
│         ▼                                                     ▼             │
│  ┌──────────────────────────────┐   ┌────────────────────────────────────┐  │
│  │  AUDIO TRACK                 │   │  VLM BATCH INFERENCE               │  │
│  │  • Silero VAD                │   │  • 10 images / request             │  │
│  │  • Whisper transcription     │   │  • Model: qwen3-vl-8b              │  │
│  │  • Word-level timestamps     │   │  • Output: activity + description  │  │
│  └──────────────┬───────────────┘   │  • Time: ~36 seconds               │  │
│                 │                   └───────────────────┬────────────────┘  │
│                 │                                       │                   │
│                 │                                       ▼                   │
│                 │                   ┌────────────────────────────────────┐  │
│                 │                   │  ACTIVITY SEGMENTATION             │  │
│                 │                   │  • Group by activity continuity    │  │
│                 │                   │  • Each segment = proto-TopicBlock │  │
│                 │                   │  • Expected: 5-15 segments         │  │
│                 │                   └───────────────────┬────────────────┘  │
│                 │                                       │                   │
│                 └───────────────────┬───────────────────┘                   │
│                                     │                                       │
│                                     ▼                                       │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  TEMPORAL ALIGNMENT                                                  │   │
│  │  • Attach audio transcript to segment by timestamp overlap           │   │
│  │  • No semantic similarity (audio is metadata, not clustering signal) │   │
│  └───────────────────────────────────┬──────────────────────────────────┘   │
│                                      │                                      │
│                                      ▼                                      │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  CONTEXT EXTRACTION                                                  │   │
│  │  • Extract from VLM descriptions (apps, topics, projects)            │   │
│  │  • Match to existing Contexts or create new                          │   │
│  │  • Form TopicBlocks with Context references                          │   │
│  └───────────────────────────────────┬──────────────────────────────────┘   │
│                                      │                                      │
│                                      ▼                                      │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  ARTIFACT GENERATION (on demand)                                     │   │
│  │  • NOW run OCR on keyframes for maximum code/command context         │   │
│  │  • Combine: VLM descriptions + audio transcript + OCR text           │   │
│  │  • Generate: summaries, action items, runbooks                       │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Schema Changes

### Removed/Disabled

| Change | Table/Column | Reason |
|--------|--------------|--------|
| DELETE | `cluster_merges` | No semantic audio-visual merge |
| DISABLE | `observations.embedding` | Not used for clustering (keep column for future) |
| DISABLE | `clusters.centroid` | Not used (keep column for future) |

### Modified

| Change | Column | Description |
|--------|--------|-------------|
| ADD | `observations.vlm_description` | VLM activity description (TEXT) |
| ADD | `observations.activity_type` | Enum: coding, debugging, meeting, reading, research, other |
| RENAME | `clusters` → `segments` | Clarity: VLM-based, not embedding-based |
| REMOVE | `observations.ocr_text` | Deferred to artifact generation (don't store) |

### New Activity Types

```typescript
type ActivityType = 
  | 'coding'      // Writing/editing code
  | 'debugging'   // Investigating errors, reading stack traces
  | 'meeting'     // Video call, screen share
  | 'reading'     // Documentation, articles
  | 'research'    // Browsing, Stack Overflow, searching
  | 'terminal'    // Command-line operations
  | 'other';      // Unclassified
```

## Performance Comparison

| Metric | V2 (OCR+Embedding) | V3 (VLM-First) | Improvement |
|--------|---------------------|-----------------|-------------|
| Frames processed | 1,776 | ~450 | 75% reduction |
| OCR operations | 1,776 | 0 (deferred) | 100% reduction |
| Embedding operations | 1,776 | 0 | 100% reduction |
| VLM batches | 0 | 45 | New |
| **Total processing time** | ~25 min | **~1 min** | **25x faster** |
| **Segment quality** | 1 blob | 5-15 expected | Qualitative improvement |

## Consequences

### Positive

1. **Semantic understanding**: VLM knows "debugging in Terminal" vs "reading docs".
2. **25x faster processing**: 1 minute vs 25 minutes.
3. **Cleaner contexts**: No garbage URLs from regex.
4. **Simpler audio**: Temporal alignment, no embedding merge.
5. **OCR where useful**: Maximum context during artifact generation.

### Negative

1. **VLM dependency**: Requires local qwen3-vl-8b (~8GB).
2. **Prompt engineering**: Need consistent JSON output.
3. **No semantic search (yet)**: Embeddings disabled; can re-enable later.

### Neutral

1. **Embeddings infrastructure kept**: Can re-enable for VLM description embeddings.
2. **Scene detection deferred**: MVP uses 10s sampling; can add ffmpeg later.

## Implementation Plan

### Phase 1: Core Pipeline Replacement (P0)

| Task | File | Description |
|------|------|-------------|
| 1.1 | `src/services/frame-sampling.ts` | Adaptive sampling (10s base, gap fill) |
| 1.2 | `src/services/vlm-batch.ts` | Multi-image Ollama batching (10 images/request) |
| 1.3 | `src/services/activity-segmentation.ts` | Group by activity continuity |
| 1.4 | `src/actions/process-recording-v3.ts` | New pipeline orchestrator |

### Phase 2: Audio Alignment (P0)

| Task | File | Description |
|------|------|-------------|
| 2.1 | `src/services/temporal-alignment.ts` | Attach audio by timestamp (no embedding) |
| 2.2 | Update VAD/Whisper | Keep word-level timestamps for precise alignment |

### Phase 3: Context & TopicBlock (P1)

| Task | File | Description |
|------|------|-------------|
| 3.1 | `src/actions/create-contexts.ts` | Extract from VLM descriptions, not OCR |
| 3.2 | `src/actions/create-topic-blocks.ts` | Create from segments, not clusters |

### Phase 4: Schema Migration (P1)

| Task | Description |
|------|-------------|
| 4.1 | Add migration for `vlm_description`, `activity_type` columns |
| 4.2 | Rename `clusters` → `segments` |
| 4.3 | Delete `cluster_merges` table |

### Phase 5: Artifact Generation (P2)

| Task | File | Description |
|------|------|-------------|
| 5.1 | `src/actions/generate-artifact.ts` | Add on-demand OCR for keyframes |
| 5.2 | Update prompts | Use VLM descriptions + audio + OCR |

### Phase 6: Cleanup (P2)

| Task | Description |
|------|-------------|
| 6.1 | Remove `process-recording-v2.ts` |
| 6.2 | Remove `clustering.ts` (embedding-based) |
| 6.3 | Remove `cluster-merge.ts` |
| 6.4 | Update AGENTS.md and architecture.md |

## Future Enhancements (Backlog)

### 1. Scene Detection Trigger (Priority: Medium)

**Problem it solves:**
With 10-second sampling, brief app switches (e.g., 5-second Slack check) may be missed entirely.

**Proposed solution:**
```bash
# ffmpeg scene detection on video
ffmpeg -i display.mp4 -vf "select='gt(scene,0.4)',showinfo" -vsync vfr frames/%04d.png
```

**Implementation:**
- Run scene detection as pre-pass before sampling.
- When scene change detected, add extra sample at that timestamp.
- Tune threshold (0.3-0.5) to avoid false positives from scrolling.

**Why deferred:**
- VLM can infer activity changes from adjacent frames.
- Adds processing step and threshold tuning complexity.
- 10s sampling covers 95%+ of use cases.

### 2. Semantic Search via VLM Description Embeddings (Priority: Medium)

**Problem it solves:**
Currently no way to search "find all debugging sessions" across recordings.

**Proposed solution:**
- Re-enable embedding infrastructure.
- Embed VLM descriptions (not OCR text).
- Store in `observations.embedding`.
- Query by cosine similarity.

**Why deferred:**
- Core pipeline must work first.
- VLM descriptions are higher quality than OCR for embedding.

### 3. macOS Accessibility APIs (Priority: Low)

**Problem it solves:**
During live capture, get definitive app/window switches from OS (not visual analysis).

**Proposed solution:**
- Use `NSWorkspace` + `NSRunningApplication` APIs.
- Log app focus changes with timestamps during recording.
- Eliminates need for visual scene detection.

**Why deferred:**
- Requires native Swift/Objective-C bridge.
- Cap integration needed.
- VLM-first works for post-hoc processing of existing recordings.

### 4. Parallel VLM with Model Sharding (Priority: Low)

**Problem it solves:**
Sequential batching is optimal now, but could be faster with proper parallelism.

**Proposed solution:**
- Load multiple model instances across GPU cores.
- True parallel inference without memory thrashing.
- Requires Ollama improvements or direct llama.cpp integration.

**Why deferred:**
- Current 36-second processing is already excellent.
- Ollama doesn't support this natively yet.

## References

- [FOCUS: Frame-Optimistic Selection](https://arxiv.org/abs/2510.27280) - <2% frame sampling.
- [PRISM: Label-guided Summarization](https://arxiv.org/abs/2601.12243) - <5% frame retention.
- [Qwen3-VL Technical Report](https://arxiv.org/abs/2410.12947) - Up to 128 frames in context.
- Escribano DB Analysis (2026-01-22) - 1776 → 1 cluster failure case.
- [Ollama Vision Batching](https://github.com/ollama/ollama/blob/main/docs/vision.md) - Multi-image syntax.
