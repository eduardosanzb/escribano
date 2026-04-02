# BACKLOG.md — Escribano (TS Pipeline)

> **Full product backlog** (recorder, MVP sprint, distribution) is maintained in the private [escribano-app](https://github.com/eduardosanzb/escribano-app) repo.

---

## Now

- [ ] **6K FFmpeg reliability** — Add fallback encoder (libx264/libwebp), dimension check + warning for >4096px — *2-3h*
- [ ] **Auto-detect hardware accel** — videotoolbox/vaapi with `--no-hwaccel` override — *2h*
  - Currently hardcoded at `src/adapters/video.ffmpeg.adapter.ts:108, 262, 401`

## Next

- [ ] **OCR on keyframes** — Extract code/URLs at artifact generation time — *6-8h*
- [ ] **Cross-recording queries** — "show me all debugging sessions this week" — *4-6h*
- [ ] **`npx escribano generate --today`** — Time-range artifact generation from always-on recorder data (Phase 3b)

## Cleanup

- [ ] Schema migration: rename `clusters` → `segments`, delete `cluster_merges`
- [ ] Remove V2 code (`clustering.ts`, `signal-extraction.ts`, `cluster-merge.ts`)
- [ ] Remove V1 code (`process-session.ts`, `classify-session.ts`)
- [ ] Split `0_types.ts` into domain/port/config modules

## Recently Done

- **Repo split** — Swift recorder moved to private `escribano-app`; this repo is now TS pipeline only
- **MLX-LM migration** — Unified VLM + LLM backend, 17 recordings validated
- **Production benchmarks** — 25.6 hours processed, ~2.2 min/video average
- **npm package published** — npmjs.com/package/escribano
