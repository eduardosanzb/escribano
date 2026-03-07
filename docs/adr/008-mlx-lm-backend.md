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

| System RAM | Model | Size | Quality Tier |
|------------|-------|------|--------------|
| 32GB+ | `mlx-community/Qwen3.5-27B-Instruct-4bit` | ~15GB | Best |
| 20GB+ | `mlx-community/Qwen3.5-9B-Instruct-4bit` | ~5GB | Very Good |
| 10GB+ | `mlx-community/Qwen3.5-4B-Instruct-4bit` | ~2.5GB | Good |
| 6GB+ | `mlx-community/Qwen3.5-1B-Instruct-4bit` | ~0.8GB | Minimum |

### Model Tiers (MLX)

| System RAM | Model | Size | Speed | Quality Tier |
|------------|-------|------|-------|--------------|
| 32GB+ | `mlx-community/Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-4bit` | ~14GB | 25 tok/s | Best |
| 16-32GB | `mlx-community/Qwen3.5-9B-OptiQ-4bit` | ~6GB | 45 tok/s | Good |

| 
| **Validated:** These models passed both subject grouping (Prompt A) and card generation (Prompt B) in POC testing (March 2026).
| 
| **Rejected models:**
- `Qwen3.5-4B-OptiQ-4bit` - Failed subject grouping prompt (insufficient reasoning capacity)
- `Qwen3.5-27B-4bit-mlx` - Failed subject grouping prompt
- `mlx-community/Qwen3.5-27B-4bit` (unqualified) - VLM model with vision_tower weights (incompatible with text-only loading)

| 
| **Note:** Benchmark comparison (MLX-LM vs Ollama latency/quality) will be added in future update.
| 
### Critical Learnings (March 2026 POC)

| 
| #### Chat Template Bug
| 
| **Problem:** Using `tokenizer.apply_chat_template()` with `enable_thinking=False` still triggers thinking mode in Qwen3.5 models, causing them to output "Thinking Process:" sections instead of the required format.
| 
    **Root Cause:** Chat templates in Qwen3.5 models have hardcoded thinking mode logic that doesn't respect the `enable_thinking` parameter reliably
    
    **Solution:** Use raw prompts directly (bypass chat templates entirely). The bridge handler now supports both `rawPrompt` (new, recommended) and `messages` (legacy, backward compatible)
    
    **Impact:** Raw prompts produce correct output format 100% of the time in testing
| 
    #### Memory Contention Bug
| 
    **Problem:** When regenerating artifacts for already-processed recordings, the VLM bridge remained loaded while the LLM bridge loaded, causing memory contention and potential OOM/hang on 128GB machines
    
    **Root Cause:** VLM adapter was created unconditionally in `batch-context.ts`, even for artifact-only runs
    
    **Solution:** 
    1. Lazy VLM initialization (only created for new recordings)
    2. Explicit guard before LLM generation to ensure VLM is unloaded
    3. Sequential model lifecycle: VLM → unload → LLM -> unload
| 
    **Impact:** Memory usage now stays within limits (<80% of RAM) for all scenarios
| 
    #### Token Limits
| 
    Production uses:
    - **Prompt A (subject grouping):** 2000 tokens
    - **Prompt B (card generation):** 4000 tokens
| 
    Initial POC used 500/800 tokens, causing truncation failures. These limits provide sufficient headroom for complex sessions
| 
### Configuration
| 
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
