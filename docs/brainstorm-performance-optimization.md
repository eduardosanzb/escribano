# Escribano Performance Optimization Brainstorm

## Overview

This document provides comprehensive context for brainstorming performance optimizations for **Escribano**, an AI-powered session intelligence tool that captures, transcribes, and generates summaries from screen recordings.

## The Problem

Processing a 3-hour screen recording currently takes **~90 minutes**. We want to reduce this significantly while maintaining or improving summary quality.

---

## Current Architecture

### Pipeline Flow

```
1. Audio Pipeline (reused from V2)
   ├─ Silero VAD → speech segments
   ├─ Whisper transcription per segment
   └─ Save as Observation rows (type='audio')

2. Visual Pipeline (V3: Smart Extraction)
   ├─ Scene detection (ffmpeg) → timestamps of visual changes
   ├─ Adaptive sampling (10s base + scene changes) → ~100-500 frames
   ├─ VLM inference (MLX-VLM, Qwen3-VL-2B) → activity + description per frame
   └─ Save as Observation rows (type='visual')

3. Activity Segmentation
   ├─ Group consecutive frames by activity continuity
   └─ Extract apps/topics from VLM descriptions

4. Temporal Audio Alignment
   └─ Attach audio transcripts to segments by timestamp overlap

5. Summary Generation
   ├─ Build prompt from template
   ├─ LLM call (Ollama, qwen3:32b) → narrative summary
   └─ Save markdown to ~/.escribano/artifacts/
```

### Technology Stack

| Component | Technology | Notes |
|-----------|------------|-------|
| Language | TypeScript (ES Modules) | Node.js runtime |
| VLM | MLX-VLM (Qwen3-VL-2B-Instruct-bf16) | Apple Silicon optimized |
| LLM | Ollama (qwen3:32b) | Summary generation |
| Audio | Silero VAD + Whisper (whisper-cli) | Speech detection & transcription |
| Video | FFmpeg (videotoolbox) | Frame extraction, scene detection |
| Database | SQLite (better-sqlite3) | Local storage |

### Hardware

- **Machine**: MacBook Pro M4 Max
- **Memory**: 128GB Unified Memory
- **CPU Cores**: 16

---

## Measured Performance Data

### Recording 1: 132 minutes (screen-recording-2026-02-21-at-21-13-07)

| Phase | Duration | Items | Rate |
|-------|----------|-------|------|
| Scene detection | 655s (10.9 min) | 114 scenes | - |
| Frame extraction | 72s (1.2 min) | 377 frames | 5.2 fps |
| VLM inference | 1483s (24.7 min) | 377 frames | **3.93s/frame** |
| Segmentation | 0.2s | - | - |
| **Total** | **~37 min** | | |

### Recording 2: 180 minutes (screen-recording-2026-02-22-at-09-45-32)

| Phase | Duration | Items | Rate |
|-------|----------|-------|------|
| Scene detection | 3425s (57.1 min) | 99 scenes | - |
| Frame extraction | 86s (1.4 min) | 457 frames | 5.3 fps |
| VLM inference | ~1800s (est. 30 min) | 457 frames | ~3.93s/frame |
| **Total** | **~88 min** | | |

### Key Observations

1. **Scene detection is slow**: 57 minutes for 3-hour video (65% of total time)
2. **VLM is consistent**: ~3.93s/frame regardless of video length
3. **Frame extraction is fast**: ~1.5 min for 500 frames

---

## Frame Sampling Logic

The adaptive sampling algorithm (`src/services/frame-sampling.ts`):

```typescript
// Base intervals adjust based on scene density:
// - < 20 scenes: 10s base (need dense sampling)
// - 20-50 scenes: 20s base (moderate coverage from scenes)
// - > 50 scenes: 30s base (scenes provide excellent coverage)

// For a 180-min video with 99 scenes:
// - Base interval: 30s → ~360 base frames
// - Scene changes: 99 additional frames
// - Gap filling: sparse
// - Total: ~457 frames
```

---

## Known Constraints

### 1. MLX Cannot Parallelize

**Critical finding**: MLX framework does not support parallel inference across multiple processes/GPUs on Apple Silicon. The unified memory architecture means:
- Single process can access all 128GB
- Cannot spawn multiple VLM workers
- Interleaved batching is the only optimization (already implemented)

### 2. Scene Detection Must Decode Every Frame

FFmpeg scene detection with `select='gt(scene,0.4)'`:
- Must decode every video frame to compare consecutive frames
- At 60fps, a 3-hour video = 648,000 frames to decode
- Even with videotoolbox hardware acceleration, this is slow

### 3. Quality Requirements

We cannot sacrifice summary quality. Key quality factors:
- Frame coverage: Need enough frames to capture activity transitions
- VLM description quality: Must be detailed enough for segmentation
- Scene awareness: Scene changes indicate activity switches

---

## Current Optimizations Already Implemented

1. **MLX-VLM interleaved batching**: Process 12 frames per batch (~3.5x faster than sequential)
2. **Smart frame extraction**: Only extract needed timestamps, not all frames
3. **Resume safety**: Pipeline can resume from any step if crashed
4. **Hardware acceleration**: FFmpeg videotoolbox for M-series chips
5. **FFmpeg keyframe-only scene detection**: `-skip_frame nokey` for 20x faster scene detection (57 min → 2.8 min)

---

## Ideas Already Considered

### Scene Detection Optimizations

| Idea | Estimated Savings | Tradeoffs | Status |
|------|-------------------|-----------|--------|
| **Keyframe-only detection (`-skip_frame nokey`)** | **~52 min (57→2.8 min)** | Minimal - may miss sub-second transitions | **✅ Implemented** |
| Downscale + fps filter before detection | ~52 min (57→5 min) | May miss small UI changes | Not needed |
| Skip scene detection entirely | 57 min | 2x more frames, more VLM time | Rejected |
| Parallel chunk processing | ~4x faster | More complexity | Not needed |

### VLM Optimizations

| Idea | Estimated Savings | Tradeoffs |
|------|-------------------|-----------|
| Smaller model (Moondream2) | ~50% faster | May reduce description quality |
| Larger batch size | Already maxed at 12 | Memory constraint |
| Parallel workers | **NOT POSSIBLE** | MLX architecture limitation |

### Sampling Optimizations

| Idea | Estimated Savings | Tradeoffs |
|------|-------------------|-----------|
| Increase base interval (15s→20s) | ~25% fewer frames | Less coverage |
| Higher scene threshold (0.4→0.5) | Fewer scene frames | May miss transitions |

---

## Goals

### Primary Goal
Reduce 3-hour video processing from **90 min → 30 min** (3x faster)

### Secondary Goals
1. Maintain or improve summary quality
2. Keep local-first (no cloud dependencies)
3. Preserve resume safety
4. Minimize code complexity

### Success Metrics
- **Throughput**: Frames processed per minute
- **Quality**: Human evaluation of summary usefulness
- **Coverage**: % of video time represented in frames

---

## Questions to Explore

### Scene Detection

1. Can we use perceptual hashing (pHash) instead of ffmpeg scene detection?
2. Could we sample frames first, then detect scenes from sampled frames?
3. Is there a GPU-accelerated scene detection option?

### VLM

1. Are there faster VLM models with similar quality to Qwen3-VL-2B?
2. Can we use model quantization (INT4/INT8) to speed up inference?
3. Could we process frames at lower resolution for VLM?

### Architecture

1. Could we pipeline scene detection and VLM (overlap execution)?
2. Is there value in a "quick mode" vs "thorough mode"?
3. Could we pre-process during recording (real-time frame selection)?

### Future (Rust Pipeline)

See `docs/screen_capture_pipeline.md` for planned real-time capture:
- Rust-based always-on capture
- pHash-based deduplication during capture
- Queue-based processing with multiple workers

---

## Relevant Files

| File | Purpose |
|------|---------|
| `src/adapters/video.ffmpeg.adapter.ts` | Scene detection, frame extraction |
| `src/adapters/intelligence.mlx.adapter.ts` | VLM inference via Unix socket |
| `src/services/frame-sampling.ts` | Adaptive frame selection algorithm |
| `src/actions/process-recording-v3.ts` | Main pipeline orchestrator |
| `scripts/mlx_bridge.py` | Python bridge for MLX-VLM |

---

## Environment Variables

```bash
ESCRIBANO_VLM_MODEL=mlx-community/Qwen3-VL-2B-Instruct-bf16
ESCRIBANO_VLM_BATCH_SIZE=12
ESCRIBANO_VLM_MAX_TOKENS=4000
ESCRIBANO_SAMPLE_INTERVAL=10
ESCRIBANO_SAMPLE_GAP_THRESHOLD=15
ESCRIBANO_SAMPLE_GAP_FILL=3
ESCRIBANO_SCENE_THRESHOLD=0.4
ESCRIBANO_SCENE_MIN_INTERVAL=2
```

---

## Your Task

Given this context, please brainstorm:

1. **Quick wins** we can implement in <1 day
2. **Medium-term optimizations** requiring 1-3 days of work
3. **Architectural changes** for future consideration
4. **Any creative solutions** we haven't considered

Focus on ideas that:
- Reduce total processing time
- Maintain or improve quality
- Work within MLX's single-process constraint
- Are implementable without major refactoring

Please provide specific, actionable recommendations with estimated impact.
