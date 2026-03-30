# Implementation Plan: RAM-Aware Qwen3.5 VLM Defaults

**Date**: 2026-03-30
**Status**: COMPLETED

## Overview

Replace the hardcoded `Qwen3-VL-2B-Instruct-4bit` default VLM model with RAM-aware Qwen3.5 defaults across the entire codebase. Qwen3.5 is multimodal and handles both frame analysis AND text generation, so the recorder can use a single model for everything. On 16GB machines (MacBook Air), the current 2B VLM default produces garbage text output from `text_infer`; switching to `Qwen3.5-0.8B-8bit` fixes this.

## Tiers

| RAM | VLM Model | Rationale |
|-----|-----------|-----------|
| >= 32GB | `mlx-community/Qwen3.5-2B-6bit` | Best quality, fits easily |
| >= 16GB | `mlx-community/Qwen3.5-0.8B-8bit` | Validated "super good" on Air |
| < 16GB | `mlx-community/Qwen3.5-0.8B-8bit` | Smallest viable model |

## Scope

- Work units: 6
- Execution phases: 1 (all files are disjoint — full parallel)
- Files affected:
  - `src/config.ts`
  - `apps/recorder/Sources/PythonBridge.vlm.adapter.swift`
  - `scripts/mlx_bridge.py`
  - `src/batch-context.ts`
  - `CLAUDE.md`
  - `src/utils/model-detector.ts`

## Work Units

### WU-1: Make VLM default RAM-aware in config.ts

**Dependencies**: none

**Context**: `src/config.ts` is the single source of truth for all configuration in the Node.js side. It currently hardcodes `mlx-community/Qwen3-VL-2B-Instruct-4bit` as the VLM model default in three places: the Zod schema default (line 37), the `BASE_DEFAULTS` object (line 99), and the `CONFIG_TEMPLATE` string (line 136). The file already has RAM detection via `getSystemRamGB()` and `getRamTier()` (lines 74-86) which returns `frameWidth` based on RAM. We need to extend this to also return the appropriate VLM model.

**Files**:
- `src/config.ts` — modify

**Steps**:
1. In the `getRamTier` function (lines 78-86), add a `vlmModel` field to the return type. Currently the function returns `{ tier: string; frameWidth: number }`. Change it to return `{ tier: string; frameWidth: number; vlmModel: string }`. The tiers should be:
   - `ramGB >= 32`: `vlmModel: 'mlx-community/Qwen3.5-2B-6bit'`
   - `ramGB >= 16`: `vlmModel: 'mlx-community/Qwen3.5-0.8B-8bit'`
   - `< 16GB`: `vlmModel: 'mlx-community/Qwen3.5-0.8B-8bit'`

2. Update `BASE_DEFAULTS.vlmModel` (line 99) from `'mlx-community/Qwen3-VL-2B-Instruct-4bit'` to `'mlx-community/Qwen3.5-0.8B-8bit'` (the safe minimum fallback).

3. Update the Zod schema default for `vlmModel` (line 37) from `'mlx-community/Qwen3-VL-2B-Instruct-4bit'` to `'mlx-community/Qwen3.5-0.8B-8bit'`.

4. In the config builder (line 291-296), change the `vlmModel` assignment to use the RAM-aware default instead of `BASE_DEFAULTS.vlmModel`. Currently it is:
   ```typescript
   vlmModel: parseEnvStringWithSource(
     'ESCRIBANO_VLM_MODEL',
     BASE_DEFAULTS.vlmModel,
     sources,
     'vlmModel'
   ) as string,
   ```
   Change the second argument from `BASE_DEFAULTS.vlmModel` to `ramTier.vlmModel` so it uses the RAM-aware default. Also update the source tracking: when using the RAM-aware default (no env var set), the source should be `'ram-aware'` instead of `'default'`. To do this, add logic after the `parseEnvStringWithSource` call: if the value came from the default (check `process.env.ESCRIBANO_VLM_MODEL === undefined`), update the last source entry's `source` to `'ram-aware'`.

5. Update the `CONFIG_TEMPLATE` string (line 136). Change:
   ```
   ESCRIBANO_VLM_MODEL=mlx-community/Qwen3-VL-2B-Instruct-4bit
   ```
   to:
   ```
   # ESCRIBANO_VLM_MODEL=                  # Auto-detected based on RAM (Qwen3.5-2B-6bit for 32GB+, Qwen3.5-0.8B-8bit for 16GB+)
   ```
   (Comment it out since it's now auto-detected, matching the pattern used for `ESCRIBANO_FRAME_WIDTH` on line 124.)

6. Update `logConfig()` (line 502) — the `models` line currently does `config.vlmModel.split('/').pop()`. This still works with the new model names, no change needed.

**Verification**: `grep -q "Qwen3.5" src/config.ts && ! grep -q "Qwen3-VL-2B" src/config.ts && echo "PASS" || echo "FAIL"`

**Rollback**:
- Modified files: `git checkout -- src/config.ts`

---

### WU-2: Make recorder VLM default RAM-aware in Swift

**Dependencies**: none

**Context**: `apps/recorder/Sources/PythonBridge.vlm.adapter.swift` is the Swift adapter that spawns the Python MLX bridge for the always-on recorder. It reads `ESCRIBANO_VLM_MODEL` from the environment (line 79) and falls back to a hardcoded `mlx-community/Qwen3-VL-2B-Instruct-4bit` (line 80). The recorder uses this single model for BOTH frame analysis (`vlm_infer`) AND text generation (`text_infer` for SessionAggregator's semantic grouping). On a 16GB MacBook Air with no `.env` override, the 2B VLM model produces garbage text output. We need RAM-aware defaults here too.

**Files**:
- `apps/recorder/Sources/PythonBridge.vlm.adapter.swift` — modify

**Steps**:
1. Add a private static function to compute the default VLM model based on system RAM. Place it right before or after the `init()` method. The function should be:
   ```swift
   /// Select the default VLM model based on system RAM.
   /// Qwen3.5 is multimodal — handles both frame analysis and text generation.
   private static func defaultVLMModel() -> String {
       let ramGB = ProcessInfo.processInfo.physicalMemory / (1024 * 1024 * 1024)
       if ramGB >= 32 {
           return "mlx-community/Qwen3.5-2B-6bit"
       }
       return "mlx-community/Qwen3.5-0.8B-8bit"
   }
   ```

2. Update the `modelId` initialization in `init()`. Currently (lines 79-80):
   ```swift
   modelId = ProcessInfo.processInfo.environment["ESCRIBANO_VLM_MODEL"]
       ?? "mlx-community/Qwen3-VL-2B-Instruct-4bit"
   ```
   Change to:
   ```swift
   modelId = ProcessInfo.processInfo.environment["ESCRIBANO_VLM_MODEL"]
       ?? Self.defaultVLMModel()
   ```

3. Update the doc comment for `modelId` (line 36). Change:
   ```swift
   private let modelId: String // e.g. mlx-community/Qwen3-VL-2B-Instruct-4bit
   ```
   to:
   ```swift
   private let modelId: String // e.g. mlx-community/Qwen3.5-2B-6bit (RAM-aware default)
   ```

**Verification**: `cd apps/recorder && swift build -c release 2>&1 | tail -1 | grep -q "Build complete" && echo "PASS" || echo "FAIL"`

**Rollback**:
- Modified files: `git checkout -- apps/recorder/Sources/PythonBridge.vlm.adapter.swift`

---

### WU-3: Update Python bridge default model and comments

**Dependencies**: none

**Context**: `scripts/mlx_bridge.py` is the Python bridge that loads and runs MLX models. It reads `ESCRIBANO_VLM_MODEL` from the environment (line 38-40) with a hardcoded fallback of `mlx-community/Qwen3-VL-2B-Instruct-4bit`. Since the caller (either Node.js or Swift) always sets this env var before spawning the bridge, this default is just a safety net. The `text_infer` handler comment (line 454) references "Qwen3-VL" specifically, but should mention Qwen3.5 since that's now the primary model.

**Files**:
- `scripts/mlx_bridge.py` — modify

**Steps**:
1. Update the safety-net default model (lines 38-40). Change:
   ```python
   MODEL_NAME = os.environ.get(
       "ESCRIBANO_VLM_MODEL", "mlx-community/Qwen3-VL-2B-Instruct-4bit"
   )
   ```
   to:
   ```python
   MODEL_NAME = os.environ.get(
       "ESCRIBANO_VLM_MODEL", "mlx-community/Qwen3.5-0.8B-8bit"
   )
   ```

2. Update the docstring at the top of the file (line 13). Change:
   ```python
       ESCRIBANO_VLM_MODEL       - MLX VLM model name (default: mlx-community/Qwen3-VL-2B-Instruct-4bit)
   ```
   to:
   ```python
       ESCRIBANO_VLM_MODEL       - MLX VLM model name (default: auto-detected by caller, safety net: Qwen3.5-0.8B-8bit)
   ```

3. Update the `text_infer` handler comment (lines 452-456). Change:
   ```python
           elif method == "text_infer":
               # text_infer reuses the VLM model for text-only generation.
               # This works because Qwen3-VL handles text-only prompts natively.
               # We call handle_vlm_infer directly — it already handles image=None
               # when no image paths are in the messages.
   ```
   to:
   ```python
           elif method == "text_infer":
               # text_infer reuses the loaded model for text-only generation.
               # Qwen3.5 is multimodal and handles text-only prompts natively.
               # We call handle_vlm_infer directly — it already handles image=None
               # when no image paths are in the messages.
   ```

**Verification**: `python3 -c "import ast; ast.parse(open('scripts/mlx_bridge.py').read()); print('PASS')" 2>&1 || echo "FAIL"`

**Rollback**:
- Modified files: `git checkout -- scripts/mlx_bridge.py`

---

### WU-4: Fix stale model reference in batch-context.ts

**Dependencies**: none

**Context**: `src/batch-context.ts` has a `collectRunMetadata()` function (line 614) that records pipeline telemetry. On lines 628-630, it reads `process.env.ESCRIBANO_VLM_MODEL` directly (violating the project's config rule) and falls back to the stale string `'mlx-community/Qwen3-VL-2B-Instruct-bf16'`. The function already receives `config` as a parameter (line 616), so it should use `config.vlmModel` instead.

**Files**:
- `src/batch-context.ts` — modify

**Steps**:
1. Replace the hardcoded VLM model fallback (lines 628-630). Currently:
   ```typescript
   const metadata: Record<string, unknown> = {
     vlm_model:
       process.env.ESCRIBANO_VLM_MODEL ??
       'mlx-community/Qwen3-VL-2B-Instruct-bf16',
   ```
   Change to:
   ```typescript
   const metadata: Record<string, unknown> = {
     vlm_model: config?.vlmModel ?? 'unknown',
   ```
   This uses the config object (which is already passed in as a parameter) instead of reading `process.env` directly, and eliminates the stale hardcoded model name. The `?.` optional chaining handles the case where config is undefined.

**Verification**: `grep -q "config?.vlmModel" src/batch-context.ts && ! grep -q "Qwen3-VL-2B-Instruct-bf16" src/batch-context.ts && echo "PASS" || echo "FAIL"`

**Rollback**:
- Modified files: `git checkout -- src/batch-context.ts`

---

### WU-5: Update CLAUDE.md env var table and model references

**Dependencies**: none

**Context**: `CLAUDE.md` is the project's primary documentation file read by AI assistants. The `ESCRIBANO_VLM_MODEL` row in the env vars table (line 97) contains outdated information: it says the batch pipeline default is `Qwen3-VL-2B-Instruct-bf16` and the recorder default is `Qwen3-VL-4B-Instruct-4bit`. Neither matches the actual code, and both are wrong now that we're switching to Qwen3.5. The Technology Stack section was already updated earlier in this conversation to mention Qwen3.5 as multimodal.

**Files**:
- `CLAUDE.md` — modify

**Steps**:
1. Update the `ESCRIBANO_VLM_MODEL` row in the env vars table (line 97). Currently:
   ```markdown
   | `ESCRIBANO_VLM_MODEL` | MLX model for VLM frame analysis. Batch pipeline default: `mlx-community/Qwen3-VL-2B-Instruct-bf16`. Always-on recorder default: `mlx-community/Qwen3-VL-4B-Instruct-4bit`. | see description |
   ```
   Change to:
   ```markdown
   | `ESCRIBANO_VLM_MODEL` | MLX model (Qwen3.5 is multimodal — one model for frame analysis + text generation). RAM-aware default: `Qwen3.5-2B-6bit` (>=32GB) or `Qwen3.5-0.8B-8bit` (16GB). | auto-detected |
   ```

**Verification**: `grep -q "Qwen3.5-2B-6bit" CLAUDE.md && grep -q "Qwen3.5-0.8B-8bit" CLAUDE.md && ! grep -q "Qwen3-VL-2B-Instruct-bf16" CLAUDE.md && echo "PASS" || echo "FAIL"`

**Rollback**:
- Modified files: `git checkout -- CLAUDE.md`

---

### WU-6: Update model-detector.ts comment about Qwen3.5

**Dependencies**: none

**Context**: `src/utils/model-detector.ts` contains the MLX LLM model auto-detection logic (separate from VLM). Lines 8-10 have a comment: "Uses lmstudio-community Instruct-2507 models for reliable inference. These models respect think=False and produce clean output without thinking leakage, unlike older Qwen3.5 models." This comment is misleading now that Qwen3.5 is the primary VLM model for the entire project. The "thinking leakage" issue was with earlier Qwen3.5 releases used as LLM; the current Qwen3.5 multimodal models work fine with `/no_think` prefix (already handled in SessionAggregator.swift and other files).

**Files**:
- `src/utils/model-detector.ts` — modify

**Steps**:
1. Update the module comment (lines 7-11). Currently:
   ```typescript
   /**
    * LLM Model Auto-Detection
    *
    * Detects the best available LLM model from installed Ollama models
    * based on system RAM and model quality tiers.
    *
    * MLX Models Note:
    * Uses lmstudio-community Instruct-2507 models for reliable inference.
    * These models respect think=False and produce clean output without
    * thinking leakage, unlike older Qwen3.5 models.
    */
   ```
   Change to:
   ```typescript
   /**
    * LLM Model Auto-Detection
    *
    * Detects the best available LLM model from installed Ollama models
    * based on system RAM and model quality tiers.
    *
    * MLX LLM Models Note:
    * Uses lmstudio-community Instruct-2507 models for the batch pipeline's
    * dedicated text-only LLM path. The recorder uses Qwen3.5 (multimodal)
    * for both VLM and text generation via a single model — see config.ts
    * for VLM model selection.
    */
   ```

**Verification**: `grep -q "Qwen3.5 (multimodal)" src/utils/model-detector.ts && ! grep -q "thinking leakage" src/utils/model-detector.ts && echo "PASS" || echo "FAIL"`

**Rollback**:
- Modified files: `git checkout -- src/utils/model-detector.ts`

---

## Execution Plan

### Phase 1 — Parallel (no dependencies, all files disjoint)
- WU-1: Make VLM default RAM-aware in config.ts
- WU-2: Make recorder VLM default RAM-aware in Swift
- WU-3: Update Python bridge default model and comments
- WU-4: Fix stale model reference in batch-context.ts
- WU-5: Update CLAUDE.md env var table and model references
- WU-6: Update model-detector.ts comment about Qwen3.5

## Recovery Strategy

- **Automatic**: Each implementor rolls back and retries once on failure.
- **Dependency failure**: All units are independent — no cascading failures possible.
- **Global rollback**: `git checkout -- src/config.ts apps/recorder/Sources/PythonBridge.vlm.adapter.swift scripts/mlx_bridge.py src/batch-context.ts CLAUDE.md src/utils/model-detector.ts`
- **Independent failures**: All units are independent — a failure in one does not affect others.
