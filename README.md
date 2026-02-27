# Escribano

Record your screen. Get a structured summary of what you did.

---

## What you put in

A screen recording. Could be 20 minutes, could be 3 hours. You didn't take notes.

## What you get back (~9 minutes later)

```markdown
# Session Card - Feb 25, 2026

## Escribano Pipeline Optimization
**1h 53m** | coding 22m, debugging 30m, terminal 24m, review 58m, planning 6m

- Optimized the video processing pipeline by evaluating skip-frame strategies 
  and removing scene detection for 180-minute videos.
- Resolved persistent VLM parsing failures and truncation errors by implementing 
  raw response logging and fallback mechanisms.
- Executed database migrations to add the new observations table schema.
- Benchmarked the performance of the GLM-5 and Qwen-VL models.

## Frame Extraction & Scene Detection
**19m** | coding 11m, debugging 4m, terminal 4m

- Developed TypeScript scripts for video frame extraction using FFmpeg.
- Debugged a critical parsing failure at Frame 3.
- Monitored terminal logs to track progress of a 792-second video file.

## Research & System Analysis
**22m** | review 3m, research 2m, coding 7m, terminal 6m

- Reviewed GitHub Copilot pricing and Screenpipe repository architecture.
- Investigated the database schema in TablePlus.

---
*Personal time: 2h 38m (WhatsApp, Instagram, Email)*
```

That's the **card** format. Two others:

### Standup format

```markdown
## Standup - Feb 25, 2026

**What I did:**
- Debugged VLM parsing failures by implementing raw response logging
- Optimized video frame extraction pipeline using FFmpeg
- Analyzed GLM-5 and Qwen-VL model performance
- Implemented database schema migrations

**Key outcomes:**
- Resolved truncated response issues with fallback parsing
- Identified scene detection as a latency bottleneck
- Validated new batch extraction strategy

**Next:**
- Merge scene detection optimization branch
- Benchmark qwen3_next model
- Add unit tests for fallback parsing
```

Paste straight into Slack.

### Narrative format

```markdown
# Session Summary: Sunday, February 22, 2026

## Overview
I spent nearly three hours optimizing the VLM inference pipeline. The main focus 
was resolving JSON parsing errors during batch processing and benchmarking the 
qwen3-vl:4b model against InternVL-14B. By the end, I'd identified the truncation 
root cause, adjusted MAX_TOKENS, and validated the fix against 342 frames — 
resulting in a 4x speedup with continuous batching.

## Timeline
* **0:00** (45m): Terminal work, running benchmark scripts
* **45:00** (60m): Debugging JSON parsing in VS Code
* **1:45:00** (40m): Researching model quantization
* **2:25:00** (34m): Documenting performance metrics
...
```

Good for retrospectives or blog drafts.

---

## Benchmarks

Ran the full pipeline on 11 real screen recordings:

| Metric | Result |
|--------|--------|
| Videos processed | 11 |
| Artifacts generated | 33 (3 formats × 11 videos) |
| Success rate | 100% |
| Total time | 1h 41m |
| Avg per video | **~9 min** (pipeline + all 3 formats) |
| Hardware | MacBook Pro M4 Max, 128GB |

Everything runs locally. No API keys. Nothing leaves your machine.

---

## Why this exists

Most screen recording tools just give you a video file. If you want to remember what you did, you have to watch it back.

Escribano watches it for you. It extracts frames, runs them through a vision-language model, transcribes any audio, and writes up what happened — broken into topics, with timestamps and time per activity.

Built for developers: understands the difference between debugging, coding, reading docs, and scrolling Slack. Doesn't just OCR text (which produces garbage when every screen has "function" and "const" on it).

---

## How it works

```
Screen recording
     │
     ├──► Audio: Silero VAD → Whisper → transcripts
     │
     └──► Video: FFmpeg frames → scene detection → adaptive sampling
                                              │
                                              ▼
                                    VLM inference (MLX-VLM, Qwen3-VL-2B)
                                              │
                                              ▼
                                    "Debugging in terminal"
                                    "Reading docs in Chrome"
                                    "Coding in VS Code"
     │
     ▼
Activity segmentation → temporal audio alignment → TopicBlocks
     │
     ▼
LLM summary (Ollama, qwen3:32b) → Markdown artifact
```

Uses VLM-first visual understanding, not OCR + text clustering. OCR fails for developer work because all code screens produce similar tokens. VLMs understand the *activity*, not just the text.

---

## Quick Start

### Prerequisites

```bash
# macOS (Homebrew)
brew install ollama whisper-cpp ffmpeg

# LLM model for summaries
ollama pull qwen3:32b

# MLX-VLM for frame analysis
pip install mlx-vlm
```

### Run

```bash
npx github:eduardosanzb/escribano --file "~/Desktop/Screen Recording.mov"

# Or locally
git clone https://github.com/eduardosanzb/escribano.git
cd escribano
pnpm install
pnpm escribano --file "~/Desktop/Screen Recording.mov"
```

Output: `~/.escribano/artifacts/`

---

## CLI

### Flags

| Flag | What it does |
|------|--------------|
| `--file <path>` | Process a video file |
| `--mic-audio <path>` | External mic audio |
| `--system-audio <path>` | External system audio |
| `--format <format>` | `card`, `standup`, or `narrative` (default: card) |
| `--force` | Reprocess from scratch |
| `--skip-summary` | Process frames only, skip artifact |
| `--include-personal` | Include personal time (filtered by default) |
| `--copy` | Copy to clipboard |
| `--stdout` | Print to stdout |
| `--help` | Show all options |

### Formats

| Format | Use for | Style |
|--------|---------|-------|
| `card` | Personal review, daily notes | Time breakdowns per subject, bullets |
| `standup` | Daily standup, async updates | What I did / Outcomes / Next |
| `narrative` | Retrospectives, blog drafts | Prose with timeline |

### Examples

```bash
# Process and copy
pnpm escribano --file "~/Desktop/Screen Recording.mov" --format standup --copy

# Narrative format
pnpm escribano --file session.mp4 --format narrative --force

# With external audio
pnpm escribano --file recording.mov --mic-audio mic.wav
```

---

## Supported inputs

| Source | Command |
|--------|---------|
| QuickTime recording | `--file video.mov` |
| Cap recording | Auto-detected in `~/Movies/Cap/` |
| Any MP4/MOV | `--file /path/to/video.mp4` |
| External audio | `--mic-audio mic.wav --system-audio system.wav` |

---

## Architecture

Clean architecture: domain entities, pure services, adapter interfaces for external systems (MLX-VLM, Ollama, Whisper, FFmpeg, SQLite).

Deep dives:
- [Why OCR fails for developers](docs/adr/005-vlm-first-visual-pipeline.md)
- [MLX-VLM migration for 4x speedup](docs/adr/006-mlx-vlm-adapter.md)
- [Benchmarks and learnings](docs/learnings.md)

Full architecture: [docs/architecture.md](docs/architecture.md)

---

## Requirements

- **macOS** (Apple Silicon for MLX-VLM)
- **Node.js 20+**
- **16GB+ RAM** (32GB+ recommended)
- **~10GB disk** for models

---

## Roadmap

- [x] VLM-first visual pipeline
- [x] MLX-VLM migration
- [x] Activity segmentation
- [x] Multiple artifact formats
- [ ] OCR on keyframes for code/URLs
- [ ] MCP server for AI assistants
- [ ] Cross-recording queries

---

## License

MIT

---

*Escribano = "The Scribe"*
