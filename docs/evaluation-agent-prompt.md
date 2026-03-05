# Escribano Model Evaluation Agent Prompt

> **Purpose:** Evaluate Qwen3.5 small models (LLM side) across two machines —  
> MacBook Pro M4 Max 128GB and M1 Air 16GB — to validate the new default tiers.

Copy this prompt into your AI agent to run a full end-to-end evaluation.

---

## Agent Prompt

```
You are running a model evaluation for the Escribano project.
Your goal is to compare Qwen3.5 small LLM models for summary/artifact generation quality
across two machines: MacBook Pro M4 Max (128GB) and M1 Air (16GB).

you are working in a git branch that has specifically this changes; we are evaluating the PR https://github.com/eduardosanzb/escribano/pull/13

Follow every step in order. Do not skip steps.

---

## PHASE 0 — Prerequisites

1. Confirm you are in the escribano project root (`ls package.json` must exist).
2. Run `node --version` — must be >= 20.
3. Run `ollama --version` — must be installed.
4. Run `whisper-cli --version` — must be installed.
5. Check which machine you are on:
   - Run: `sysctl -n hw.memsize | awk '{printf "%.0f GB\n", $1/1024/1024/1024}'`
   - Record this as MACHINE_RAM.

---

## PHASE 1 — DB Snapshot (before any run)

Create a timestamped snapshot of the current database so you can restore it between runs.

```bash
SNAP_DIR=~/.escribano/snapshots/$(date +%Y%m%d-%H%M%S)
mkdir -p "$SNAP_DIR"
cp ~/.escribano/escribano.db "$SNAP_DIR/escribano.db"
echo "Snapshot saved to: $SNAP_DIR"
```

Record the snapshot path — you will restore it before each model run.

---

## PHASE 2 — Pull Required Models

Based on your MACHINE_RAM, pull these models:

### If MACHINE_RAM >= 32GB (MBP 128GB):
```bash
ollama pull qwen3.5:27b
ollama pull qwen3.5:9b
ollama pull qwen3.5:4b
```

### If MACHINE_RAM < 32GB (M1 Air 16GB):
```bash
ollama pull qwen3.5:9b
ollama pull qwen3.5:4b
ollama pull qwen3.5:2b
```

Confirm each model is installed: `ollama list | grep qwen3.5`

---

## PHASE 3 — Select Test Videos

Identify 3–5 representative video files from your test corpus.

All the videos exists in ~/Desktop and they are .mov; 
Run: `ls ~/Desktop/*.mov 2>/dev/null | head -10`

Record the selected video paths as VIDEO_1, VIDEO_2, VIDEO_3, etc.

---

## PHASE 4 — Run Evaluation Per Model

For each model in the list below, repeat the steps in this phase.

**Models to test** (in order):
- MBP 128GB: `qwen3.5:4b`, `qwen3.5:9b`, `qwen3.5:27b`
- M1 Air 16GB: `qwen3.5:2b`, `qwen3.5:4b`, `qwen3.5:9b`

### Step 4.1 — Restore DB snapshot
```bash
cp "$SNAP_DIR/escribano.db" ~/.escribano/escribano.db
echo "DB restored"
```

### Step 4.2 — Set model env vars
Replace MODEL_UNDER_TEST with the model name (e.g., `qwen3.5:4b`):
```bash
export ESCRIBANO_LLM_MODEL=MODEL_UNDER_TEST
export ESCRIBANO_SUBJECT_GROUPING_MODEL=MODEL_UNDER_TEST
```

### Step 4.3 — Process each test video with timing
For each VIDEO_N, run:
```bash
time npx escribano --file "$VIDEO_N" --format card --stdout > /tmp/eval-MODEL_UNDER_TEST-video-N.md 2>&1
echo "Exit code: $?"
```

Capture:
- Wall-clock time (from `time`)
- Exit code (0 = success)
- Any error messages

### Step 4.4 — Save artifact output
```bash
cp /tmp/eval-MODEL_UNDER_TEST-video-N.md \
   ~/.escribano/eval-results/MODEL_UNDER_TEST-video-N-$(date +%Y%m%d).md
```

### Step 4.5 — Rate artifact quality (1–5 scale)
Open the artifact file and rate:
1. **Accuracy** — does the summary match what was actually on screen?
2. **Completeness** — are all major activities captured?
3. **Clarity** — is the output readable and well-structured?
4. **Subject grouping** — are segments grouped sensibly into subjects?

Record ratings in a CSV: `model,video,accuracy,completeness,clarity,grouping,wall_time_s`

---

## PHASE 5 — Collect System Metrics

After each run, capture resource usage:
```bash
# Peak memory during ollama inference (recorded from Activity Monitor or:)
ps aux | grep ollama | awk '{print $6/1024 " MB"}'

# Ollama process stats:
ollama ps
```

---

## PHASE 6 — Compare Results

Create a summary table:
```
| Model       | Machine    | Video | Accuracy | Completeness | Clarity | Grouping | Time (s) |
|-------------|------------|-------|----------|--------------|---------|----------|----------|
| qwen3.5:2b  | M1 Air 16G | V1    |          |              |         |          |          |
| qwen3.5:4b  | M1 Air 16G | V1    |          |              |         |          |          |
| qwen3.5:9b  | M1 Air 16G | V1    |          |              |         |          |          |
| qwen3.5:4b  | MBP 128GB  | V1    |          |              |         |          |          |
| qwen3.5:9b  | MBP 128GB  | V1    |          |              |         |          |          |
| qwen3.5:27b | MBP 128GB  | V1    |          |              |         |          |          |
```

Answer these questions:
1. What is the minimum model size that achieves quality >= 3.5/5 on all metrics?
2. Is `qwen3.5:9b` good enough on M1 Air 16GB for production use?
3. Is `qwen3.5:4b` acceptable for subject grouping (lower-stakes task)?
4. Does `qwen3.5:9b` match `qwen3.5:27b` quality within 10%?

---

## PHASE 7 — Subject Grouping Specific Test

The subject grouping model is separate. Test it specifically:

```bash
# Test with qwen3.5:4b (new default)
export ESCRIBANO_SUBJECT_GROUPING_MODEL=qwen3.5:4b
npx escribano --file "$VIDEO_1" --format card --stdout > /tmp/grouping-4b.md 2>&1

# Test with qwen3.5:9b
export ESCRIBANO_SUBJECT_GROUPING_MODEL=qwen3.5:9b
cp "$SNAP_DIR/escribano.db" ~/.escribano/escribano.db
npx escribano --file "$VIDEO_1" --format card --stdout > /tmp/grouping-9b.md 2>&1
```

Compare the subject groups generated. Check:
- Are subjects meaningful and distinct?
- Are block IDs correctly assigned (no orphaned blocks)?
- Does it correctly identify personal vs work time?

---

## PHASE 8 — MLX VLM Model Check (optional but recommended)

The VLM default changed from `bf16` to `4bit`. Verify the 4bit model is being used:

```bash
# Check what model is loaded
ESCRIBANO_VERBOSE=true npx escribano --file "$VIDEO_1" --skip-summary 2>&1 | grep "VLM.*Model"
```

Expected output: `[VLM] Model: mlx-community/Qwen3-VL-2B-Instruct-4bit`

---

## PHASE 9 — Record Conclusions

Write a summary to `~/.escribano/eval-results/conclusions-$(date +%Y%m%d).md`:

```markdown
# Model Evaluation Results — [DATE]

## Machine: [MBP/M1 Air] [RAM]

### Recommended Defaults
- LLM (summary): [model]
- Subject grouping: [model]
- VLM: mlx-community/Qwen3-VL-2B-Instruct-4bit (unchanged)

### Key Findings
- [Finding 1]
- [Finding 2]

### Config to set in .env (if overriding defaults)
ESCRIBANO_LLM_MODEL=[model]
ESCRIBANO_SUBJECT_GROUPING_MODEL=[model]
```

Share these conclusions back to the GitHub issue or open a PR updating model-detector.ts tiers.

---

## Expected Outcomes (hypothesis)

Based on Qwen3.5 benchmark research (March 2026):
- **qwen3.5:9b** should match or exceed `qwen3:14b` quality at half the RAM requirement
- **qwen3.5:4b** should be sufficient for subject grouping (simpler task)
- **M1 Air 16GB** can run `qwen3.5:9b` comfortably (model fits in ~5-6GB, well within budget)
- **MBP 128GB** should prefer `qwen3.5:27b` for best quality summaries

---

## Troubleshooting

**Ollama OOM crash**: Reduce `ESCRIBANO_LLM_MODEL` to smaller size, or set `OLLAMA_MAX_LOADED_MODELS=1`

**VLM bridge timeout**: Increase `ESCRIBANO_MLX_STARTUP_TIMEOUT=180000` (3 minutes)

**Subject grouping parse failure**: The model output format may differ — check logs for `[subject-grouping] Failed to parse any groups`. Try `qwen3.5:9b` instead.

**Long inference time**: Normal for first run (model cold load). Subsequent runs on same model are faster.
```
