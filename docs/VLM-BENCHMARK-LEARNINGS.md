# VLM Benchmark Learnings

Comprehensive results from testing Vision-Language Models for Escribano's visual pipeline.
Tests performed on MacBook Pro M4 Max (128GB) between January-February 2026.

## Winner: qwen3-vl:4b

**Size:** 3.3GB | **Speed:** 27-55 tok/s | **Quality:** Good structured output

Selected for the best balance of speed, size, and output quality for describing
developer screen recordings. Consistently produces well-structured, accurate
descriptions with correct application identification and topic extraction.

## Model Comparison (3-image head-to-head, 4000 token limit)

| Model | Duration | Tokens | Speed | Output Quality | Verdict |
|-------|----------|--------|-------|----------------|---------|
| **qwen3-vl:4b** | 50s | 2753 | 55.0 t/s | Structured, accurate, identifies apps/files/topics | **Selected** |
| qwen3-vl:8b | 70s | 4000 | 57.1 t/s | Good but spent tokens in thinking mode (no visible content) | Viable fallback |
| MiMo-VL-7B | 132s | 0 usable | 0 t/s | Complete gibberish (Chinese chars, random tokens) | Rejected |
| minicpm-v:8b | 13s | 293 | 22.5 t/s | Too brief, no specifics (app names, files, paths) | Rejected |
| glm-ocr | 43s | 4000 | 93.0 t/s | Infinite repetition loop -- dumps same OCR block until limit | Rejected |

## Batch Size Tests (all qwen3-vl:4b, sequential, 6000 token limit)

| Test | Images | Duration | Tokens | tok/s | Tokens/Image | Notes |
|------|--------|----------|--------|-------|--------------|-------|
| 3-image batch | 3 | 50s | 2753 | 55.0 | 918 | Best per-image detail |
| 5-image batch | 5 | 67.7s | 1866 | 27.6 | 373 | Good quality, concise per image |
| 8-image batch | 8 | 104s | 3964 | 38.1 | 496 | Good balance -- **recommended** |
| 20-image batch | 20 | 340.9s | 2373 | 7.0 | 119 | Severe quality drop, images merged/skipped |

### Key Observations

- **3 images:** Highest per-image detail (918 tokens each). Good for deep analysis but
  inefficient for bulk processing.
- **5 images:** Decent quality at 373 tokens/image. Speed dropped to 27.6 tok/s.
- **8 images:** The sweet spot. 496 tokens/image with good structured output for all 8
  screenshots. Speed: 38.1 tok/s.
- **20 images:** Catastrophic quality degradation. Only 119 tokens/image. Model
  started merging screenshots ("same as Screenshot 2") and skipping details.
  Speed collapsed to 7.0 tok/s.

### Full Session Extrapolation (1,776 frames)

| Batch Size | Batches Needed | Est. Total Time | Feasible? |
|------------|----------------|-----------------|-----------|
| 3 | 592 | ~8.2 hours | No |
| 5 | 356 | ~6.7 hours | No |
| 8 | 222 | ~6.4 hours | No |
| 20 | 89 | ~8.4 hours | No |

**Conclusion:** Frame sampling/deduplication is essential. Target: reduce 1,776 frames
to ~100-200 before VLM processing (scene change detection + temporal dedup).

## Parallel Processing Tests

### Test 1: Parallel HTTP to single Ollama (3 batches x 8 images)

**Result: Complete failure.** All 3 batches failed after 3 retries each.

```
| Batch | Status     | Duration | Tokens |
|-------|------------|----------|--------|
| 1     | Failed  | N/A      | N/A    |
| 2     | Failed  | N/A      | N/A    |
| 3     | Failed  | N/A      | N/A    |
```

**Root cause:** Ollama server logs confirmed:
`"model architecture does not currently support parallel requests" architecture=qwen3vl`

### Test 2: Dual Ollama instances (ports 11434 + 11435, alternating batches)

**Result: Worked but slower than sequential.**

```
| Batch | Port  | Status  | Duration | Tokens |
|-------|-------|---------|----------|--------|
| 1     | 11435 | SUCCESS | 471s     | 6000   |
| 2     | 11434 | SUCCESS | 470s     | 6000   |
| 3     | 11435 | SUCCESS | 113s     | 2196   |
```

- **Total:** 1054s for 24 images, 14196 tokens
- **Average speed:** 13.4 tok/s (vs 38 tok/s single-instance sequential)
- **GPU contention:** Both instances compete for the same Metal GPU, causing ~3.5x slowdown
- **Note:** The report script had a bug showing "Successful: 0/3" despite all STATUS=SUCCESS

### Parallel Processing Summary

| Approach | Result | Speed |
|----------|--------|-------|
| Sequential (single Ollama) | Works | 38-55 tok/s |
| Parallel HTTP (single Ollama) | Crashes | 0 tok/s |
| Dual Ollama instances | Works but slower | 13.4 tok/s |

**Verdict:** Sequential processing on a single Ollama instance is the only viable approach.

## Output Quality Examples

### qwen3-vl:4b -- 8-image batch (good)

```
### Screenshot 0
1. Visible: Terminal showing ~/escribano/ directory with models, sessions
   (containing scene_0001.jpg-scene_0011.jpg), and visual-index.json.
   visual-index.json is open in Vim, displaying JSON with "frames" metadata
   and OCR text.
2. Developer action: Reviewing video frame metadata and OCR data for a project.
3. Applications: Terminal (Vim), Ghosty (top bar), browser (partial view).
4. Topics/projects: Video processing, OCR, session logging, escribano project.
```

### qwen3-vl:4b -- 20-image batch (quality degradation)

```
### 3. Bottom-left screenshot
Visible: Terminal (commands like `npm run generate 1 summary`), Gmail
   (email thread), Calendar (events like "Long-running agents").
Developer doing: Running build commands, managing project setup, checking emails.
Apps open: Terminal, Gmail, Calendar.
Topics: Project build, email management, Guest Card System.
```

Less detail per image. Images described as "Middle screenshot" instead of
numbered indices. Some screenshots merged with "same as Screenshot 2".

### MiMo-VL-7B (garbage)

```
Calule9
Hye k_tC
Calule0
shell n
shell W
UEL(nye http
(n直通车(n直通车
scalaule
shellule
```

Complete gibberish. Unusable.

## Known Failure Modes

| Issue | Trigger | Mitigation |
|-------|---------|------------|
| Rotated text read backwards | 180-degree rotated text on screen | None known |
| Infinite repetition loops | Dense tables, repeated UI elements | `temperature=0.1-0.3` |
| Numeric regression | Long numeric strings (IDs, hashes) | Use qwen2.5-vl-7b for OCR-heavy frames |
| Thinking mode token waste | qwen3-vl:8b with `think=true` | Always set `think=false` |

## Recommended Configuration

```json
{
  "model": "qwen3-vl:4b",
  "options": {
    "temperature": 0.3,
    "num_predict": 6000
  },
  "think": false,
  "batch_size": 8,
  "processing": "sequential"
}
```

## Quantization Floor

- **Vision encoder (mmproj):** Must use Q8_0 or FP16. Q4 destroys OCR accuracy
  for code/terminal text.
- **LLM component:** Q4_K_M is sufficient for reasoning tasks.

## What's Next

1. **Frame sampling** -- Reduce 1,776 frames to ~100-200 before VLM processing
   (scene change detection + temporal deduplication)
2. **MLX migration** -- Move from Ollama to native Metal inference for true
   parallel continuous batching (2-4 concurrent streams)
3. **V3 pipeline integration** -- Wire qwen3-vl:4b into the VLM-first
   architecture defined in ADR-005
