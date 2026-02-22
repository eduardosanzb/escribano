# ADR-006: MLX-VLM Intelligence Adapter

## Status
Draft

## Date
2026-02-22

## Context

### Current State
- VLM inference via Ollama (`intelligence.ollama.adapter.ts`)
- Sequential single-image processing
- Throughput: 8s/frame (~0.125 fps)
- 182 frames → ~25 minutes

### Problem
Ollama does not support parallel VLM requests (architectural limitation, not a bug):
```
"model architecture does not currently support parallel requests" architecture=qwen3vl
```

`OLLAMA_NUM_PARALLEL` works for text models but is explicitly unsupported for VLMs.

### Research Summary

| Approach | Framework | Result | Throughput |
|----------|-----------|--------|------------|
| Dual Ollama instances | Ollama | 3.5x slower (memory contention) | 0.035 fps |
| Parallel HTTP (single Ollama) | Ollama | Crashes | N/A |
| **Interleaved multi-image** | **MLX-VLM** | **Works** | **0.59 fps** |

See [VLM-PARALLEL-RESEARCH-2026.md](../VLM-PARALLEL-RESEARCH-2026.md) for full research.

### POC Results

- **Framework:** mlx-vlm (Python, native Metal)
- **Model:** Qwen3-VL-2B-Instruct-bf16 (~4GB)
- **Throughput:** 0.59 frames/sec (4.7x speedup)
- **Accuracy:** Frame-to-description mapping ✅ correct
- **Known issue:** Token budget truncation (tunable)

See [MLX-VLM-POC-LEARNINGS.md](../MLX-VLM-POC-LEARNINGS.md) for full POC findings.

## Decision

Adopt MLX-VLM as the VLM inference engine via a new adapter:

```
src/adapters/intelligence.mlx.adapter.ts
```

This implements the existing `IntelligenceService` port with MLX-VLM backend.

### Why Not Modify Ollama Adapter?
- Keeps fallback option (Ollama still works)
- Clean separation of concerns
- Config-based switching: `ESCRIBANO_VLM_BACKEND=mlx|ollama`

## Consequences

### Positive
- **4-5x faster processing** (0.59 fps vs 0.125 fps)
- **Native Metal** on Apple Silicon
- **Interleaved batching** works correctly (no image confusion)
- **Zero business logic changes** (adapter pattern)
- Local-first (no cloud dependency)

### Negative
- Python dependency (mlx-vlm package)
- More complex than Ollama single binary
- Token budget tuning needed for production

### Neutral
- Ollama adapter retained as fallback
- Implementation design deferred (follow-up task)

## Implementation Notes

### Configuration
```bash
ESCRIBANO_VLM_BACKEND=mlx  # or "ollama" for fallback
ESCRIBANO_VLM_MODEL=mlx-community/Qwen3-VL-2B-Instruct-bf16
ESCRIBANO_VLM_BATCH_SIZE=4  # TBD during implementation
ESCRIBANO_VLM_MAX_TOKENS=500  # TBD during implementation
```

### Token Budget Tuning (Follow-up)
- Current: 4 frames with MAX_TOKENS=500 truncates later frames
- Options: increase tokens, reduce batch size, per-frame budgeting
- Discover optimal values during adapter implementation

### Interface
Implements `IntelligenceService` port (see `0_types.ts`):
- `classifyFrame(imagePath: string): Promise<VLMResponse>`
- `generateSummary(blocks: TopicBlock[]): Promise<string>`

## Alternatives Considered

| Alternative | Rejected Because |
|-------------|------------------|
| LM Studio MLX | Feature is new, no public VLM parallel benchmarks |
| Vision encoder pre-computation | Only 20% improvement (insufficient) |
| Multiple Ollama instances | 3.5x slower (memory contention) |
| Stay with sequential Ollama | Too slow for production |

## References

- [MLX-VLM POC Learnings](../MLX-VLM-POC-LEARNINGS.md)
- [VLM Parallel Research 2026](../VLM-PARALLEL-RESEARCH-2026.md)
- [VLM Benchmark Learnings](../VLM-BENCHMARK-LEARNINGS.md)
- [mlx-vlm GitHub](https://github.com/Blaizzy/mlx-vlm)
