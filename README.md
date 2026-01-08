# Escribano

> *The scribe who transforms recordings into living knowledge*

AI-powered session intelligence tool that automatically captures, transcribes, classifies, and transforms your work sessions.

## Quick Start

```bash
# Install dependencies
pnpm install

# Install prerequisites
brew install whisper-cpp ffmpeg

# Run tests
pnpm test

# Typecheck
pnpm typecheck

# Build
pnpm build
```

## Project Status

See [MILESTONES.md](./MILESTONES.md) for complete roadmap and current progress.

**Current Focus:** Milestone 2 - Intelligence (Classification & Entity Extraction)

### Completed ✅
- [x] Milestone 1: Core Pipeline (Transcribe Last Cap Recording)
- [x] Core types and interfaces (`0_types.ts`)
- [x] Cap adapter (reads filesystem recordings)
- [x] Whisper adapter (transcribes audio)
- [x] Process session action
- [x] Unit and integration tests
- [x] TypeScript configuration
- [x] Package scripts
- [x] CLI entry point
- [x] Model download and management
- [x] Whisper adapter completion (large-v3 model, cwd support)
- [x] Ollama intelligence adapter (Qwen3-32B model)
- [x] Classification action
- [x] Entity and Classification schemas
- [x] Classification prompt template
- [x] CLI commands: `classify-latest`, `classify <id>`
- [x] Unit tests for intelligence adapter
- [x] Ollama health check before classification
- [x] Session storage adapter (persist and load sessions)
- [x] Session reuse - load existing session before classification to avoid re-transcription
- [x] Transcript reuse - use existing transcript if available

### In Progress 🚧
- [ ] None

### Next Steps
1. Run integration tests
2. Test with real Cap recordings
3. Generate artifacts (Milestone 3)
4. Publishing destinations (Milestone 4)

```bash
# Run tests
pnpm test

# Watch mode
pnpm test --watch

# Run against real Cap recordings
pnpm test src/tests/cap-real.test.ts
```

## Architecture

```
src/
├── 0_types.ts           # All types and interfaces
├── adapters/
│   ├── cap.adapter.ts    # Read Cap recordings
│   └── whisper.adapter.ts # Transcribe with whisper
├── actions/
│   └── process-session.ts  # Transcribe recording → Session
└── tests/
    └── *.test.ts        # Unit + integration tests
```

## Design Principles

- **Single types file** - `0_types.ts` contains everything
- **Functions over classes** - Adapters are factory functions returning interfaces
- **Go-style** - Pure functions with explicit dependencies
- **Minimal viable** - Build just what's needed for the milestone

## Prerequisites

### System Dependencies

- **whisper-cli**: `brew install whisper-cpp`
- **ffmpeg**: `brew install ffmpeg` (required for audio format conversion)
- **ollama**: `brew install ollama` (required for classification and entity extraction)

### Installation

```bash
# Install Node.js dependencies
pnpm install

# Install system dependencies
brew install whisper-cpp ffmpeg
```

## Audio Format Support

whisper-cli natively supports: `wav`, `flac`, `mp3`

Other audio formats (ogg, m4a, opus, etc.) from Cap recordings are automatically converted to WAV (16kHz, mono) using ffmpeg before transcription.

### Conversion Process

1. Detect unsupported format from file extension
2. Convert to WAV using ffmpeg (timeout: 10 minutes for large files)
3. Transcribe converted file with whisper-cli
4. Clean up temporary converted file

### Example Conversions

| Input Format | Converted Path | Result |
|--------------|------------------|--------|
| `audio-input.ogg` | `audio-input.ogg.converted.wav` | Transcribed |
| `audio.m4a` | `audio.m4a.converted.wav` | Transcribed |
| `audio.wav` | `audio.wav` | Direct transcription (no conversion) |
| `audio.mp3` | `audio.mp3` | Direct transcription (no conversion) |

### Notes

- **Timeout**: 10 minutes is set for conversion, sufficient for 1-3 hour files
- **Cleanup**: Temporary `.converted.wav` files are automatically deleted after successful transcription
- **Error handling**: Conversion failures are logged and throw clear error messages

### Ollama Setup for Classification

#### Installation
```bash
# Install Ollama
brew install ollama

# Pull Qwen3-32B model
ollama pull qwen3:32b
```

#### Start Ollama Server
```bash
# Start server (localhost only)
ollama serve

# Start with performance tuning (recommended for M4 + 128GB RAM)
OLLAMA_HOST=0.0.0.0:11434 \
OLLAMA_CONTEXT_LENGTH=16384 \
OLLAMA_KEEP_ALIVE=-1 \
OLLAMA_MAX_LOADED_MODELS=3 \
OLLAMA_NUM_PARALLEL=4 \
ollama serve
```

#### Background Service (Production)
Create `~/Library/LaunchAgents/com.ollama.daemon.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>com.ollama.daemon</string>
    <key>ProgramArguments</key>
    <array>
      <string>/opt/homebrew/bin/ollama</string>
      <string>serve</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
      <key>OLLAMA_HOST</key>
      <string>0.0.0.0:11434</string>
      <key>OLLAMA_CONTEXT_LENGTH</key>
      <string>16384</string>
      <key>OLLAMA_KEEP_ALIVE</key>
      <string>-1</string>
      <key>OLLAMA_MAX_LOADED_MODELS</key>
      <integer>3</integer>
      <key>OLLAMA_NUM_PARALLEL</key>
      <integer>4</integer>
    </dict>
  </dict>
</plist>
```

Load and start service:
```bash
# Load service
launchctl load ~/Library/LaunchAgents/com.ollama.daemon.plist

# Start it
launchctl start com.ollama.daemon
```

#### Quick Test
```bash
curl http://localhost:11434/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "qwen3:32b",
    "messages": [{"role": "user", "content": "Say hello"}],
    "stream": false
  }'
```