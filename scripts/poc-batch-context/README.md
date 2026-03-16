# Batch-Contextual VLM Analysis POC

Compares two prompting strategies for analyzing frame sequences:

- **SIMPLE**: Free-form "describe what's happening" (no format constraints)
- **STRUCTURED**: Activity ranges with defined format (activity, apps, topics, description)

## Quick Start

First, process a video (if you haven't already):
```bash
npx escribano --file ~/Desktop/Screen\ Recording.mov
```

Then run the POC:
```bash
# List processed recordings
tsx scripts/poc-batch-context/index.ts

# Run on a recording (both prompts per batch)
tsx scripts/poc-batch-context/index.ts --recording-id <id>

# Tune batch size
tsx scripts/poc-batch-context/index.ts --recording-id <id> --batch-size 8

# Quick test (first 3 batches only)
tsx scripts/poc-batch-context/index.ts --recording-id <id> --limit 3

# Try a larger model
tsx scripts/poc-batch-context/index.ts --recording-id <id> --model mlx-community/Qwen3-VL-7B-Instruct-4bit
```

## Output

For each batch, you'll see:

```
BATCH 1 | frames f1–f5 | t=0s → t=50s
════════════════════════════════════════

[SIMPLE — Free-form description]
  The user is coding in neovim, implementing a TypeScript service...

[STRUCTURED — Activity ranges]
  Range  [1-4]     coding       | neovim, iTerm
    Topics: TypeScript, escribano
    "Implementing VLM batch processor for the escribano project"
  Range  [5-5]     terminal     | iTerm
    Topics: vitest
    "Running vitest suite to validate changes"

[PER-FRAME — Existing observations in DB]
  f1  t=0s   coding      "Writing TypeScript function..."
  f2  t=10s  coding      "Editing batch processor..."
  ...
```

## What to Look For

1. **Does holistic context help?** Compare the SIMPLE and STRUCTURED descriptions against the PER-FRAME ground truth.
2. **Transition detection:** Do ranges catch transitions that per-frame analysis bundles together?
3. **Format compliance:** Does STRUCTURED return parseable ranges or fall back to raw text?
4. **Batch size:** Try `--batch-size 5` vs `--batch-size 10` — does larger batch degrade quality?

## Notes

- The POC uses a separate socket (`/tmp/escribano-poc-vlm.sock`) to avoid conflicts with production.
- Bridge loads once; both prompts reuse the same connection.
- If the model ignores the STRUCTURED format, the raw response is printed (useful signal for prompt tuning).
