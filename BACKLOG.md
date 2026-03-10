# BACKLOG.md - Escribano

## Product Thesis: Agent-Native Work Memory

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

See: `docs/screen_capture_pipeline.md` for technical design.

---

## Now

### Product

- [ ] **Recorder spike** — Prototype own capture pipeline (Rust + scap) — *8-12h*
  - Validate multi-monitor capture
  - Test frame deduplication (pHash)
  - Compare quality/reliability vs FFmpeg pipeline
- [ ] **6K FFmpeg reliability** — Investigate MJPEG encoder failures — *2-3h*
  - Add fallback encoder (libx264/libwebp)
  - Add dimension check + warning for >4096px
  - Stopgap until recorder is ready
- [ ] **Auto-detect hardware accel** — videotoolbox/vaapi/d3d11va with manual override — *2h*
  - Currently hardcoded at `src/adapters/video.ffmpeg.adapter.ts:108, 262, 401`
  - Add `--no-hwaccel` flag for troubleshooting
- [ ] **Demo assets** — 2-min Loom showing the product, not describing it — *1h*

### Growth

- [ ] **Sample recording** — 5-10 min sample for first-time users — *1h*
  - Add to repo or host separately
  - Document in README

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
