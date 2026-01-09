# Escribano - Project Milestones

> *The scribe who transforms recordings into living knowledge*

## Project Goal

Escribano is an AI-powered session intelligence tool that automatically captures, transcribes, classifies, and transforms work sessions (meetings, debugging, tutorials, learning) into structured, actionable documents.

**Vision:** Transform "dead" recordings into living knowledge through automatic transcription, classification, and artifact generation—all configurable from manual (level 0) to fully autonomous (level 4).

---

## Milestone 1: Core Pipeline - Transcribe Last Cap Recording 🎯

**Description:** Build foundational pipeline to read Cap recordings and transcribe them using Whisper. This milestone establishes core architecture and validates end-to-end functionality.

### Completed ✅

- [x] **Project Setup**
   - [x] Initialize pnpm project with proper dependencies
   - [x] Install dependencies: `zod`, `typescript`, `@types/node`
   - [x] Install test dependencies: `vitest`, `@vitest/ui`
   - [x] Create `tsconfig.json` with ESNext module resolution
   - [x] Configure package as "module" type

- [x] **Core Types (`src/0_types.ts`)**
   - [x] Recording schema with all required fields (id, source, audioPath, videoPath, duration, capturedAt)
   - [x] Transcript and TranscriptSegment schemas
   - [x] Session schema with status and type
   - [x] Port interfaces: TranscriptionService, CaptureSource, IntelligenceService
   - [x] Config schemas: CapConfig, WhisperConfig
   - [x] Fixed: Schema default values use `.default()` for runtime access

- [x] **Cap Adapter (`src/adapters/cap.adapter.ts`)**
   - [x] `createCapSource()` factory function
   - [x] `getLatestRecording()` method
   - [x] `listRecordings()` method
   - [x] `parseCapRecording()` - parses .cap directories from filesystem
   - [x] Reads `recording-meta.json` when available
   - [x] Finds audio files (supports .ogg, .mp3, .wav, .m4a)
   - [x] Finds video files (supports .mp4, .webm, .mov)
   - [x] Estimates audio duration from file size (OGG ~12KB/s, MP3 ~16KB/s)
   - [x] Handles Cap's actual directory structure (`~/Library/Application Support/so.cap.desktop/recordings`)
   - [x] Proper error handling with try-catch blocks
   - [x] Fixed: `expandPath()` helper function for `~` expansion
   - [x] Fixed: Config parsing uses schema defaults correctly
   - [x] **Fixed Bug**: Extracts paths from `meta.segments[0].display.path` and `meta.segments[0].mic.path` structure
   - [x] **Fixed**: Returns null for recordings without audio (transcribable only)
   - [x] **Fixed**: Duration defaults to 0 (future enhancement to calculate from file metadata)

- [x] **Whisper Adapter (`src/adapters/whisper.adapter.ts`)**
   - [x] `createWhisperTranscriber()` factory function
   - [x] Implements TranscriptionService interface
   - [x] Shells out to `whisper-cli` or `whisper-cpp` binary
   - [x] Parses whisper.cpp JSON output format
   - [x] Fallback parsing for plain text output with timestamps
   - [x] Converts timestamps to TranscriptSegments (HH:MM:SS.mmm → seconds)
   - [x] Supports model configuration (tiny, base, small, medium, large-v3)
   - [x] Model path resolution for Homebrew installation on macOS
   - [x] Fixed: uses `large-v3` as default model
   - [x] Fixed: supports `cwd` config for portable model paths
   - [x] Fixed: Changed `-oj` flag to `-oj` for JSON output
   - [x] Fixed: All imports use `.js` extensions
   - [x] **Added Feature**: Audio format conversion using ffmpeg
   - [x] **Added**: Automatic detection of unsupported formats (ogg, m4a, opus)
   - [x] **Added**: Conversion to WAV (16kHz, mono) before transcription
   - [x] **Added**: 10-minute timeout for large file conversions (supports 1-3 hour files)
   - [x] **Added**: Cleanup of temporary `.converted.wav` files after transcription
   - [x] **Added**: Fail-fast error detection for transcription failures
   - [x] **Added**: Proper error messages and cleanup on failures
   - [x] **Added**: Processing feedback ("Processing transcription...")
   - [x] **Reduced**: Verbose console logging (only essential messages)
   - [x] **Updated**: Prerequisites comment to include ffmpeg

- [x] **Process Session Action (`src/actions/process-session.ts`)**
   - [x] `processSession()` pure function (no DI wrapper needed)
   - [x] Takes Recording and TranscriptionService as explicit parameters
   - [x] Calls `transcriber.transcribe()` to get transcript
   - [x] Creates Session object with all required fields
   - [x] Returns completed session with status 'transcribed'
   - [x] Fixed: All imports use `.js` extensions

- [x] **CLI Entry Point (`src/index.ts`)**
   - [x] Command parsing: `list`, `transcribe-latest`, `transcribe <id>`
   - [x] Model management: auto-download from HuggingFace if missing
   - [x] Integration with Cap and Whisper adapters
   - [x] Session display and output formatting
   - [x] Fixed: All imports use `.js` extensions
   - [x] Fixed: Template literals for string concatenation (Biome linting)
   - [x] **Added**: Processing feedback during transcription

- [x] **Tests**
   - [x] Unit tests (`src/tests/cap.adapter.test.ts`)
     - ✓ "should create a CapSource"
     - ✓ "should return null when directory does not exist"
     - ✓ "should validate Cap recording metadata structure"
     - ✓ "should identify recordings without mic/audio field"
     - ✓ "should identify missing segments array"
     - ✓ "should identify empty segments array"
     - **Status:** 6/6 passing
   - [x] Integration tests (`src/tests/integration.test.ts`)
     - Tests full pipeline with mocked Whisper
     - ✓ "should list recordings"
     - ✓ "should get latest recording"
     - **Status:** 2/2 passing
   - [x] Real integration tests (`src/tests/cap-real.test.ts`)
     - Tests with actual Cap recordings directory
     - ✓ "should list Cap recordings from filesystem"
     - ✓ "should get latest recording"
     - ✓ "should only return recordings with audio"
     - **Status:** 3/3 passing

- [x] **Development Tooling**
   - [x] Switched from `ts-node` to `tsx` for ES module support
   - [x] Updated all npm scripts to use `tsx` for development
   - [x] Build process: `pnpm build` compiles TypeScript to `dist/`
   - [x] All imports use `.js` extensions (ES module requirement)
   - [x] All linting issues fixed (Biome)

- [x] **Documentation**
   - [x] README.md with quick start and architecture overview
   - [x] README.md updated with prerequisites (whisper-cli + ffmpeg)
   - [x] README.md added "Audio Format Support" section
   - [x] README.md documented conversion process and timeout strategy
   - [x] README.md added example conversions table
   - [x] AGENTS.md updated with current structure and tsx instructions
   - [x] All prerequisite mentions updated across codebase (3 locations: README, index.ts, whisper.adapter.ts)
   - [x] All linting issues fixed (Biome)

- [x] **End-to-End Integration**
   - [x] Full pipeline working: `pnpm run list` → `pnpm run transcribe-latest`
   - [x] Schema default values work correctly
   - [x] All linting and type checking passes
   - [x] Tested with real Cap recordings (ogg/opus files successfully convert and transcribe)
   - [x] Verified no orphaned temporary files after transcription

### Remaining ⚧

None - Milestone 1 is 100% complete!

### Final Output for Milestone 1

A working CLI command that:
```bash
# Run from escribano directory
escribano transcribe-latest

# Expected output:
Processing transcription...
Transcribing: [Recording ID]
Converting [audio-path] to WAV format...
Conversion complete: [converted-path]
Transcription complete. Duration: [XX]s
```

**Technical Wins:**
- Real Cap recordings (Ogg/Opus) are now fully supported
- Automatic audio conversion handles all formats via ffmpeg
- Error detection fails fast with clear messages
- No orphaned temporary files
- Clean, minimal console output

---

## Milestone 2: Intelligence - Multi-Label Classification 🧠

**Description:** Add LLM-powered multi-label classification to automatically determine session types (meeting, debugging, tutorial, learning, working) with confidence scores. Replaced single-type classification with multi-label scoring for better handling of mixed sessions.

**Completed Date:** January 9, 2026

### Completed ✅

- [x] **Intelligence Adapter (`src/adapters/intelligence.adapter.ts`)**
   - [x] `createIntelligenceService()` factory function
   - [x] `classify()` method using Ollama REST API
   - [x] `generate()` method placeholder (throws "not implemented - Milestone 3")
   - [x] `checkOllamaHealth()` integrated into adapter (PR comment #1)
   - [x] Retry logic with exponential backoff (3 attempts)
   - [x] Timeout handling (300s default)
   - [x] System prompt support (JSON-only output)
   - [x] Ultra-simple JSON parser (fail-fast, handles 0-1 and 0-100 formats)
   - [x] Read prompts from `prompts/` directory
   - [x] Configure Ollama endpoint (default: `http://localhost:11434/api/chat`)
   - [x] Handle Ollama API responses (OpenAI-compatible format)

- [x] **Classify Session Action (`src/actions/classify-session.ts`)**
   - [x] `classifySession()` pure function
   - [x] Takes Session and IntelligenceService as parameters
   - [x] Calls `intelligence.classify()` to get multi-label scores
   - [x] Updates session with classification scores
   - [x] Returns classified session with status 'classified'
   - [x] `interleaveTranscripts()` for multiple audio sources

- [x] **Multi-Label Classification Schema**
   - [x] New format: `{meeting: 0-100, debugging: 0-100, tutorial: 0-100, learning: 0-100, working: 0-100}`
   - [x] Removed old format: `{type: "meeting", confidence: 0.95, entities: [...]}`
   - [x] Type-safe with Zod validation
   - [x] Backward compatible parser (handles percentage variations)

- [x] **Session Types (5 Multi-Label)**
   - [x] **meeting** (0-100): Conversations, interviews, discussions
   - [x] **debugging** (0-100): Fixing errors, troubleshooting
   - [x] **tutorial** (0-100): Teaching, demonstrating
   - [x] **learning** (0-100): Researching, studying
   - [x] **working** (0-100): Building, coding (not debugging) - NEW TYPE

- [x] **Prompts**
   - [x] `prompts/classify.md` - V2 detailed prompt (examples & indicators per type)
   - [x] System prompt: "You are a JSON-only classifier"
   - [x] User prompt with 5 session types + examples
   - [x] Output format specification with example
   - [x] Removed entity extraction (deferred to Milestone 3)

- [x] **Session Persistence (`src/adapters/storage.adapter.ts`)**
   - [x] `createStorageService()` factory function
   - [x] Save sessions to `~/.escribano/sessions/`
   - [x] Load session by ID
   - [x] List all sessions
   - [x] JSON serialization with all metadata

- [x] **Transcript Reuse**
   - [x] `classify-latest` checks for existing sessions
   - [x] Reuses transcript if available (saves time/resources)
   - [x] `classify <id>` loads existing session
   - [x] Clear error messages for missing transcripts

- [x] **CLI Commands (`src/index.ts`)**
   - [x] `classify-latest` - Classifies most recent session
   - [x] `classify <id>` - Classifies specific session by ID
   - [x] Pretty display with bar charts (█ repeats)
   - [x] Primary/secondary type identification
   - [x] Artifact suggestions based on scores >50%
   - [x] Fixed: Threshold from 0.25 to 25 (percentage)
   - [x] Fixed: Filter function missing return statement
   - [x] Fixed: Removed unused `formatTimestamp` function

- [x] **Tests**
   - [x] Intelligence adapter unit tests (3/5 passing, 2 expected failures)
   - [x] Classification action unit tests (5/5 passing)
   - [x] Ollama health check function
   - [x] Session storage tests (integration)
   - [x] Updated all test expectations for new format

- [x] **PR Comments Addressed**
   - [x] #1: Move `checkOllamaHealth()` into intelligence adapter
   - [x] #2: Add TODO comment for cache skip option
   - [x] #5: Remove TODO comment (cap.adapter.ts line 99)
   - [x] #6: Research Ollama streaming (kept non-streaming - better for structured outputs)
   - [x] #7: Delete `src/tests/cap-real.test.ts`
   - [x] #8: Fix cap.adapter.test.ts (tests updated, all passing)

### Final Output for Milestone 2

System automatically classifies sessions with multi-label scores:
```
╔═════════════════════════════╗
║     Session Classification Results            ║
╚═════════════════════════════════════════╝

📝 Session ID: 2026-01-09--01.28 PM.cap

📊 Session Type Analysis:
   🎯 meeting    █████████████████ 85%
   📌 learning   █████████ 45%

🏷️  Primary Type: MEETING (85%)
  📌 Secondary: learning (45%)

💡 Suggested Artifacts:
   • Meeting summary & action items
```

**Example Classification JSON:**
```json
{
  "meeting": 85,
  "debugging": 10,
  "tutorial": 0,
  "learning": 45,
  "working": 20
}
```

**Key Achievements:**
- Multi-label classification handles mixed sessions (e.g., meeting with learning elements)
- Simple, robust parser works with multiple LLM models (tested: qwen3:32b, llama3.1:8b, mistral:7b)
- Fail-fast error handling with clear messages
- Ultra-simple codebase - no over-engineering
- Clean display with visual bar charts
- Smart artifact suggestions based on confidence scores

---

## Milestone 3: Artifacts - Generate Actionable Outputs 📄

**Description:** Generate structured artifacts based on session type: summaries, action items, runbooks, step-by-step guides, screenshots, notes.

### Tasks (Not Started)

- [ ] **Generate Artifact Action (`src/actions/generate-artifact.ts`)**
   - [ ] `generateArtifact()` pure function
   - [ ] Takes Session, IntelligenceService, and ArtifactType as parameters
   - [ ] Routes to appropriate prompt based on artifact type
   - [ ] Calls `intelligence.generate()` with context
   - [ ] Returns generated artifact

- [ ] **Artifact Types Support**
   - [ ] Summary - concise meeting overview
   - [ ] Action Items - extracted TODOs with owners
   - [ ] Runbook - step-by-step debugging guide
   - [ ] Screenshots - capture key frames from video
   - [ ] Step-by-step - tutorial guide
   - [ ] Notes - learning session notes

- [ ] **Screenshots Adapter (`src/adapters/ffmpeg.adapter.ts`)**
   - [ ] Extract frames from video at specific timestamps
   - [ ] Support multiple formats (mp4, webm, mov)
   - [ ] Handle Cap's cursor.json for precise cursor tracking
   - [ ] Save screenshots to output directory

- [ ] **Storage Adapter (`src/adapters/storage.adapter.ts`)**
   - [ ] Save sessions to filesystem/JSON
   - [ ] Save artifacts to files with naming convention
   - [ ] Configure output directory (default: `~/Documents/escribano`)
   - [ ] Handle file conflicts (overwrite/append strategies)

- [ ] **Tests**
   - [ ] Unit tests for each artifact type
   - [ ] Integration test: Full flow to artifact generation
   - [ ] Validate artifact content quality

### Final Output for Milestone 3

Automatic artifact generation for each session:
```javascript
{
  "id": "session-123",
  "status": "complete",
  "artifacts": [
    {
      "type": "summary",
      "content": "Discussed feature X, decided on approach Y...",
      "createdAt": "2026-01-08T01:05:00.000Z"
    },
    {
      "type": "actionItems",
      "content": ["Implement feature X", "Review documentation", ...],
      "createdAt": "2026-01-08T01:05:00.000Z"
    }
  ]
}
```

---

## Milestone 4: Publishing - Knowledge Base Integration 🚀

**Description:** Publish sessions and artifacts to external knowledge bases (Outline, GitHub, S3). This makes knowledge accessible to the entire team or public.

### Tasks (Not Started)

- [ ] **Outline Adapter (`src/adapters/outline.adapter.ts`)**
   - [ ] `createOutlinePublisher()` factory function
   - [ ] `publishSession()` method - creates Outline document
   - [ ] `publishArtifact()` method - adds artifact to session
   - [ ] Convert transcript + artifact to Outline markdown format
   - [ ] Use Outline API or file sync (based on config)
   - [ ] Handle Outline-specific features: tags, collections, permissions

- [ ] **GitHub Adapter (`src/adapters/github.adapter.ts`)**
   - [ ] `createGitHubPublisher()` factory function
   - [ ] `publishActionItems()` method - creates GitHub issues
   - [ ] `publishToProject()` method - creates issues in specific project
   - [ ] Use GitHub REST API or Octokit
   - [ ] Configure project board integration
   - [ ] Map action items to GitHub issue templates

- [ ] **S3 Adapter (`src/adapters/s3.adapter.ts`)**
   - [ ] `createS3Storage()` factory function
   - [ ] `uploadRecording()` method - uploads video/audio to S3
   - [ ] `uploadArtifact()` method - uploads artifacts to S3
   - [ ] Configure AWS credentials and bucket
   - [ ] Generate signed URLs for sharing
   - [ ] Use AWS SDK for S3 operations

- [ ] **Publish Action (`src/actions/publish-session.ts`)**
   - [ ] `publishSession()` pure function
   - [ ] Takes Session and multiple PublishingServices
   - [ ] Publishes to configured destinations
   - [ ] Returns published session with URLs/IDs
   - [ ] Publishes all artifacts from session metadata

- [ ] **Configuration**
   - [ ] Add `PublishingConfig` schema to `0_types.ts`
   - [ ] Support multiple destinations per session type
   - [ ] Default: Outline for meetings, GitHub for debugging
   - [ ] Save publishing URLs/IDs to session metadata

- [ ] **Tests**
   - [ ] Mock Outline API tests
   - [ ] Mock GitHub API tests
   - [ ] Integration test: Full publishing flow
   - [ ] Validate artifact content quality

### Final Output for Milestone 4

Configurable publishing to multiple destinations:
```javascript
{
  "id": "session-123",
  "status": "published",
  "publishedAt": "2026-01-08T01:10:00.000Z",
  "destinations": {
    "outline": {
      "url": "https://notes.example.com/doc/session-123",
      "id": "abc123-def456"
    },
    "github": {
      "url": "https://github.com/owner/repo/issues/456",
      "issueId": 456
    },
    "s3": {
      "recording": "https://s3.amazonaws.com/bucket/session-123.mp4",
      "artifact": "https://s3.amazonaws.com/bucket/session-123-summary.md"
    }
  }
}
```

---

## Milestone 5: Automation - Configurable Autonomy 🤖

**Description:** Implement automation levels (0-4) that control how much human intervention is required at each stage of the pipeline.

### Tasks (Not Started)

- [ ] **Automation Policy (`src/automation-policy.ts`)**
   - [ ] Define `AutomationLevel` enum (0, 1, 2, 3, 4)
   - [ ] Create `AutomationPolicy` type with rules per session type
   - [ ] Example rules:
     ```javascript
     {
       defaultLevel: 2,
       rules: {
         meeting: { level: 2, confirmArtifacts: ['summary'] },
         debugging: { level: 3, confirmArtifacts: [] },
         tutorial: { level: 2, confirmArtifacts: ['screenshots'] },
         learning: { level: 4, confirmArtifacts: [] }
       }
     }
     ```

- [ ] **Interaction Adapter (`src/adapters/interaction.adapter.ts`)**
   - [ ] `createInteractionService()` factory function
   - [ ] `promptUser()` method - asks for confirmation
   - [ ] `awaitInput()` method - waits for user choice
   - [ ] Support console input, OpenCode plugin, GUI prompts

- [ ] **Automation Orchestrator (`src/actions/orchestrate-session.ts`)**
   - [ ] `orchestrateSession()` pure function
   - [ ] Takes Session, all services, and AutomationPolicy as parameters
   - [ ] Executes workflow based on automation level:
     - Level 0: Everything manual (ask at each step)
     - Level 1: Detect + Ask (find recordings, ask to process)
     - Level 2: Process + Ask (auto transcribe/classify, ask for artifacts)
     - Level 3: Generate + Ask (auto artifacts, ask before publish)
     - Level 4: Full Auto (everything automatic, notify when done)
   - [ ] Returns final state with all actions taken

- [ ] **Configuration**
   - [ ] Add `AutomationConfig` schema to `0_types.ts`
   - [ ] Support per-session-type overrides
   - [ ] Global default level

- [ ] **Tests**
   - [ ] Test each automation level
   - [ ] Test policy evaluation
   - [ ] Mock interaction service for automation tests
   - [ ] Integration test: Full workflow at each level

### Final Output for Milestone 5

Configurable automation from fully manual to fully autonomous:
```bash
# Level 0 - Manual
escribano process <recording-id> --automation-level 0

# Level 2 - Semi-automatic
escribano process-latest --automation-level 2
# Auto: Transcribes, classifies
# Asks: "Generate summary? [y/n]"
# Asks: "Publish to Outline? [y/n]"

# Level 4 - Full auto
escribano --automation-level 4
# Auto: Does everything
# Notify: "Session published: https://notes.example.com/doc/abc123"
```

---

## Milestone 6: OpenCode Plugin Integration 🔌

**Description:** Create OpenCode plugin that provides seamless integration for AI assistants to use Escribano capabilities within development workflows.

### Tasks (Not Started)

- [ ] **Plugin Infrastructure (`src/plugin/`)**
   - [ ] Create plugin manifest/package metadata
   - [ ] Implement OpenCode protocol/tools interface
   - [ ] Export tool functions for OpenCode to call
   - [ ] Handle session management within plugin context

- [ ] **Plugin Tools**
   - [ ] `tool-list-recordings` - List available recordings
   - [ ] `tool-get-recording` - Get specific recording details
   - [ ] `tool-transcribe` - Transcribe a recording
   - [ ] `tool-classify` - Classify a session
   - [ ] `tool-generate-artifact` - Generate specific artifact
   - [ ] `tool-publish` - Publish session/artifacts
   - [ ] `tool-configure` - Update automation settings

- [ ] **Plugin CLI**
   - [ ] Expose CLI commands for direct invocation
   - [ ] Support interactive mode for AI assistant workflows
   - [ ] Handle error messages and suggestions clearly

- [ ] **Configuration**
   - [ ] Plugin config file (`.opencode/escribano/config.json`)
   - [ ] Workspace recording location settings
   - [ ] Service endpoint configuration

- [ ] **Tests**
   - [ ] Mock OpenCode plugin interface for tests
   - [ ] Test each tool function independently
   - [ ] Integration test with actual OpenCode environment

### Final Output for Milestone 6

OpenCode plugin with tool functions:
```typescript
// AI assistant can call:
await opencode.tools.escribano.listRecordings()
await opencode.tools.escribano.transcribeLatest()
await opencode.tools.escribano.classifySession(sessionId)
await opencode.tools.escribano.generateArtifact(sessionId, 'summary')
await opencode.tools.escribano.publish(sessionId)
await opencode.tools.escribano.configure(automationLevel)
```

---

## Completed Milestones

### ✅ Milestone 1: Core Pipeline - Transcribe Last Cap Recording
**Completed Date:** January 8, 2026

**Summary:** Built foundational pipeline to read Cap recordings and transcribe them using Whisper. Established core architecture and validated end-to-end functionality.

**Key Achievements:**
- Working CLI with commands: `list`, `transcribe-latest`, `transcribe <id>`
- Cap adapter successfully reads recordings from filesystem
- Whisper adapter transcribes audio using whisper.cpp
- Full pipeline: Recording → Transcript → Session
- All tests passing (11/11)
- Development tooling: tsx for fast TypeScript execution
- Schema default values working correctly
- ES modules with `.js` extensions fully integrated
- Clean architecture with port interfaces

**Technical Wins:**
- Real Cap recordings (Ogg/Opus) are now fully supported
- Automatic audio conversion handles all formats via ffmpeg
- Error detection fails fast with clear messages
- No orphaned temporary files
- Clean, minimal console output

---

## Design Principles Applied

1. **Single types file** - `0_types.ts` contains all types, interfaces, and schemas
2. **Functions over classes** - All adapters use factory functions returning interfaces
3. **Go-style architecture** - Pure functions with explicit dependencies as parameters
4. **Minimal viable** - Build just what's needed for each milestone
5. **Test-first** - Unit tests before integration, fixtures for filesystem testing
6. **Shell-based adapters** - Whisper, Ollama, and other services use CLI shelling
7. **TypeScript strict mode** - All types validated with Zod schemas
8. **Automation levels** - Configurable autonomy from manual (0) to full-auto (4)
9. **Caller-agnostic** - Use cases don't depend on who's calling them
10. **Port interfaces** - Adapters implement standard interfaces for easy swapping
