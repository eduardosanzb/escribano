# Qwen3.5 Text-Only Load POC

This POC validates that Qwen3.5 models can be loaded as text-only LLMs using `mlx-lm` (not `mlx-vlm`).

## Background

mlx-lm v0.30.7+ (PR #869, merged Feb 12, 2026) added support for loading VLMs as text-only models. This means we can use Qwen3.5 models (which are VLMs) for text generation without needing `mlx-vlm`.

## Goal

Test 7 Qwen3.5 model variants to validate:
1. Text-only loading works with `mlx-lm`
2. Generation quality is acceptable for Escribano's use cases (subject grouping + card generation)
3. Performance metrics (load time, speed, memory) are within acceptable ranges

## Models Under Test

| # | Model | Size | Note |
|---|-------|------|------|
| 0 | Qwen3.5-27B-4bit | ~17 GB | Already cached, retest with mlx-lm 0.30.7+ |
| 1 | Qwen3.5-4B-OptiQ-4bit | 2.95 GB | Smallest, warm-up |
| 2 | Qwen3.5-9B-OptiQ-4bit | ~6 GB | Mid tier |
| 3 | Qwen3.5-27B-4bit-mlx | 15 GB | Vanilla 27B |
| 4 | Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-4bit | 14 GB | Claude-distilled |
| 5 | Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-6bit | 20 GB | Claude-distilled 6bit |
| 6 | Huihui-Qwen3.5-27B-abliterated-6bit | 21.9 GB | Abliterated |

## Test Prompts

**Prompt A - Subject grouping** (JSON-like structured output):
- Input: 5 synthetic topic blocks with UUIDs
- Expected output: `Group N: label: ... | blockIds: [...]` format
- Validation: Regex parse + all UUIDs present

**Prompt B - Card generation** (markdown output):
- Input: 3 synthetic subjects with durations and descriptions
- Expected output: Markdown with `##` headers and `-` bullets
- Validation: Output contains `##` and `-` characters

## Metrics Collected

- **Load time (s)**: Time to load model with `mlx_lm.load()`
- **Generation speed (tok/s)**: Average tokens per second across both prompts
- **Peak memory (GB)**: Peak GPU memory usage
- **Prompt A parsed**: Whether output matches expected format
- **Prompt B parsed**: Whether output contains markdown structure
- **Thinking works** (optional): Whether `enable_thinking=True` runs without error

## Running the POC

```bash
# Basic run (2 prompts per model)
uv run run.py

# With thinking mode test (3 prompts per model, slower)
uv run run.py --thinking
```

Dependencies are automatically installed by `uv` on first run.

The script will:
1. Print list of models to test
2. Wait for user confirmation
3. Download and test each model sequentially
4. Print ASCII results table

## Expected Output

```
========================================================================================================================
BENCHMARK RESULTS
========================================================================================================================

Model                                    | Load   | Speed   | Memory  | A Parse  | B Parse  | Think  | Status    
------------------------------------------------------------------------------------------------------------------------
Qwen3.5-4B-OptiQ-4bit                    |  12.3s |  45.2t/s|   3.2GB |        ✓ |        ✓ |      - | OK        
Qwen3.5-9B-OptiQ-4bit                    |  18.7s |  38.9t/s|   6.5GB |        ✓ |        ✓ |      - | OK        
Qwen3.5-27B-4bit-mlx                     |  35.2s |  22.1t/s|  16.8GB |        ✓ |        ✓ |      - | OK        
...

========================================================================================================================

Summary: 6/7 models passed both prompts
  1 models failed or errored
  - Qwen3.5-27B-4bit: Load timeout
```

## Dependencies

- `mlx-lm>=0.30.7` (declared in `pyproject.toml`)
- Automatically installed by `uv run` on first execution
- Requires Apple Silicon (M-series chip)

## Next Steps

After running the POC:
1. Review results table
2. Select working models for each tier (small/mid/large)
3. Update `src/utils/model-detector.ts` with validated models
4. Remove outdated comments about Qwen3.5 being VLMs
