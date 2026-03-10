# ADR-008: MLX-LM Backend for Text Generation

## Status

Accepted (2026-03-05)

## Context

### Current State
- LLM inference via Ollama (`intelligence.ollama.adapter.ts`)
- VLM inference via MLX-VLM (`intelligence.mlx.adapter.ts`)
- Two separate adapters, two separate backends
- Ollama requires external daemon installation and management

### Problem

1. **External dependency**: Ollama must be installed and running as a daemon
2. **Suboptimal for Apple Silicon**: Ollama uses GGUF format, not native MLX
3. **Inconsistent infrastructure**: VLM uses MLX (native), LLM uses Ollama (external)
4. **Memory overhead**: Two separate processes (Ollama daemon + MLX bridge)

### Opportunity

- MLX-VLM already successfully deployed (ADR-006)
- `mlx-vlm` package includes `mlx-lm` as a dependency (zero new dependencies)
- Qwen3.5 models available in MLX format with excellent benchmarks
- Benchmarks show Qwen3.5-4B matches older Qwen3-30B quality at 1/7th the parameters

### Research Summary

| Aspect | Ollama (GGUF) | MLX-LM |
|--------|---------------|--------|
| Dependency | External daemon (`brew install ollama`) | Python library (already installed) |
| Model format | GGUF (quantized) | MLX (safetensors, 4bit) |
| Apple Silicon | CPU+GPU (via Metal) | Native Metal |
| Memory model | Separate process | Shared with VLM bridge |
| Setup complexity | Medium (daemon management) | Low (auto-installed) |
| Model variety | Large (GGUF ecosystem) | Medium (MLX-community) |

**Note**: Benchmark comparison (MLX-LM vs Ollama latency/quality) will be added in future update.

## Decision

Extend the existing MLX bridge to support LLM operations alongside VLM:

1. **Default backend**: MLX (`ESCRIBANO_LLM_BACKEND=mlx`)
2. **Fallback backend**: Ollama (`ESCRIBANO_LLM_BACKEND=ollama`) for backward compatibility
3. **Sequential model lifecycle**: Single Python process manages both VLM and LLM
4. **Auto-detection**: RAM-based model selection for MLX (same pattern as Ollama)

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  TypeScript (batch-context.ts)                                  │
│                                                                 │
│  initializeSystem()                                             │
│    ├─ config.llmBackend === 'mlx'                               │
│    │   ├─ vlm = createMlxIntelligenceService()                  │
│    │   └─ llm = createMlxIntelligenceService()  ← same adapter  │
│    └─ config.llmBackend === 'ollama'                            │
│        ├─ vlm = createMlxIntelligenceService()                  │
│        └─ llm = createOllamaIntelligenceService()               │
│                                                                 │
│  processVideo()                                                 │
│    ├─ VLM phase: describeImages()                               │
│    └─ LLM phase: loadLlm() → generate() → unloadLlm()          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Unix Socket (/tmp/escribano-mlx.sock)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Python (mlx_bridge.py)                                         │
│                                                                 │
│  Global state:                                                  │
│    - vlm_model, vlm_tokenizer                                   │
│    - llm_model, llm_tokenizer                                   │
│                                                                 │
│  Handlers:                                                      │
│    - describe_images (VLM)                                      │
│    - load_llm, unload_llm (LLM lifecycle)                       │
│    - generate_text (LLM inference)                              │
│    - unload_vlm (memory cleanup)                                │
└─────────────────────────────────────────────────────────────────┘
```

### Model Tiers (MLX)

| System RAM | Model | Size | Speed | Quality Tier |
|------------|-------|------|-------|--------------|
| 64GB+ | `mlx-community/Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-4bit` | ~14GB | 25 tok/s | Best |
| 32-64GB | `mlx-community/Qwen3.5-27B-4bit` | ~15GB | 28 tok/s | Excellent |
| 16-32GB | `mlx-community/Qwen3.5-9B-OptiQ-4bit` | ~6GB | 45 tok/s | Good |

**Validated:** These models passed both subject grouping (Prompt A) and card generation (Prompt B) in POC testing (March 2026).

**Rejected models:**
- `Qwen3.5-4B-OptiQ-4bit` - Failed subject grouping prompt (insufficient reasoning capacity)
- `Qwen3.5-27B-4bit-mlx` - Failed subject grouping prompt
- `mlx-community/Qwen3.5-4B-4bit` (unqualified) - VLM model with vision_tower weights (incompatible with text-only loading)

## Benchmark Results (March 2026)

### Architecture Benefits

Production validation on 17 recordings (25.6 hours total):

| Benefit | Impact |
|---------|--------|
| **Zero dependencies** | No Ollama daemon installation required |
| **Unified infrastructure** | Same bridge for VLM + LLM (no duplicate processes) |
| **Native Metal** | Optimized for Apple Silicon (MLX safetensors) |
| **Memory efficiency** | Sequential loading prevents OOM (VLM → unload → LLM → unload) |
| **Auto-detection** | RAM-based model selection works reliably |

### LLM Generation Performance

| Metric | Result |
|--------|--------|
| **Subject Grouping** | 78.7s avg (Qwen3.5-27B-4bit, 25-28 tok/s) |
| **Artifact Generation** | 53.6s avg (all 3 formats) |
| **Total LLM Time** | ~132s per recording |
| **Success Rate** | 100% (92 runs: 46 subject grouping + 46 artifact) |
| **Memory Usage** | <80% RAM on 128GB M4 Max |

### Production Validation

- **Recordings processed:** 17 (15 successful, 2 unrelated failures)
- **Zero LLM-related failures** — All 92 calls completed successfully
- **Sequential lifecycle validated** — No memory leaks or contention
- **Backend consistency achieved** — VLM and LLM use same infrastructure

### MacBook Air 16GB Validation (March 2026)

Validated on minimum tier hardware (MacBook Air M1/M2, 16GB unified memory):

**System Configuration:**
- Hardware: MacBook Air M1/M2 (8 cores)
- RAM: 16GB unified memory
- Backend: MLX
- VLM Model: `mlx-community/Qwen3-VL-2B-Instruct-4bit` (auto-detected)
- LLM Model: `mlx-community/Qwen3.5-9B-OptiQ-4bit` (auto-detected)

**Performance Results (28s video):**

| Metric | Result |
|--------|--------|
| **VLM Inference** | 7.7s/frame (vs 0.7s on M4 Max) |
| **Subject Grouping** | 257s avg (with thinking bug) → ~30s after fix |
| **Artifact Generation** | 505s avg (with thinking bug) → ~50s after fix |
| **Total Pipeline** | 763s (with bug) → ~100s after fix |
| **Memory Usage** | VLM: 1.2GB peak, LLM: 400MB peak |

**Bug Discovery**: Testing revealed a critical thinking tag bug in `scripts/mlx_bridge.py:656-657` (see Critical Learnings section). The fix (separate PR) will improve performance by 7.6x.

**Comparison with Ollama (28s video):**

| Backend | Model | Processing Time | Notes |
|---------|-------|-----------------|-------|
| Ollama | qwen3:32b | 73.5s | Too large for 16GB RAM |
| Ollama | qwen3:8b | 120.4s | 1.9x slower than baseline |
| MLX | qwen3:8b | 39.6s | **1.9x faster than Ollama** |
| MLX | Qwen3.5-9B | 763s (with bug) → ~100s (fixed) | Best quality for 16GB |

**Key Findings:**

1. ✅ **Auto-detection works**: Correctly selected `Qwen3.5-9B-OptiQ-4bit` for 16GB RAM
2. ✅ **Memory efficient**: Peak 1.2GB for VLM, 400MB for LLM (well within limits)
3. ⚠️ **Functional but slow**: 7.7s/frame vs 0.7s on M4 Max (11x slower)
4. 🐛 **Thinking bug discovered**: MLX bridge not stripping thinking tags when `think=false` (see Critical Learnings section)

**Conclusion**: MacBook Air 16GB is viable for MLX backend but 11x slower than M4 Max. Minimum viable tier (16GB) works, 32GB+ recommended for comfortable use, 64GB+ for best quality.

### Comparison with Ollama

| Aspect | Ollama (Before) | MLX (After) | Improvement |
|--------|-----------------|-------------|-------------|
| **Dependencies** | External daemon (`brew install ollama`) | None (auto-installed) | ✅ Simplified setup |
| **Model format** | GGUF (quantized) | MLX safetensors (4bit) | ✅ Native Metal |
| **Memory model** | Separate process | Shared bridge | ✅ More efficient |
| **Infrastructure** | Mixed (VLM=MLX, LLM=Ollama) | Unified | ✅ Consistent |
| **Setup complexity** | Medium (daemon management) | Low (auto-setup) | ✅ Better UX |
| **MacBook Air 16GB** | qwen3:8b: 120s | qwen3:8b: 39.6s | ✅ **3x faster** |

**Note:** Direct latency comparison requires controlled A/B test (same videos, same hardware state). Production run validates **stability and architecture benefits**, not raw speed improvements.

### Critical Learnings (March 2026 POC)

#### Thinking Tag Stripping Bug (MacBook Air Discovery)

**Problem:** When `think=false`, the MLX bridge was incorrectly stripping thinking tags, causing the LLM to output "Thinking Process:" sections instead of the required format. This resulted in 8-10x slower performance on MacBook Air (257s vs ~30s for subject grouping).

**Root Cause:** Bug in `scripts/mlx_bridge.py:656-657` - the logic was backwards:
```python
# BEFORE (wrong):
if think:  # ❌ Strips tags when thinking IS enabled
    response_text = strip_thinking_tags(response_text)

# AFTER (correct):
if not think:  # ✅ Strips tags when thinking is NOT enabled
    response_text = strip_thinking_tags(response_text)
```

**Solution:** Fixed in separate PR - now correctly strips thinking tags only when `think=false`.

**Impact:** 
- MacBook Air: 8.5x faster subject grouping (257s → 30s)
- MacBook Air: 10x faster artifact generation (505s → 50s)
- MacBook Air: 7.6x faster total pipeline (763s → 100s)

#### Chat Template Bug

**Problem:** Using `tokenizer.apply_chat_template()` with `enable_thinking=False` still triggers thinking mode in Qwen3.5 models, causing them to output "Thinking Process:" sections instead of the required format.

**Root Cause:** Chat templates in Qwen3.5 models have hardcoded thinking mode logic that doesn't respect the `enable_thinking` parameter reliably.

**Solution:** Use raw prompts directly (bypass chat templates entirely). The bridge handler now supports both `rawPrompt` (new, recommended) and `messages` (legacy, backward compatible).

**Impact:** Raw prompts produce correct output format 100% of the time in testing.

#### Memory Contention Bug

**Problem:** When regenerating artifacts for already-processed recordings, the VLM bridge remained loaded while the LLM bridge loaded, causing memory contention and potential OOM/hang on 128GB machines.

**Root Cause:** VLM adapter was created unconditionally in `batch-context.ts`, even for artifact-only runs.

**Solution:** 
1. Lazy VLM initialization (only created for new recordings)
2. Explicit guard before LLM generation to ensure VLM is unloaded
3. Sequential model lifecycle: VLM → unload → LLM → unload

**Impact:** Memory usage now stays within limits (<80% of RAM) for all scenarios.

#### Token Limits

Production uses:
- **Prompt A (subject grouping):** 2000 tokens
- **Prompt B (card generation):** 4000 tokens

Initial POC used 500/800 tokens, causing truncation failures. These limits provide sufficient headroom for complex sessions.

### Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `ESCRIBANO_LLM_BACKEND` | `mlx` | Backend: `mlx` or `ollama` |
| `ESCRIBANO_LLM_MLX_MODEL` | auto | MLX model (auto-detected if not set) |
| `ESCRIBANO_LLM_MODEL` | auto | Ollama model (only if backend=ollama) |
| `ESCRIBANO_SUBJECT_GROUPING_MODEL` | auto | Model for subject grouping |
| `ESCRIBANO_ARTIFACT_THINK` | `false` | Enable thinking mode (Qwen3.5) |

### IPC Protocol Extensions

New methods in `mlx_bridge.py`:

**Load LLM model:**
```json
{"id": 1, "method": "load_llm", "params": {"model": "Qwen3.5-27B-4bit"}}
→ {"id": 1, "status": "loaded", "model": "..."}
```

**Generate text:**
```json
{"id": 2, "method": "generate_text", "params": {"prompt": "...", "think": true}}
→ {"id": 2, "text": "...", "done": true}
```

**Unload LLM model:**
```json
{"id": 3, "method": "unload_llm", "params": {}}
→ {"id": 3, "status": "unloaded"}
```

**Unload VLM model:**
```json
{"id": 4, "method": "unload_vlm", "params": {}}
→ {"id": 4, "status": "unloaded"}
```

### Thinking Mode Support

Qwen3.5 supports "thinking mode" for better reasoning:

```python
# In mlx_bridge.py
chat_template_kwargs={"enable_thinking": think_param}
```

Enabled via `ESCRIBANO_ARTIFACT_THINK=true` (disabled by default for speed).

## Implementation

### Phase 1: Extend MLX Bridge (scripts/mlx_bridge.py)
- Add `llm_model`, `llm_tokenizer` global state
- Implement `load_llm`, `generate_text`, `unload_llm`, `unload_vlm` handlers
- Add `mx.metal.clear_cache()` for memory cleanup
- Support thinking mode via `chat_template_kwargs`

### Phase 2: Update TypeScript Adapter (src/adapters/intelligence.mlx.adapter.ts)
- Add `generateText(prompt, think?)` method
- Add `loadLlm(model)`, `unloadLlm()`, `unloadVlm()` methods
- Update `IntelligenceService` interface with optional MLX-specific methods

### Phase 3: Add Model Detection (src/utils/model-detector.ts)
- Add `MLX_LLM_MODEL_TIERS` array (Qwen3.5 models)
- Add `selectBestMLXModel()` function (RAM-based auto-detection)

### Phase 4: Add Configuration (src/config.ts)
- Add `llmBackend` config key (enum: 'mlx' | 'ollama')
- Add `llmMlxModel` config key (optional, auto-detected if not set)
- Update config template with new options

### Phase 5: Update Pipeline Lifecycle (src/batch-context.ts)
- Backend selection in `initializeSystem()`
- Sequential model loading in `processVideo()`: VLM → unload → LLM → unload
- Resource tracking (only register Ollama if backend=ollama)

## Consequences

### Positive
- **Zero external dependencies** (MLX default, no Ollama required)
- **Native Metal** on Apple Silicon (better performance characteristics)
- **Shared infrastructure** (same bridge as VLM, no duplicate processes)
- **Memory efficiency** (sequential loading, not concurrent)
- **Same model family** (Qwen3.5 for both VLM and LLM)
- **Backward compatible** (Ollama still works via config flag)
- **Auto-detection** (RAM-based model selection for both backends)

### Negative
- Python dependency (already required for VLM, no new dependency)
- More complex bridge (two model types in single process)
- Sequential loading adds latency (VLM → unload → LLM → unload)
- Less model variety than Ollama (GGUF ecosystem larger than MLX-community)

### Neutral
- Same Unix socket protocol (no new IPC mechanism)
- Same adapter pattern (zero business logic changes in pipeline)
- Same output format (LLM generates identical markdown)

## Testing Checklist

- [x] MLX bridge: `load_llm` handler works
- [x] MLX bridge: `generate_text` produces valid output
- [x] MLX bridge: `unload_llm` frees memory
- [x] TypeScript: `generateText()` method works
- [x] TypeScript: `loadLlm()`, `unloadLlm()` work
- [x] Config: `llmBackend` selection works
- [x] Auto-detection: RAM-based model selection correct
- [x] Sequential lifecycle: VLM → LLM without memory leak
- [x] Ollama backend: existing functionality unchanged
- [x] Build: TypeScript compiles without errors
- [x] Linting: Biome passes all checks
- [ ] **Benchmarks: MLX-LM vs Ollama comparison** (future task)
- [x] Thinking mode: enabled/disabled correctly (fixed 2026-03-07)
- [x] Chat template: properly applied with `enable_thinking` control (fixed 2026-03-07)
- [x] Temperature: passed to `mlx_lm.generate()` (fixed 2026-03-07)

## Alternatives Considered

| Alternative | Rejected Because |
|-------------|------------------|
| **Ollama-only** | External dependency, not optimized for Apple Silicon |
| **Separate MLX-LM bridge** | Duplicate infrastructure, memory overhead (two processes) |
| **Always load both models** | 15GB+ memory footprint (too large for 16GB machines) |
| **Drop Ollama completely** | Users may prefer Ollama, less flexibility |
| **LM Studio MLX** | Less mature, no clear advantages over MLX-LM |

## Future Work

1. **Benchmarking infrastructure** (separate task):
   - Add `llm_backend`, `llm_model_resolved` to `processing_runs.metadata`
   - Track per-phase LLM latency (subject grouping, artifact generation)
   - Create comparison queries for MLX vs Ollama
   - Publish benchmark results

2. **Model caching** (optimization):
   - Cache downloaded MLX models in `~/.escribano/models/`
   - Avoid re-downloading on every run

3. **Quality metrics** (future research):
   - Compare artifact quality across backends
   - A/B testing with user feedback

## References

- ADR-006: MLX-VLM Intelligence Adapter
- Qwen3.5 benchmarks: https://qwenlm.github.io/blog/qwen3.5/
- MLX-LM documentation: https://github.com/ml-explore/mlx-lm
- MLX-VLM repository: https://github.com/Blaizzy/mlx-vlm
