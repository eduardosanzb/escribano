# Escribano Model Evaluation Agent Prompt

> **Purpose:** Evaluate Qwen3.5 small models (LLM side) across two machines —  
> MacBook Pro M4 Max 128GB and M1 Air 16GB — to validate the new default tiers  
> introduced in PR https://github.com/eduardosanzb/escribano/pull/13

Copy this prompt into your AI agent to run a full end-to-end evaluation.

---

## Agent Prompt

```
You are running a model evaluation for the Escribano project.
Your goal is to compare Qwen3.5 small LLM models for summary/artifact generation quality
across two machines: MacBook Pro M4 Max (128GB) and M1 Air (16GB).

You are working on the git branch for PR https://github.com/eduardosanzb/escribano/pull/13
which introduces the new Qwen3.5 model tier defaults. Ensure the branch is checked out
before proceeding.

Follow every step in order. Do not skip steps.

---

## PHASE 0 — Prerequisites

1. Confirm you are in the escribano project root: `ls package.json` — must exist.
2. Confirm the PR branch is checked out:
   ```bash
   git branch --show-current
   # Expected: copilot/evaluate-models-defaults (or similar)
   ```
3. Run `node --version` — must be >= 20.6 (required for --env-file support).
4. Run `ollama --version` — must be installed.
5. Run `whisper-cli --version` — must be installed.
6. Check which machine you are on:
   ```bash
   sysctl -n hw.memsize | awk '{printf "%.0f GB\n", $1/1024/1024/1024}'
   ```
   Record this as MACHINE_RAM.

---

## PHASE 1 — DB Snapshot (before any run)

Create a timestamped snapshot of the current database so you can restore it between runs.

```bash
SNAP_DIR=~/.escribano/snapshots/$(date +%Y%m%d-%H%M%S)
mkdir -p "$SNAP_DIR"
cp ~/.escribano/escribano.db "$SNAP_DIR/escribano.db" 2>/dev/null || echo "No existing DB — will be created on first run"
echo "Snapshot dir: $SNAP_DIR"
export SNAP_DIR
```

Record the SNAP_DIR value — you will restore it before each model run.

---

## PHASE 2 — Pull Required Models

Based on your MACHINE_RAM, pull the models you want to test:

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

## PHASE 3 — Configure ~/.escribano/.env

All model config lives in `~/.escribano/.env`. This file is loaded per-run via
`node --env-file` so you never need to `export` variables manually.

### Step 3.1 — Create the config directory and base .env

```bash
mkdir -p ~/.escribano
cat .env.example > ~/.escribano/.env
echo "Base config copied from .env.example"
```

The `.env.example` in the project root documents every available setting.
Open `~/.escribano/.env` in your editor and verify it looks correct before continuing.

### Step 3.2 — Helper: run escribano with config loaded

For every `npx escribano` command in this evaluation, use this helper so the
`~/.escribano/.env` is automatically loaded:

```bash
# Define once at the start of your session:
escribano() {
  node --env-file="$HOME/.escribano/.env" npx escribano "$@"
}
```

Verify it works: `escribano --version`

---

## PHASE 4 — Select Test Videos

All test videos are `.mov` files on the Desktop.

```bash
# List available videos (newest first):
ls -t ~/Desktop/*.mov 2>/dev/null
```

Pick 3–5 representative recordings and record their paths:

```bash
# Auto-select up to 5 newest .mov files from Desktop:
mapfile -t VIDEOS < <(ls -t ~/Desktop/*.mov 2>/dev/null | head -5)
printf 'Selected videos:\n'; printf '  %s\n' "${VIDEOS[@]}"
export VIDEOS
```

For quick single-video runs you can also use the latest Cap recording
automatically (no `--file` needed):

```bash
# Process whatever was most recently recorded by Cap:
escribano --format card --stdout
```

---

## PHASE 5 — Run Evaluation Per Model

For each model in the list below, repeat every step in this phase.

**Models to test** (in order):
- MBP 128GB: `qwen3.5:4b`, `qwen3.5:9b`, `qwen3.5:27b`
- M1 Air 16GB: `qwen3.5:2b`, `qwen3.5:4b`, `qwen3.5:9b`

### Step 5.1 — Write model config to ~/.escribano/.env

Replace `MODEL_UNDER_TEST` with the model name (e.g., `qwen3.5:4b`):

```bash
MODEL_UNDER_TEST=qwen3.5:4b   # ← change this for each iteration

# Patch the two model lines in ~/.escribano/.env:
sed -i '' \
  -e "s|^ESCRIBANO_LLM_MODEL=.*|ESCRIBANO_LLM_MODEL=${MODEL_UNDER_TEST}|" \
  -e "s|^ESCRIBANO_SUBJECT_GROUPING_MODEL=.*|ESCRIBANO_SUBJECT_GROUPING_MODEL=${MODEL_UNDER_TEST}|" \
  ~/.escribano/.env

# Verify:
grep "ESCRIBANO_LLM_MODEL\|ESCRIBANO_SUBJECT_GROUPING_MODEL" ~/.escribano/.env
```

### Step 5.2 — Restore DB snapshot

```bash
cp "$SNAP_DIR/escribano.db" ~/.escribano/escribano.db && echo "DB restored"
```

### Step 5.3 — Process each video with timing

Option A — process a specific file:
```bash
mkdir -p ~/.escribano/eval-results

for i in "${!VIDEOS[@]}"; do
  VIDEO="${VIDEOS[$i]}"
  # Sanitize model name for filenames: qwen3.5:4b → qwen3_5_4b
  MODEL_SAFE="${MODEL_UNDER_TEST//[^a-zA-Z0-9]/_}"
  OUT=~/.escribano/eval-results/${MODEL_SAFE}-video$((i+1))-$(date +%Y%m%d).md
  echo "=== Processing video $((i+1)): $VIDEO ==="
  time escribano --file "$VIDEO" --format card --stdout > "$OUT" 2>&1
  echo "Exit: $? | Saved: $OUT"
done
```

Option B — process the latest Cap recording (no file path needed):
```bash
MODEL_SAFE="${MODEL_UNDER_TEST//[^a-zA-Z0-9]/_}"
OUT=~/.escribano/eval-results/${MODEL_SAFE}-latest-$(date +%Y%m%d).md
time escribano --format card --stdout > "$OUT" 2>&1
echo "Exit: $? | Saved: $OUT"
```

### Step 5.4 — Rate artifact quality (1–5 scale)

Open each output file and score:
1. **Accuracy** — does the summary match what was on screen?
2. **Completeness** — are all major activities captured?
3. **Clarity** — is the output readable and well-structured?
4. **Subject grouping** — are segments grouped sensibly into subjects?

Append scores to `~/.escribano/eval-results/scores.csv`:
```bash
# model,video,accuracy,completeness,clarity,grouping,wall_time_s
echo "qwen3.5:4b,video1,4,4,5,3,82" >> ~/.escribano/eval-results/scores.csv
```

---

## PHASE 6 — Collect System Metrics

After each run:
```bash
# Ollama memory usage:
ps aux | grep ollama | awk '{print $6/1024 " MB"}'
ollama ps
```

---

## PHASE 7 — Compare Results

Display scores:
```bash
cat ~/.escribano/eval-results/scores.csv | column -t -s ','
```

Fill in the summary table:
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
1. What is the minimum model that achieves >= 3.5/5 on all metrics?
2. Is `qwen3.5:9b` good enough on M1 Air 16GB for production use?
3. Is `qwen3.5:4b` acceptable for subject grouping (lower-stakes task)?
4. Does `qwen3.5:9b` match `qwen3.5:27b` quality within 10%?

---

## PHASE 8 — Subject Grouping Specific Test

Test the subject grouping model in isolation (it runs independently of the LLM model):

```bash
# Patch ~/.escribano/.env for grouping-only test:
sed -i '' "s|^ESCRIBANO_SUBJECT_GROUPING_MODEL=.*|ESCRIBANO_SUBJECT_GROUPING_MODEL=qwen3.5:4b|" ~/.escribano/.env
cp "$SNAP_DIR/escribano.db" ~/.escribano/escribano.db
escribano --file "${VIDEOS[0]}" --format card --stdout > /tmp/grouping-4b.md 2>&1

sed -i '' "s|^ESCRIBANO_SUBJECT_GROUPING_MODEL=.*|ESCRIBANO_SUBJECT_GROUPING_MODEL=qwen3.5:9b|" ~/.escribano/.env
cp "$SNAP_DIR/escribano.db" ~/.escribano/escribano.db
escribano --file "${VIDEOS[0]}" --format card --stdout > /tmp/grouping-9b.md 2>&1

diff /tmp/grouping-4b.md /tmp/grouping-9b.md
```

Check:
- Are subjects meaningful and distinct?
- Are block IDs correctly assigned (no orphaned blocks)?
- Does it correctly identify personal vs work time?

---

## PHASE 9 — MLX VLM Model Check (optional but recommended)

Verify the 4bit VLM model is loaded:

```bash
sed -i '' "s|^ESCRIBANO_VERBOSE=.*|ESCRIBANO_VERBOSE=true|" ~/.escribano/.env
escribano --file "${VIDEOS[0]}" --skip-summary 2>&1 | grep "VLM.*Model\|Model:"
sed -i '' "s|^ESCRIBANO_VERBOSE=.*|ESCRIBANO_VERBOSE=false|" ~/.escribano/.env
```

Expected: `[VLM] Model: mlx-community/Qwen3-VL-2B-Instruct-4bit`

---

## PHASE 10 — Record Conclusions

```bash
mkdir -p ~/.escribano/eval-results
cat > ~/.escribano/eval-results/conclusions-$(date +%Y%m%d).md << 'EOF'
# Model Evaluation Results — DATE

## Machine: [MBP 128GB / M1 Air 16GB]

### Recommended Defaults
- LLM (summary): [model]
- Subject grouping: [model]
- VLM: mlx-community/Qwen3-VL-2B-Instruct-4bit (unchanged)

### Key Findings
- [Finding 1]
- [Finding 2]

### Final ~/.escribano/.env settings
ESCRIBANO_LLM_MODEL=[winning model]
ESCRIBANO_SUBJECT_GROUPING_MODEL=[winning model]
ESCRIBANO_VLM_MODEL=mlx-community/Qwen3-VL-2B-Instruct-4bit
EOF

echo "Conclusions saved. Share results back to PR #13."
```

---

## Expected Outcomes (hypothesis)

Based on Qwen3.5 benchmark research (March 2026):
- **qwen3.5:9b** should match or exceed `qwen3:14b` quality at half the RAM requirement
- **qwen3.5:4b** should be sufficient for subject grouping (simpler structured task)
- **M1 Air 16GB** can run `qwen3.5:9b` comfortably (~5-6GB VRAM)
- **MBP 128GB** should prefer `qwen3.5:27b` for best quality summaries

---

## Troubleshooting

**`--env-file` not supported**: Upgrade to Node.js >= 20.6, or `source ~/.escribano/.env` manually
before running `npx escribano`.

**Ollama OOM crash**: Reduce `ESCRIBANO_LLM_MODEL` to a smaller size, or set
`OLLAMA_MAX_LOADED_MODELS=1` in `~/.escribano/.env`.

**VLM bridge timeout**: Set `ESCRIBANO_MLX_STARTUP_TIMEOUT=180000` (3 min) in `~/.escribano/.env`.

**Subject grouping parse failure**: Check logs for `[subject-grouping] Failed to parse any groups`.
Try bumping `ESCRIBANO_SUBJECT_GROUPING_MODEL` to `qwen3.5:9b`.

**Long first-run inference**: Normal — the model needs to cold-load. Subsequent runs on
the same model are faster.
```
