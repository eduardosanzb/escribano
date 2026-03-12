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

#### Pre-Phase 1: ScreenCaptureKit Feasibility Spike (~half day)
- [ ] Create `scripts/poc-screencapturekit/main.swift` — standalone CLI, no pipeline integration
- [ ] Validate `SCScreenshotManager.captureImage` works headlessly (macOS 14+)
- [ ] Validate all displays enumerated + captured from CLI binary
- [ ] Test TCC permission behavior: grant, persist across restart, behavior after binary replace
- [ ] Document results in `docs/SCREENCAPTUREKIT-POC-SPIKE.md` and confirm Phase 1 approach
- See: `docs/SCREENCAPTUREKIT-POC-SPIKE.md` for full scope + validation checklist

#### Phase 1: Swift Capture Daemon (~3-4 days)
- [ ] Set up `apps/recorder/` Swift package (Package.swift, Xcode project, basic structure)
- [ ] Implement ScreenCaptureKit capture loop — single display, configurable interval
- [ ] Implement pHash deduplication — skip frame if visually identical to previous
- [ ] Write JPEG frames to `~/.escribano/frames/{date}/`
- [ ] Write frame rows to SQLite `frames` table (new migration)
- [ ] Write launchd plist `com.escribano.capture.plist` (KeepAlive, StartOnLoad)
- [ ] Add `escribano daemon install` CLI command — drops plist, registers with launchd
- [ ] Add `escribano daemon status` CLI command — shows capture running/stopped + frame count

#### Phase 2: Node Batch Analyzer (~2-3 days)
- [ ] Add `frames` table + `frame_id` column on `observations` to `src/db/migrate.ts`
- [ ] Add `frames` repository to `src/db/repositories/`
- [ ] Implement `escribano analyze` CLI command — checks unanalyzed frame count against threshold; if met, runs VLM batch and writes observations with `frame_id`; exits
- [ ] Reuse `vlm-service.ts` unchanged for VLM batch
- [ ] Mark frames `analyzed=1` after VLM completes
- [ ] Write launchd plist `com.escribano.analyze.plist` (StartInterval=120) — installed alongside capture plist via `daemon install`
- [ ] Add `ESCRIBANO_ANALYZE_THRESHOLD` config (default: 20 frames)

#### Phase 3: Segmentation + CLI (~2-3 days)
- [ ] Add `segments` table migration to `src/db/migrate.ts`
- [ ] Add `segments` repository (replaces in-memory segments + topic_blocks for recorder path)
- [ ] Add `capture.recorder.adapter.ts` — new `CaptureSource` adapter for recorder frames
- [ ] Update `activity-segmentation.ts` to persist segments to DB when invoked from recorder path
- [ ] Implement `escribano cut` CLI command — runs segmentation on a time range, suggests breaks, generates artifact
- [ ] Track `consumed=1` on segments after artifact generation

#### Phase 4: Polish (~2-3 days)
- [ ] Multi-display capture — extend Phase 1 to capture all displays with `display_id`
- [ ] Frame cleanup — delete JPEGs after analysis; add `ESCRIBANO_FRAME_RETENTION_DAYS` config (default: 1)
- [ ] Swift menu bar status item — show capture on/off, frame count, last analysis time
- [ ] `escribano daemon uninstall` — removes launchd plists, stops daemons

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

- **ADR-009** — Architecture decision for always-on screen recorder (Swift ScreenCaptureKit + SQLite WAL)
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
