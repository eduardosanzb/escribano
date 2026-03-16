# BACKLOG.md - Escribano

## Product Thesis: Agent-Native Work Memory
https://notes.eduardosanzb.dev/doc/ai-agenticn-escribano-the-agent-native-thesis-thouthgs-vfOWw4Hafp

Most screen recording tools summarize recordings for humans. Escribano should also produce **machine-readable work state for agents**.

When agents are the primary consumers, the output of software shifts fundamentally:

- **Structured, unambiguous state** — Not just a rendered summary, but a faithful representation of what's true right now. Agents need reliable contracts about when data is ready.
- **Rich error semantics** — Not "something went wrong." Agents need to know why it failed, whether it's retryable, and what the recovery path is.
- **Auditability as first-class output** — Agents operating in multi-step pipelines need provenance: what happened and why. Logs become outputs. Traces become outputs.
- **Idempotency signals** — An agent retrying an operation needs the system to declare whether it's safe and return consistent results.

**The deeper implication:** The "user interface" gets demoted to a rendering concern. The canonical output becomes the state + semantics layer, and human summaries are just one consumer alongside agents, other services, and monitoring systems.

This instinct is already present in Escribano's pipeline design: Whisper → VLM → structured summary formats where the "output" isn't a UI at all. That's exactly right for an agent-native world.

---

## Core Product Bet: Own the Recording Layer

The missing surface is **capture itself**. Escribano currently depends on external tools (Cap, QuickTime) and post-hoc video processing. Owning the recording pipeline unlocks:

- **Multi-monitor support** — Capture all screens with proper context
- **Better reliability** — Control frame sampling, scaling, timestamps (addresses 6K issues)
- **Always-on recording** — Never forget to start; work is always traceable
- **Agent-friendly output** — Structured capture from the start, not retrofitted

See: `docs/adr/009-always-on-recorder.md` for architecture decision and design.

---

## Now

### Recorder MVP (ADR-009)

#### Pre-Phase 1: ScreenCaptureKit Feasibility Spike
- [x] Create `scripts/poc-screencapturekit/main.swift` — standalone CLI, no pipeline integration
- [x] Validate `SCScreenshotManager.captureImage` works headlessly (macOS 14+)
- [x] Validate all displays enumerated + captured from CLI binary (single display tested)
- [x] Test TCC permission behavior: grant, persist across restart, behavior after binary replace
- [x] Document results in `docs/SCREENCAPTUREKIT-POC-SPIKE.md` and confirm Phase 1 approach
- **Phase A complete (2026-03-12)** — See: `docs/SCREENCAPTUREKIT-POC-SPIKE.md` for full results + learnings

#### Pre-Phase 1b: SCStream Validation
- [x] Extend POC to use `SCStream` instead of `SCScreenshotManager`
- [x] Validate `minimumFrameInterval` controls delivery rate (5s interval — confirmed exactly 5s)
- [x] Validate `CMSampleBuffer` → `CGImage` conversion
- [x] Confirm stream delivers frames headlessly without Timer
- [x] Document Swift 6 concurrency patterns in `docs/SCREENCAPTUREKIT-POC-SPIKE.md`
- **Phase B complete (2026-03-12)** — SCStream confirmed as Phase 1 capture API. See: `docs/SCREENCAPTUREKIT-POC-SPIKE.md` Phase B section for patterns + gotchas

#### Pre-Phase 1c: pHash Dedup Threshold
- [x] Create `scripts/poc-phash-dedup/` — standalone CLI testing pHash, dHash, VN FeaturePrint, SCFrameStatus
- [x] Run 6 scenarios: IDLE, CLOCK_TICK, CURSOR_BLINK, MOUSE_MOVE, TYPING, WINDOW_SWITCH
- [x] Analyze hamming distances to find clean threshold separating noise from content
- [x] Document results in `docs/SCREENCAPTUREKIT-POC-SPIKE.md`
- **Phase C complete (2026-03-12)** — pHash threshold=8 validated. See: `docs/SCREENCAPTUREKIT-POC-SPIKE.md` Phase C section for full analysis

#### Phase 1: Fotógrafo Capture Agent (~3-4 days)
- [x] Set up `apps/recorder/` Swift package (`Package.swift`, `Sources/{main.swift, StreamCapture.swift, PHash.swift, DB.swift, Backpressure.swift}`)
- [x] Implement ScreenCaptureKit capture loop using `SCStream` — 1s interval, pHash dedup is the true throttle
- [x] Reuse `scripts/poc-phash-dedup/Sources/PHash.swift` — vDSP-accelerated DCT pHash with **threshold=4**
- [x] Write JPEG frames (quality 85) to `~/.escribano/frames/{YYYY-MM-DD}/{timestamp}_{displayId}.jpg`
- [x] Add migration `014_recorder_frames.sql` — `frames` table with `processing_lock_id`, `retry_count`, `failed_at`
- [x] Implement migration bootstrap — check `PRAGMA user_version` on startup, exit if schema stale
- [x] Implement backpressure — `ESCRIBANO_CAPTURE_HIGH_WATER=500`, `ESCRIBANO_CAPTURE_LOW_WATER=100`, check every 10 frames
- [x] Write LaunchAgent plist `com.escribano.capture.plist` with `RunAtLoad=true` + `KeepAlive=true`
- [x] Add `escribano recorder install` CLI command — builds Swift binary (`swift build -c release`), drops plist, registers with launchctl
- [x] Add `escribano recorder status` CLI command — shows agent status, pending frames, disk usage
- [x] Multi-display capture — extend Phase 1 to capture all displays with `display_id`
- **Phase 1 complete (2026-03-13)**

#### Phase 2: Swift VLM Analyzer (~2-3 days) — ADR-010
- [ ] Add `mlx-swift-lm` dependency to `apps/recorder/Package.swift`
- [ ] Create `VLMAnalyzer.swift` — async task that polls frames, claims batch, runs VLM, writes observations
- [ ] Create `ResponseParser.swift` — parse "Frame N: description: X | activity: Y | apps: Z | topics: W" format (ported from `intelligence.mlx.adapter.ts`)
- [ ] Create `ObservationStore.swift` (port) + `SQLiteObservationStore.swift` (adapter) — decoupled DB access
- [ ] Enhance `VLMRunner.swift` from POC — integrate with `ResponseParser`, support pre-loaded model container
- [ ] Update migration `015_observations_frame_fk.sql` — remove `process_locks` table (not needed for in-process VLM)
- [ ] Update `main.swift` — spawn both capture + VLM analyzer tasks concurrently
- [ ] Add VLM model lifecycle — load once at startup, keep in memory, release at shutdown
- [ ] Update config docs: `ESCRIBANO_ANALYZE_BATCH_SIZE`, `ESCRIBANO_VLM_MODEL`
- [ ] **Ref**: `docs/adr/010-swift-native-visual-intelligence.md` + `docs/tdd/001-swift-capture-agent.md` Phase 2

#### Release Prerequisite: Apple Developer ID Signing
- [ ] **Sign `escribano` binary with Apple Developer ID certificate** — stable Team ID signature survives rebuilds for all users
  - Currently uses adhoc signing (CDHash changes on every `swift build` → users lose TCC permission on every rebuild)
  - With Apple Developer ID Application cert, TCC tracks by Team ID (not CDHash) — permission persists across all rebuilds
  - Requires free/paid Apple Developer account + certificate setup (one-time, CLI only)
  - Must be done before open-source release or npm publish
  - **Dev workaround**: Run from Terminal — permission is granted to Terminal.app, persists across builds
  - **Ref**: Option B in `src/actions/recorder-commands.ts`

### Stopgaps (batch pipeline, lower priority now that recorder is the focus)

- [ ] **6K FFmpeg reliability** — Add fallback encoder (libx264/libwebp), dimension check + warning for >4096px — *2-3h*
- [ ] **Auto-detect hardware accel** — videotoolbox/vaapi with `--no-hwaccel` override — *2h*
  - Currently hardcoded at `src/adapters/video.ffmpeg.adapter.ts:108, 262, 401`

### Growth

- [ ] **Demo assets** — 2-min Loom showing the product, not describing it — *1h*
- [ ] **Sample recording** — 5-10 min sample for first-time users — *1h*

---

## Next

### Agent Integration

- [ ] **MCP server** — Expose TopicBlocks via MCP for AI assistants — *8-12h*
  - Natural extension of agent-native thesis
  - Enables assistants to query work history
- [ ] **Cross-recording queries** — "show me all debugging sessions this week" — *4-6h*

### Quality

- [ ] **OCR on keyframes** — Extract code/URLs at artifact generation time — *6-8h*
- [ ] **Compare pages (SEO)** — Competitive positioning content — *4-6h*

### Convenience (Low Priority)

- [ ] **Auto-process watcher** — Watch folder, auto-run on new files — *2-3h*
  - Demoted: recorder makes this less relevant

---

## Cleanup

- [ ] Schema migration: rename `clusters` → `segments`, delete `cluster_merges`
- [ ] Remove V2 code (`clustering.ts`, `signal-extraction.ts`, `cluster-merge.ts`)
- [ ] Remove V1 code (`process-session.ts`, `classify-session.ts`)
- [ ] Split `0_types.ts` into domain/port/config modules

---

## Recently Done

### 2026-03

- **Recorder Dev Mode Working** — Permission granted to Terminal.app persists across builds; `pnpm recorder:dev` workflow validated; pHash dedup correctly skipping identical frames
- **pHash Dedup POC (Phase C)** — Validated pHash threshold=8 cleanly separates noise (0-4 bits) from content (10+ bits) across 6 scenarios; dHash, VN FeaturePrint, SCFrameStatus all rejected as primary dedup
- **SCStream POC (Phase B)** — Validated `SCStream` with Swift 6 concurrency patterns (`@MainActor`, `sampleHandlerQueue: .main`, `MainActor.assumeIsolated`, `nonisolated(unsafe) let`); 5s frame interval confirmed exact; SCStream chosen as Phase 1 capture API
- **ScreenCaptureKit Spike (Phase A)** — ADR-009 architecture decision for always-on screen recorder (Swift ScreenCaptureKit + SQLite WAL)
- **TDDs published** — `docs/tdd/001-swift-capture-agent.md`, `002-node-batch-analyzer.md`, `003-segmentation-cli.md`
- **MLX-LM migration** — Unified VLM + LLM backend, 17 recordings validated, 100% success
- **Production benchmarks** — 25.6 hours processed, ~2.2 min/video average
- **Config file support** — Auto-create `~/.escribano/.env`
- **`--latest <dir>` flag** — Find and process latest video
- **npm package** — Published to npm registry
- **Repo public** — github.com/eduardosanzb/escribano

### Earlier

- **MLX-VLM migration** — 4x speedup, zero external dependencies
- **VLM-first pipeline** — Activity segmentation, multiple artifact formats
- **Model auto-detection** — RAM-based tier selection

---

## Strategic Bets (6+ months)

- **Cloud inference tier** — Hosted option for users without local hardware
- **Team/Enterprise** — Collaboration features, shared work memory
- **Cross-platform** — Linux/Windows support (currently macOS Apple Silicon only)
