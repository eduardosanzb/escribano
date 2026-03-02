# BACKLOG.md - Escribano

Task tracking for Escribano development.

---

## P0 — Critical Path

### Existential: Validate the product works

- [ ] **Validate artifact quality** — Process 5 real sessions, identify bottleneck layer — *2-3h, do this NOW*
  - Test with QuickTime recordings (primary workflow)
  - Rate VLM descriptions, segmentation, summary quality
- [ ] **Test `npx escribano` from clean environment** — Verify published package installs and runs — *30min*
- [ ] **Test on MacBook Air 16GB** — Validate minimum tier (qwen3:8b) produces usable output — *1-2h*

### Quick UX Win

- [ ] **Auto-process watcher** — Watch recordings folder, auto-run Escribano on new files — *2-3h*
  - Removes manual `pnpm escribano` step
  - Works with Cap or QuickTime recordings
- [ ] **Sample recording for first-time users** — Include a 5-10 min sample so people can try without recording — *1h*
  - Add to repo or host separately
  - Document in README

---

## P1 — Launch Blockers

**Must have for public launch**

- [ ] **Make repo public** — Unlocks all distribution channels — *15min*
  - Blocked on: validate npx flow works
- [ ] **2-min Loom demo** — Shows the product, not describes it — *1h*
- [x] **README with before/after** — First impression for every GitHub visitor
- [x] **Landing page** — `apps/landing/` Hugo site for escribano.work
- [x] **npm package published** — `escribano@0.1.0` live
- [x] **ADR-005 blog post** — "Why OCR-based screen intelligence fails" — exists at `apps/landing/content/blog/vlm-first-pipeline.md`

---

## P2 — Next Iteration

**When bandwidth drops to 10-15 hrs/week**

- [ ] **MLX-LM adapter spike** — Evaluate migrating LLM from Ollama to MLX-LM — *4-6h*
  - Extend `mlx_bridge.py` with `generate_text` method
  - Create `intelligence.mlx-lm.adapter.ts`
  - Benchmark against Ollama with real prompts (subject grouping, artifact generation)
  - Compare: speed, memory, model availability (qwen3.5:27b MLX port?), feature parity (thinking mode, JSON format)
  - Decision criteria: >20% speedup + feature parity → migrate; else keep Ollama
  - Risk: loses Ollama model auto-detection, thinking mode, JSON enforcement
- [ ] **Auto-detect ffmpeg hardware accelerator** — videotoolbox/vaapi/d3d11va with `--no-hwaccel` override — currently hardcoded (video.ffmpeg.adapter.ts:105, 259, 393) — *2h*
- [ ] **Real-time capture pipeline** — Rust-based always-on capture — *20+ h*
  - Removes Cap/QuickTime dependency
  - Enables automatic session recording (no forgetting to start)
- [ ] **MCP server** — Expose TopicBlocks via MCP for AI assistant integration — *8-12h*
- [ ] **Cross-recording Context queries** — "show me all debugging sessions this week" — *4-6h*
- [ ] **Compare pages (SEO)** — competitive comparison pages — *4-6h*
- [ ] **OCR on keyframes** — at artifact generation time — *6-8h*

---

## P3 — Cleanup (Post-Launch)

**Technical debt when product is validated**

- [ ] Schema migration: rename `clusters` → `segments`, delete `cluster_merges`
- [ ] Remove deprecated V2 code (`clustering.ts`, `signal-extraction.ts`, `cluster-merge.ts`, etc.)
- [ ] Remove deprecated V1 code (`process-session.ts`, `classify-session.ts`, etc.)
- [ ] Split `0_types.ts` into domain/port/config modules

---

## Completed

### 2026-03-01

- [x] **npm package published** — `escribano@0.1.0` with shebang fix
- [x] **Model auto-detection** — RAM-based tier selection (16GB→qwen3:8b, 32GB→qwen3:14b, 64GB+→qwen3.5:27b)
- [x] **Shebang fix** — Postbuild script ensures `npx escribano` works
- [x] **README overhaul** — Platform callout, hardware tiers, npx examples
- [x] **Model references fixed** — All `qwen3:32b` → `qwen3.5:27b`

### Earlier

- [x] **MLX-VLM Migration** — ADR-006 complete. 3.5x speedup achieved.
  - Token budget: 4000 per batch (16 frames)
  - Adapter: `intelligence.mlx.adapter.ts` + `scripts/mlx_bridge.py`
  - VLM/LLM separation: MLX for images, Ollama for text

---

## Deferred (6+ months)

- [ ] Cloud inference tier — hosted option for users without local hardware
- [ ] Team/Enterprise features
- [ ] Linux/Windows support — currently macOS Apple Silicon only
