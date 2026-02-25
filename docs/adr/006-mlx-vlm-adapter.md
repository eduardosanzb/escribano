# ADR-006: MLX-VLM Intelligence Adapter

## Status
Accepted

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
scripts/mlx_bridge.py
```

This implements the `IntelligenceService` port for VLM operations (`describeImages`).

### VLM/LLM Separation

The pipeline uses two separate adapters:
- **VLM (MLX)**: Frame analysis in `processRecordingV3()`
- **LLM (Ollama)**: Summary generation in `generateSummaryV3()`

```typescript
// In src/index.ts
const vlm = createMlxIntelligenceService();  // For describeImages()
const llm = createOllamaIntelligenceService(); // For generateText()

await processRecordingV3(..., { intelligence: vlm });
await generateSummaryV3(..., llm);
```

This separation follows clean architecture principles - each adapter has a single responsibility.

## Implementation

### Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  TypeScript                                                         │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ intelligence.mlx.adapter.ts                                   │  │
│  │  - spawn('python3', ['scripts/mlx_bridge.py'])                │  │
│  │  - Connect to Unix socket                                     │  │
│  │  - Send JSON requests                                         │  │
│  │  - Parse NDJSON responses (streaming)                         │  │
│  │  - Fire onImageProcessed callbacks per batch                  │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ Unix Domain Socket
                              │ /tmp/escribano-mlx.sock
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Python                                                             │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ mlx_bridge.py                                                 │  │
│  │  - Load model on startup (~5-10s)                             │  │
│  │  - Bind Unix socket, listen for connections                   │  │
│  │  - Process describe_images requests                           │  │
│  │  - Interleaved batch inference (4 frames/batch)               │  │
│  │  - Stream NDJSON responses per batch                          │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### IPC Protocol

**Transport:** Unix domain socket (`/tmp/escribano-mlx.sock`)

**Format:** NDJSON (newline-delimited JSON)

**Request:**
```json
{
  "id": 123,
  "method": "describe_images",
  "params": {
    "images": [
      {"imagePath": "/path/to/frame1.jpg", "timestamp": 42.5},
      {"imagePath": "/path/to/frame2.jpg", "timestamp": 52.5}
    ],
    "batchSize": 4,
    "maxTokens": 2000
  }
}
```

**Response (streaming per batch):**
```json
{"id": 123, "batch": 1, "results": [...], "partial": true, "progress": {"current": 4, "total": 12}}
{"id": 123, "batch": 2, "results": [...], "partial": true, "progress": {"current": 8, "total": 12}}
{"id": 123, "batch": 3, "results": [...], "partial": false, "progress": {"current": 12, "total": 12}, "done": true}
```

**Error response:**
```json
{"id": 123, "error": "Failed to load image: /path/to/frame.jpg"}
```

### Output Format (per frame)

Same pipe-delimited format as Ollama adapter:
```
description: ... | activity: ... | apps: [...] | topics: [...]
```

Parsed into:
```typescript
{
  index: number;
  timestamp: number;
  activity: string;
  description: string;
  apps: string[];
  topics: string[];
  imagePath: string;
  raw_response?: string;  // Only present when parsing fails
}
```

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `ESCRIBANO_VLM_MODEL` | `mlx-community/Qwen3-VL-2B-Instruct-bf16` | MLX model |
| `ESCRIBANO_VLM_BATCH_SIZE` | `4` | Frames per interleaved batch |
| `ESCRIBANO_VLM_MAX_TOKENS` | `2000` | Token budget per batch |
| `ESCRIBANO_MLX_SOCKET_PATH` | `/tmp/escribano-mlx.sock` | Unix socket path |
| `ESCRIBANO_PYTHON_PATH` | Auto-detected | Python executable (venv > system) |

### Error Handling

| Error Type | Behavior |
|------------|----------|
| Bridge not running | Auto-start, throw if fails |
| Connection refused | Throw error |
| Bridge crash | Throw error |
| Image load failure | Error response, continue batch |
| Parse failure | Store raw VLM response in `vlm_raw_response`, continue batch |
| Invalid response | Throw error |
| Socket timeout | Throw error |

### Lifecycle

1. TypeScript adapter spawns Python bridge on first `describeImages()` call
2. Python loads model, binds socket, sends `{"status": "ready"}`
3. TypeScript connects to socket
4. Requests/responses flow over socket
5. On process exit: TypeScript kills bridge, Python removes socket

### Logging

- **Python bridge:** `[MLX]` prefix, structured to stderr
- **TypeScript adapter:** `[VLM]` prefix, uses existing `log()` function
- **Debug mode:** `ESCRIBANO_VERBOSE=true` enables verbose logging

### Python Dependencies

```bash
# With uv (recommended)
uv pip install mlx-vlm

# Or with pip
pip install mlx-vlm
```

No virtual environment required (adapter auto-detects `~/.venv`).

### Code Quality

**Python (mlx_bridge.py):**
- PEP 8 compliant
- Full type hints
- Docstrings for public functions
- No bare `except:` clauses

**TypeScript (intelligence.mlx.adapter.ts):**
- Strict TypeScript
- No `any` types
- JSDoc for public methods
- Resource cleanup on exit

## Consequences

### Positive
- **4.7x faster processing** (0.59 fps vs 0.125 fps)
- **Native Metal** on Apple Silicon
- **Interleaved batching** works correctly (no image confusion)
- **Zero business logic changes** (adapter pattern)
- **Language-agnostic IPC** (socket works with any future backend: Rust, Go)
- Local-first (no cloud dependency)

### Negative
- Python dependency (mlx-vlm package)
- More complex than Ollama single binary
- ~10s model load on startup (one-time cost)

### Neutral
- Ollama adapter used for LLM operations (summary generation)
- Socket-based IPC adds ~100ms overhead per batch (negligible vs 1500ms inference)

## Testing Checklist

- [x] Bridge starts and signals ready
- [x] TypeScript connects successfully
- [x] Single batch processes correctly
- [x] Multiple batches stream incrementally
- [x] Callbacks fire after each batch
- [x] Output format matches Ollama (pipe-delimited)
- [ ] Error responses handled (partial - tested bridge startup failure)
- [x] Socket cleanup on exit
- [x] No zombie processes
- [x] End-to-end: process real recording (3h video, ~422s total)

## Alternatives Considered

| Alternative | Rejected Because |
|-------------|------------------|
| LM Studio MLX | Feature is new, no public VLM parallel benchmarks |
| Vision encoder pre-computation | Only 20% improvement (insufficient) |
| Multiple Ollama instances | 3.5x slower (memory contention) |
| Stay with sequential Ollama | Too slow for production |
| stdin/stdout IPC | Ties to subprocess spawning, not language-agnostic |
| HTTP localhost | More overhead, no benefit over Unix sockets |

## References

- [MLX-VLM POC Learnings](../MLX-VLM-POC-LEARNINGS.md)
- [VLM Parallel Research 2026](../VLM-PARALLEL-RESEARCH-2026.md)
- [VLM Benchmark Learnings](../VLM-BENCHMARK-LEARNINGS.md)
- [mlx-vlm GitHub](https://github.com/Blaizzy/mlx-vlm)
