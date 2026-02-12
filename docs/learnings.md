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
