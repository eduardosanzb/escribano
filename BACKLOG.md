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

#### Phase 2: Python Bridge VLM (started 2026-03-16)
- ✅ Removed the abandoned `mlx-swift-lm` dependency; recorder now talks to a Python bridge over a Unix socket
- ✅ Added `VLMInferenceService.port.swift` + `PythonBridge.vlm.adapter.swift` so `FrameAnalyzer` can call any backend via the port interface
- ✅ Created `Prompts.swift` + `ResponseParser.swift` for NDJSON responses, and added `ObservationStore` port + SQLite adapter (FrameStore/SQLiteFrameStore already exist in `apps/recorder/Sources/`)
- ✅ Renamed `VLMAnalyzer.swift` to `FrameAnalyzer.swift`, wired it through `main.swift`, and added the recorder settings in `apps/recorder/Package.swift`
- ✅ Deployed schema migration `015_observations_frame_fk.sql` (frames → observations FK) and backpressure fixes in `StreamCapture.swift`/`Backpressure.swift`
- ✅ Python bridge uses `ESCRIBANO_BRIDGE_PATH`/`ESCRIBANO_PYTHON_PATH` overrides for dev flows
- ✅ 1,043 recorder frames with `frame_id` links (Mar 13‑16) power live summaries now; new `pnpm recorder:monitor` script watches recorder + bridge CPU/memory usage
- **Phase 2 complete (2026-03-19)**
- **Ref**: `docs/adr/010-swift-native-visual-intelligence.md` (see Addendum for Python bridge pivot)

#### Phase 3: Continuous Session Aggregation — ADR-011

##### POC: VLM-as-LLM (small machine validation)
- [x] Send text-only prompt to `mlx_bridge.py --mode vlm` (no images) using same artifact-generation prompt
- [x] Compare output quality vs `Qwen3-4B-Instruct` (current minimum LLM tier from `model-detector.ts`)
- [x] If pass → add `vlm-as-llm` fallback tier in `model-detector.ts` for machines with ≤ 16GB RAM (including M1 Air 16GB)
- [x] **Goal**: Eliminate separate LLM model load on M1 Air 16GB — one model for everything

**POC complete (2026-03-19)** — The bridge/Swift architecture is validated. The recorder can reuse the same long-lived Python socket for frame analysis and text generation; the remaining implementation detail is to route `text_infer` to the loaded model's text backbone instead of the VLM image path.

##### Phase 3a: SessionAggregator (Swift actor in recorder) ✅ complete
- [x] Schema migration `017_session_aggregation.sql` — add `tb_id` to observations, `from_ts`/`to_ts`/`observation_count` to topic_blocks
- [x] `TopicBlockStore.port.swift` + `TopicBlockStore.sqlite.adapter.swift` — write topic_blocks, query by time range
- [x] `SessionAggregator.swift` — actor with LLM-based semantic grouping via shared VLM bridge, polls every `ESCRIBANO_TB_POLL_INTERVAL` (default 120s)
- [x] Wire `SessionAggregator` into `main.swift` as third async task alongside StreamCapture + FrameAnalyzer, shared `WorkQueue` serializes bridge access
- [x] `ESCRIBANO_TB_MIN_OBSERVATIONS` (default 3), `ESCRIBANO_TB_MAX_OBS_PER_CYCLE` (default 300), `ESCRIBANO_TB_LLM_BATCH_SIZE` (default 50)
- [x] Backfill on startup: process all historical unclaimed observations via `WHERE tb_id IS NULL`
- [x] Hot loop fix: removed `splitByGap()` gap-windowing (redundant with LLM prompt), simplified aggregateLoop to process all unclaimed obs as one batch, explicit sleep when no TBs created
- [x] Protocol split: `FrameStore` owns frame lifecycle, `ObservationStore` owns observation lifecycle; dedicated `analyzerFrameStore` connection for thread safety
- [x] `apps/recorder/README.md` created — architecture, dataflow, config reference
- **Phase 3a complete (2026-03-27)** — See PR #53. Design amended: LLM semantic grouping replaces pure gap-aware windowing. See ADR-011 Addendum.

##### Recorder Hardening (Bridge Crash Recovery + Backoff)
- [x] `BridgeState` enum with `.idle/.starting/.ready/.dead/.restarting` — replaces boolean `isStarted`
- [x] `Process.terminationHandler` for proactive bridge death detection
- [x] `restart()` with exponential backoff (5s→10s→20s→40s→60s, max 5 attempts), idempotent (concurrent callers coalesce)
- [x] `releaseFrames(ids:)` on FrameStore — returns frames to pool without wasting retry budget on bridge crashes
- [x] FrameAnalyzer: distinguishes `bridgeDied` from other errors, releases frames + restarts bridge, stops loop after 5 consecutive failures
- [x] SessionAggregator: re-enters bridge readiness wait loop on `bridgeDied`, stops after 5 consecutive failures
- [x] Exponential backoff on empty polling (FrameAnalyzer: 10→120s cap, SessionAggregator: 120→480s cap)
- [x] Sleep/wake hooks via `NSWorkspace` notifications — pause capture on sleep, resume + reset backoff on wake (daemon mode only)
- [x] StreamCapture: `DateFormatter` and `ISO8601DateFormatter` moved to stored properties (avoid per-frame allocation)
- **Recorder hardening complete (2026-03-30)**

##### Phase 3b: Time-Range Artifact Generation (Node.js, on-demand)
- [ ] Update `generate-summary-v3.ts` — accept `from_ts`/`to_ts` instead of (or in addition to) `recording_id`
- [ ] Add flush-aggregate step: run aggregation SQL on unclaimed observations before querying TBs
- [ ] `npx escribano generate --today --format standup`
- [ ] `npx escribano generate --from "9am" --to "12pm" --format card`
- [ ] Artifact caching by `(from_ts, to_ts, format)` unique key; `--force` to regenerate
- [ ] macOS notification on artifact completion (osascript)
- [ ] **Ref**: `docs/adr/011-continuous-session-aggregation.md`

#### Phase 4: Distribution Pipeline (ADR-012)
- [ ] Package the recorder as `Escribano.app` and ship a `.dmg`
- [ ] Embed a standalone Python environment in the app bundle
- [ ] Implement async model download and resume with recorder backpressure
- [ ] Add Makefile + GitHub Actions build/sign/notarize pipeline
- [ ] Sign inner binaries, app bundle, and release DMG
- [ ] **Ref**: `docs/adr/012-distribution-pipeline.md`

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

### Phase 3c: MCP Server (deferred, unblocked by 3b)
- [ ] `apps/mcp/` — new package using `@modelcontextprotocol/sdk`, stdio transport
- [ ] Tool: `get_current_context()` — last N TBs (pure DB read, <100ms, no LLM)
- [ ] Tool: `get_work_summary(from, to, format)` — lazy generate if no artifact exists
- [ ] Tool: `search_sessions(query, days)` — full-text search over vlm_descriptions
- [ ] Resource: `sessions://today`, `artifacts://latest`

### Phase 3d: Human Surfaces (deferred, unblocked by 3b)
- [ ] **Raycast extension** — reads `~/.escribano/artifacts/`, shows today's card, copy standup — *1-2 days*
- [ ] **Swift menu bar app** — recorder start/stop, live status, "generate now" button — *2-3 days*

### Quality

- [ ] **OCR on keyframes** — Extract code/URLs at artifact generation time — *6-8h*
- [ ] **Cross-recording queries** — "show me all debugging sessions this week" — likely covered by time-range queries over TBs; revisit if semantic search needed — *4-6h*
- [ ] **Compare pages (SEO)** — Competitive positioning content — *4-6h*

---

## Cleanup

- [ ] Schema migration: rename `clusters` → `segments`, delete `cluster_merges`
- [ ] Remove V2 code (`clustering.ts`, `signal-extraction.ts`, `cluster-merge.ts`)
- [ ] Remove V1 code (`process-session.ts`, `classify-session.ts`)
- [ ] Split `0_types.ts` into domain/port/config modules

---

## Recently Done

### 2026-03

- **Recorder hardening complete (2026-03-30)** — Bridge crash recovery with BridgeState machine + exponential backoff restart, frame release on bridge death, exponential backoff polling, sleep/wake hooks, DateFormatter optimization
- **Phase 3a complete (2026-03-27)** — SessionAggregator with LLM-based semantic grouping, WorkQueue priority serialization, protocol split (FrameStore/ObservationStore), migration 017. PR #53.
- **VLM-as-LLM POC complete** — Validated single-model approach for frame analysis + text generation via shared Python bridge socket
- **PR #55 merged** — Fixed deprecated `launchctl load/unload` → modern `bootstrap/bootout`, monitor false positives
- **Phase 2 complete** — Python bridge NDJSON parser, prompts, and observation storage are in place; recorder frame analysis is wired through the port/adapters
- **Recorder Dev Mode Working** — Permission granted to Terminal.app persists across builds; `pnpm recorder:dev` workflow validated; pHash dedup correctly skipping identical frames
- **pHash Dedup POC (Phase C)** — Validated pHash threshold=8 cleanly separates noise (0-4 bits) from content (10+ bits) across 6 scenarios; dHash, VN FeaturePrint, SCFrameStatus all rejected as primary dedup
- **SCStream POC (Phase B)** — Validated `SCStream` with Swift 6 concurrency patterns (`@MainActor`, `sampleHandlerQueue: .main`, `MainActor.assumeIsolated`, `nonisolated(unsafe) let`); 5s frame interval confirmed exact; SCStream chosen as Phase 1 capture API
- **ScreenCaptureKit Spike (Phase A)** — ADR-009 architecture decision for always-on screen recorder (Swift ScreenCaptureKit + SQLite WAL)
- **TDDs published** — `docs/adr/009/tdd-001-swift-capture-agent.md`, `docs/adr/010/tdd-002-node-batch-analyzer.md`, `docs/adr/011/tdd-003-segmentation-cli.md`
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

- **Multimodal convergence** — Single Qwen3-VL model for both frame analysis AND artifact generation text. Eliminates the VLM+LLM two-model split. On M1 Air 16GB: one model (~4-5GB) stays loaded, does everything. VLM-as-LLM POC validated the shared-bridge approach; Phase 3a now only needs the recorder wiring.
- **Cloud inference tier** — Hosted option for users without local hardware
- **Team/Enterprise** — Collaboration features, shared work memory
- **Cross-platform** — Linux/Windows support (currently macOS Apple Silicon only)
