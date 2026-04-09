# Escribano

An always-on macOS recorder that turns your work into structured summaries.
Captures your screen continuously, runs a local vision-language model to understand
what you're doing, and generates standups, session cards, or narrative summaries on demand.

> **Download**: [GitHub Releases](https://github.com/eduardosanzb/escribano/releases/latest) — macOS Apple Silicon (M1+), 16 GB RAM minimum
> **Platform**: macOS only · Everything runs locally · No cloud, no API keys

---

## What you get back

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

## How the app works

Escribano runs as a native macOS menu bar application. Three concurrent processes share a
single Python bridge (MLX-VLM over a Unix socket):

1. **Capture** — ScreenCaptureKit captures frames at ~1s intervals. Perceptual hashing (pHash)
   deduplicates visually identical frames. Accepted frames are written to a local SQLite database.
2. **Analysis** — A Swift actor polls new frames and sends them in batches to a local VLM
   (Qwen3-VL via MLX). Each frame gets a description: activity type, apps visible, what you're doing.
3. **Aggregation** — A second actor groups observations into TopicBlocks using a local LLM. When
   you ask for an artifact, Escribano generates it from your recent TopicBlocks.

Everything runs on your machine. No data leaves your device.

---

## TypeScript pipeline (this repo)

This repository contains the TypeScript processing pipeline that powers Escribano's VLM and LLM
analysis. The Swift app calls it via a Python bridge (Unix socket + NDJSON protocol). You can
also use it directly for batch processing of video recordings.

### Quick start (batch)

```bash
# Prerequisites
brew install whisper-cpp ffmpeg
pip install mlx-vlm mlx-lm

# Process a recording
npx escribano --file "~/Desktop/Screen Recording.mov"
```

### Hardware requirements

Performance varies by hardware:

| Hardware | RAM | VLM Speed | LLM Model | LLM Speed | Total (1min video) |
|----------|-----|-----------|-----------|-----------|-------------------|
| **M4 Max** | 128GB | 0.7s/frame | Qwen3.5-27B | 53s avg | **~2.2 min** |
| **M1/M2/M3 Pro** | 16-32GB | 1.5-3s/frame | Qwen3.5-9B | 80-120s | ~5-8 min |
| **M1/M2 Air** | 16GB | 7-9s/frame | Qwen3.5-9B | 150-250s | ~12-15 min |

**Minimum viable**: 16GB unified memory (slower but functional)

**Recommended**: 32GB+ for comfortable use, 64GB+ for best quality

### Production benchmarks (March 2026)

Processed **17 real screen recordings** with MLX backend:

| Metric | Result |
|--------|--------|
| Videos processed | 17 |
| Successful | 15 (88%) |
| Total video duration | 25.6 hours |
| Artifacts generated | 45 (3 formats × 15 videos) |
| **LLM generation** | **~2.2 min per video** |
| Subject grouping | 78.7s avg |
| Artifact generation | 53.6s avg |
| LLM success rate | 100% (92 calls) |
| Hardware | MacBook Pro M4 Max, 128GB |
| Backend | MLX (Qwen3-VL-2B + Qwen3.5-27B) |

Everything runs locally. No API keys. Nothing leaves your machine.

---

## CLI reference

### Flags

| Flag | What it does |
|------|--------------|
| `--file <path>` | Process a video file |
| `--latest <dir>` | Find and process latest video in directory |
| `--mic-audio <path>` | External mic audio |
| `--system-audio <path>` | External system audio |
| `--format <format>` | `card`, `standup`, or `narrative` (default: card) |
| `--force` | Reprocess from scratch |
| `--skip-summary` | Process frames only, skip artifact |
| `--include-personal` | Include personal time (filtered by default) |
| `--copy` | Copy to clipboard |
| `--stdout` | Print to stdout |
| `--help` | Show all options |

### Subcommands

| Command | What it does |
|---------|--------------|
| `doctor` | Check prerequisites and system requirements |
| `config` | Show current configuration (merged from all sources) |
| `config --path` | Show path to config file (`~/.escribano/.env`) |

### Formats

| Format | Use for | Style |
|--------|---------|-------|
| `card` | Personal review, daily notes | Time breakdowns per subject, bullets |
| `standup` | Daily standup, async updates | What I did / Outcomes / Next |
| `narrative` | Retrospectives, blog drafts | Prose with timeline |

### Examples

```bash
# Process and copy
npx escribano --file "~/Desktop/Screen Recording.mov" --format standup --copy

# Find latest video in a directory
npx escribano --latest "~/Videos"

# Narrative format
npx escribano --file session.mp4 --format narrative --force

# With external audio
npx escribano --file recording.mov --mic-audio mic.wav

# View configuration
npx escribano config
npx escribano config --path
```

---

## Configuration

Escribano auto-creates a config file on first run that persists your settings:

```bash
# View current configuration
npx escribano config

# Show path to config file
npx escribano config --path

# Edit manually
vim ~/.escribano/.env
```

The config file (`~/.escribano/.env`) is organized by category with inline comments:

| Category | Examples |
|----------|----------|
| **Performance** | Frame width, batch size, sampling interval |
| **Quality** | Scene detection, token budget |
| **Models** | VLM model, LLM model, subject grouping model |
| **Debugging** | Verbose logging, VLM/Ollama debug output |
| **Recorder** | pHash threshold, debug logging, backpressure watermarks |
| **Advanced** | Socket path, timeouts, Python path |

Environment variables always take priority over the config file. For full reference, see [CLAUDE.md](CLAUDE.md#configuration).

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

- **macOS** (Apple Silicon for MLX inference)
- **Node.js 20+**
- **16 GB+ RAM** (see hardware tiers above)
- **~10 GB disk** for models

---

## Roadmap

- [x] VLM-first visual pipeline
- [x] MLX-VLM migration
- [x] Activity segmentation
- [x] Multiple artifact formats
- [x] Auto-detect best LLM model
- [x] Always-on recorder — Phase 1 (capture + pHash dedup)
- [x] Always-on recorder — Phase 2 (VLM analysis via Swift → Python bridge)
- [x] Always-on recorder — Phase 3a (continuous TopicBlock creation)
- [x] Always-on recorder — Phase 3b (time-range artifact generation via menu bar app)
- [ ] MCP server for AI assistants
- [ ] Auto-detect ffmpeg hardware acceleration
- [ ] OCR on keyframes for code/URLs
- [ ] Cross-recording queries

---

## License

MIT

---

*Escribano = "The Scribe"*
