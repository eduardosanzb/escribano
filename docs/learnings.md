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

## Agglomerative Clustering Rationale

We chose Agglomerative Hierarchical Clustering over K-Means because:
1. No need to specify the number of clusters upfront.
2. Natural hierarchical structure matches how work sessions evolve.
3. Easy to apply temporal constraints (observations far apart in time never merge).
