# Escribano

**AI-powered session intelligence for developers.**

Escribano watches you work, understands what you're doing, and writes about it. Feed it a screen recording and get a structured summary of your coding session — what you worked on, when, and what you accomplished.

## What You Get

**Before**: A 49-minute screen recording. Hours of debugging, research, coding. No notes.

**After** (auto-generated):

```markdown
# Session Summary: 2/21/2026

## Overview  
Spent 49 minutes debugging and refining a Visual Language Model (VLM) pipeline, 
switching between terminal logs, code updates, and external resources.

---

## Debugging VLM Pipeline Issues: 4:48 - 14:20  
Debugging deprecated VLM pipeline code in the OpenCode terminal. The logs show 
warnings about outdated VLM implementations. Repeatedly inspecting error messages 
for the `open-code.json` file, particularly an LSP error related to the language 
server protocol. Switching between macOS terminal windows and the Ghostty terminal 
emulator to test different configurations.

---

## Refactoring VLM Pipeline Code: 20:12 - 37:38  
Deeply engaged in refactoring the VLM pipeline in OpenCode. Editing the 
`src/adapters/intelligence/ollama.adapter.ts` file to define a `describeImageSequential()` 
function, replacing batch processing with sequential logic. The focus shifts to 
Phase 4: Future Considerations, including "firecrawl-mcp" and "MLX migration."

---

## Key Outcomes  
- **Completed:**
  - Refactored `describeImageSequential()` to handle single-image processing
  - Updated deprecated VLM code with function renaming and prompt simplification
- **Remaining Tasks:**
  - Resolve the LSP error in `open-code.json`
  - Debug the Qwen3-Coder Next model in LM Studio
```

## Why Escribano?

- **Understands activities**: Classifies debugging, coding, research, meetings, terminal work — not just OCR text
- **Segments your work**: Breaks sessions into coherent topic blocks with timestamps
- **Local-first**: All processing happens on your machine. Your screen data never leaves.
- **VLM-powered**: Uses vision-language models to understand screenshots directly (proven better than OCR clustering)

## Quick Start

### Prerequisites

```bash
# macOS (via Homebrew)
brew install ollama whisper-cpp ffmpeg

# Pull the LLM model for summary generation
ollama pull qwen3:32b

# Install MLX-VLM for frame analysis (Python)
pip install mlx-vlm
```

### Run

```bash
# Process a screen recording
npx github:eduardosanzb/escribano --file "/path/to/recording.mov"

# Or clone and run locally
git clone https://github.com/eduardosanzb/escribano.git
cd escribano
pnpm install
pnpm escribano --file "~/Desktop/Screen Recording.mov"
```

Output: Markdown summary saved to `~/.escribano/artifacts/`

## How It Works

```
Recording → Frame Extraction → Scene Detection → Adaptive Sampling (~100-150 frames)
    ↓
VLM Batch Inference (MLX-VLM, Qwen3-VL-2B) → "Debugging in terminal", "Reading docs in Chrome"
    ↓
Audio Pipeline (parallel): Silero VAD → Whisper → Transcripts
    ↓
Activity Segmentation → Temporal Audio Alignment → TopicBlocks
    ↓
LLM Summary (Ollama, qwen3:32b) → Markdown Artifact
```

**Key insight**: Escribano uses VLM-first visual understanding instead of OCR + text clustering. OCR fails for developer work because all code screens produce similar tokens (`const`, `function`, `import`). VLMs understand the *activity*, not just the text.

## Supported Inputs

| Source | Command |
|--------|---------|
| QuickTime recording | `--file video.mov` |
| Cap recording | Auto-detected in `~/Movies/Cap/` |
| Any MP4/MOV | `--file /path/to/video.mp4` |
| External audio | `--mic-audio mic.wav --system-audio system.wav` |

## CLI Options

```bash
escribano --file recording.mov     # Process specific file
escribano --force                  # Reprocess from scratch
escribano --skip-summary           # Process only, skip LLM summary
escribano --help                   # Show all options
```

## Architecture

Built with Clean Architecture principles:

- **Domain**: Core entities (Recording, Observation, TopicBlock, Context, Artifact)
- **Services**: Pure business logic (frame sampling, activity segmentation, temporal alignment)
- **Adapters**: External systems (MLX-VLM, Ollama, Whisper, FFmpeg, SQLite)

See [docs/architecture.md](docs/architecture.md) for full details.

## Technical Deep Dives

- [ADR-005: Why OCR-based screen intelligence fails for developers](docs/adr/005-vlm-first-visual-pipeline.md)
- [ADR-006: MLX-VLM migration for 4x faster inference](docs/adr/006-mlx-vlm-adapter.md)
- [Learnings: VLM benchmarks, frame sampling, audio preprocessing](docs/learnings.md)

## Requirements

- **macOS** (Apple Silicon recommended for MLX-VLM)
- **Node.js 20+**
- **16GB+ RAM** (32GB+ recommended for larger models)
- **~10GB disk** for models (qwen3:32b is ~20GB, qwen3-vl-2b is ~4GB)

## Roadmap

- [x] VLM-first visual pipeline
- [x] MLX-VLM migration (4x speedup)
- [x] Activity segmentation
- [ ] OCR on keyframes (concrete code/URLs in summaries)
- [ ] MCP server for AI assistant integration
- [ ] Cross-recording context queries

## License

MIT

---

*Escribano = "The Scribe" — because your coding sessions deserve documentation too.*
