# MLX-VLM POC Learnings

**Date:** February 22, 2026  
**Hardware:** MacBook Pro M4 Max (128GB unified memory)  
**Status:** POC Proven ✅

---

## Executive Summary

| Metric | Value |
|--------|-------|
| **Approach** | Interleaved multi-image processing |
| **Throughput** | 0.59 frames/sec (~1.7s/frame) |
| **Baseline (Ollama)** | 0.125 frames/sec (8s/frame) |
| **Speedup** | **4.7x** |
| **Frame mapping accuracy** | ✅ Correct |
| **Model** | Qwen3-VL-2B-Instruct-bf16 |

**Verdict:** Interleaved processing works. Ready for ADR and production adapter.

---

## Parallel Processing Approaches Tested

| Approach | Result | Throughput | Accuracy | Notes |
|----------|--------|------------|----------|-------|
| Sequential (Ollama baseline) | Works | 0.125 fps (8s/frame) | ✅ | Current production |
| Batch (`batch_generate`) | TBD | Not tested | ? | Future exploration |
| Concurrent (asyncio semaphore) | TBD | Not tested | ? | Future exploration |
| **Interleaved** | **Works** | **0.59 fps** | **✅** | **POC proven** |

---

## Interleaved Processing Deep Dive

### How It Works

Multi-image prompt with frame labels:
```
Frame 1 (timestamp: 42s): [image]
Frame 2 (timestamp: 52s): [image]
Frame 3 (timestamp: 62s): [image]
Frame 4 (timestamp: 72s): [image]

For each frame: provide description, activity, apps, topics.
Output format: Frame N: description: ... | activity: ... | apps: [...] | topics: [...]
```

### Token Budget Issue (Current Limitation)

| Config | Value |
|--------|-------|
| `MAX_TOKENS` | 500 |
| `INTERLEAVED_BATCH_SIZE` | 4 |
| **Observation** | Later frames (3-4) truncate due to token budget |

**Example truncated output:**
```
Frame 1: [complete] ✅
Frame 2: [complete] ✅
Frame 3: [truncated] ⚠️
Frame 4: [truncated] ⚠️
```

**Solution paths (to be determined in ADR implementation):**
1. Increase `MAX_TOKENS` (500 → ?)
2. Reduce `INTERLEAVED_BATCH_SIZE` (4 → 2 or 3)
3. Per-frame token budgeting

### Frame-to-Description Mapping

✅ **Confirmed correct.** Unlike Ollama batch mode (which confused images), MLX-VLM interleaved processing correctly associates each frame label with its description.

---

## Model Comparison

| Model | Format | Batch Compatible | Notes |
|-------|--------|------------------|-------|
| **Qwen3-VL-2B-Instruct-bf16** | bf16 | ✅ | **Recommended** - tested successfully |
| gemma-3n-E4B-it-bf16 | bf16 | ✅ | Alternative option |

**Note:** bf16 (non-quantized) required for interleaved batching compatibility.

---

## Configuration

### Current POC Config
```python
INTERLEAVED_BATCH_SIZE = 4
MAX_TOKENS = 500
TEMPERATURE = 0.3
```

### Production Recommendations (TBD)
- Token budget tuning required
- Batch size may need adjustment based on frame complexity
- ADR implementation will determine optimal values

---

## Files

- POC scripts: `scripts/poc-vllm-mlx/`
- Reports: `docs/mlx-vlm-poc-interleaved-*.html`
- ADR: `docs/adr/006-mlx-vlm-adapter.md`
