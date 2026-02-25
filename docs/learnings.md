# Escribano - Implementation Learnings

This document captures key technical findings and benchmarks discovered during development.

## OCR Quality Findings

Tesseract OCR on screen recordings produces high-quality text for code and terminal views but generates significant noise from menu bars, system clocks, and status indicators.

**Solution**: A post-processing filter (`src/utils/ocr.ts`) cleans these artifacts before they reach the embedding service, preventing "hallucinated" semantic similarities between unrelated segments.

## Embedding Success Rate

With the OCR cleanup utility, the success rate for `nomic-embed-text` reached **99.7%** (1771/1776 observations in sample tests). Rare failures correspond to nonsensical character strings correctly rejected by the model.

## VLM Benchmarks for Phase 3D.5

Testing various Vision-Language Models (VLM) for technical activity description:

| Model | tok/s | Quality | Recommended For |
|-------|-------|---------|-----------------|
| **MiMo VL 7B** | 78 | Highest | Deep analysis of code structure & specific files. |
| **qwen3-vl-8b** | 77 | High | General technical activity (Default). |
| **qwen3-vl-4b** | 115 | Medium | Fast processing where high detail isn't critical. |
| **minicpm-v:8b** | - | Low | Not recommended (too generic). |

## Processing Pipeline Timing (Sample: 1hr Recording)

| Phase | Duration |
|-------|----------|
| OCR Processing (1776 frames) | 321.8s |
| Embedding Generation | 35.3s |
| **Total Visual Pipeline** | **357.1s (~6 mins)** |

*Note: Audio pipeline duration varies significantly based on speech density.*

## Whisper Hallucination Prevention

Escribano uses a hybrid approach to prevent Whisper from looping on silence or background noise:

1. **Silero VAD**: Used as a pre-processor to extract only segments with actual human speech.
2. **Threshold Parameters**: Configured Whisper with `no_speech_threshold: 0.5` and `compression_ratio_threshold: 2.4`.
3. **Post-filtering**: Final safety net to strip known patterns like "Untertitel der Amara.org" or "Thanks for watching".

## V2 Pipeline Failure Analysis (2026-01-22)

Production testing on a 59-minute developer session revealed critical flaws in the OCR-centric architecture:

1. **OCR Text Uniformity**: Text extracted from IDE screens is too semantically similar across different activities (Terminal vs VSCode). This caused 1776 frames to cluster into **one single giant blob**.
2. **Regex Entropy**: URL/Project extraction from raw OCR text produced 746 garbage contexts (94% failure rate), misidentifying version numbers, filenames, and timestamps as URLs.
3. **Semantic Merge Failure**: Unrelated background audio (a YouTube video about cars) was merged with a debugging session due to coincidental embedding similarity (0.628), despite having no temporal or contextual relevance.

**Solution (ADR-005)**: Move to a **VLM-First** architecture where visual activity (from Qwen3-VL) drives segmentation, and audio is aligned purely by timestamp. OCR is deferred to the artifact generation phase.

## VLM Batching Optimization (Ollama)

Research into maximizing VLM throughput on M4 Max (128GB) discovered:
- **Sequential Batching > Parallel Single-Requests**: Running 10-image batches sequentially through Ollama's `/api/chat` endpoint is 3-4x faster than naive parallelism (`OLLAMA_NUM_PARALLEL=4`).
- **Memory Efficiency**: Sequential batching avoids memory thrashing and model duplication in unified memory.
- **Expected Speed**: ~450 frames can be processed in **<40 seconds** using 10-image batches.

## Phase 4 Optimization & Research (Jan 2026)

Research into maximizing the M4 Max (128GB) capabilities yielded a shift in model selection and inference strategy.

### Model Selection Update

| Model | Role | Throughput (MLX) | Notes |
|-------|------|------------------|-------|
| **Qwen3-VL-8B-Instruct** | **Primary** | ~72 tok/s | Replaces MiMo. 256K context + MLX support outweighs MiMo's reasoning edge. |
| **MiniCPM-V 2.6** | **Triage** | ~116 tok/s | Ultra-efficient (75% fewer tokens/img). Best for high-volume frame filtering. |
| **Qwen2.5-VL-7B** | **Specialist** | ~80 tok/s | Use for specific OCR tasks where Qwen3-8B hallucinates on numbers. |
| **MiMo VL 7B** | *Deprecated* | 78 tok/s | Lacks MLX/Continuous Batching support. Limited context (32K). |

### Scaling Strategy: MLX & Continuous Batching

Moving from Ollama (Go-based wrapper) to **MLX (Native Metal)** unlocks the M4 Max's unified memory potential:

1. **Parallel vs Sequential**: Shift from Sequential Batching to **Parallel Continuous Batching**. The M4 Max can handle **2-4 concurrent batches** (10-12 images each).
2.  **Quantization Floor**:
    *   **Vision Encoder (mmproj)**: MUST use **Q8_0** or **FP16**. Dropping to Q4 destroys OCR accuracy for code/terminal text.
    *   **LLM Component**: **Q4_K_M** is sufficient for reasoning.

### Critical Failure Modes (Qwen3-VL)
*   **Rotated Text**: 180° text sometimes read in reverse ("ABC" -> "CBA").
*   **Infinite Loops**: Dense tables can trigger infinite repetition ("| | |"). Fix: `temperature=0.1-0.3`.
*   **Numeric Regression**: 8B model struggles with long numeric strings compared to Qwen2.5-VL.

## qwen3-vl Multi-Image Output Failure (Feb 2026)

### Problem

qwen3-vl:4b fails to output JSON arrays for multi-image batches. The model correctly 
analyzes ALL images in the `thinking` field but only outputs ONE item to the `content` 
field.

### Evidence

Test batch with 8 images:
- **thinking field**: 12,000+ chars with complete analysis for all 8 images
- **content field**: 318 chars with only index 0

The thinking field contained properly structured data:
```
Index 0: LinkedIn profile → Viewing LinkedIn profile
Index 1: LinkedIn post (Bun/Next.js) → Reading technical blog
Index 2: Terminal with tests → Executing test sessions
...
Index 7: LinkedIn post → Reading LinkedIn post
```

### `/no_think` Prefix Does NOT Work

Contrary to qwen3 documentation, the `/no_think` prefix is ignored by qwen3-vl:4b:
- With `/no_think`: thinking field still populated with 12K chars
- Without `/no_think`: same behavior

This appears to be a known quirk in qwen3 vision models.

### Root Cause

Hypothesis: qwen3-vl's output generator has a token limit or stopping condition 
that triggers after outputting the first complete JSON object, despite having 
analyzed all images.

### Solution: Two-Model Approach

Use qwen3-vl for vision analysis + tiny model to parse thinking field:

| Step | Model | Role |
|------|-------|------|
| 1 | qwen3-vl:4b | Analyze images, populate thinking field |
| 2 | qwen3:0.6b | Parse thinking field → structured JSON array |

This leverages qwen3-vl's strong visual analysis while bypassing its output 
limitation.

### Performance Impact

- VLM call: ~45s per batch (8 images)
- Thinking parser: ~2-3s per batch
- Total: ~48s per batch (vs 45s single-model ideal)

The overhead is minimal compared to the 100% success rate improvement.

## MLX-VLM Interleaved Processing (Feb 2026)

POC validated interleaved multi-image processing with mlx-vlm:
- **Throughput:** 0.59 frames/sec (4.7x vs Ollama baseline)
- **Accuracy:** Frame-to-description mapping confirmed correct
- **Model:** Qwen3-VL-2B-Instruct-bf16

**Key Finding:** Token budget truncation on later frames (tunable via MAX_TOKENS or batch size).

**Full findings:** [MLX-VLM POC Learnings](./MLX-VLM-POC-LEARNINGS.md)  
**ADR:** [ADR-006: MLX-VLM Adapter](./adr/006-mlx-vlm-adapter.md)

## FFmpeg Scene Detection Optimization (Feb 2026)

### Problem
Scene detection with `select='gt(scene,0.4)'` was taking 57 minutes for a 3-hour 
video (65% of total processing time). FFmpeg was decoding all 648,000 frames at 
60fps to compare consecutive frames for scene changes.

### Solution
Added `-skip_frame nokey` flag to only decode I-frames (keyframes):

```bash
ffmpeg -skip_frame nokey -hwaccel videotoolbox -i "video.mp4" -vf "select='gt(scene,0.4)',showinfo" -vsync vfr -f null -
```

### Why It Works
Screen recording codecs insert I-frames at major visual transitions (app switches, 
window changes). By only decoding keyframes, we catch important scene changes while 
skipping ~95% of frames. Screen recordings typically have I-frames every 1-3 seconds.

### Results (180-min video comparison)

| Metric | Before | After | Speedup |
|--------|--------|-------|---------|
| Scene detection | 57.1 min | 2.8 min | **20.6x** |
| Frame extraction | 1.4 min | 1.4 min | ~same |
| VLM inference | 43.5 min | 48.2 min | ~same |
| **Total pipeline** | **102 min** | **52 min** | **1.9x** |
| Scenes detected | 99 | 93 | ~same coverage |
| Frames extracted | 457 | 452 | ~same |
| Segments created | 13 | 17 | **Better granularity** |

### Quality Impact

Summary quality **improved** with the optimized approach:
- More granular activity segmentation (17 vs 13 segments)
- Better temporal boundaries for activities
- No missed major transitions observed
- Both summaries captured same technical details and outcomes

### Tradeoffs
- May miss very brief transitions (<1 I-frame interval)
- In practice: no quality degradation observed on screen recordings
- **Recommendation:** Keep as default for all screen recordings
