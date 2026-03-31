# MVP Final Push — 2-Week Sprint Plan

**Created**: 2026-03-27
**Target**: Ship distributable MVP to technical early adopters
**Deadline**: 2026-04-10

## Product Goal

Close the loop from always-on capture → automatic artifact generation → user-accessible output. Target technical early adopters who are comfortable with CLI installation.

## Prerequisites (Day 1)

- [ ] Merge PR #53 (Phase 3a SessionAggregator)
- [ ] Rebase PR #54 (code quality improvements) on main, resolve conflicts, merge
- [ ] Verify recorder + bridge + aggregator working end-to-end after merges

## Tier 2: Recorder Quality (Post-Prerequisites)

- [ ] **Test coverage for recorder actors** — Unit tests for FrameAnalyzer bridge recovery, SessionAggregator backoff, WorkQueue fairness
- [ ] **`recorder status` improvements** — Show bridge state (ready/dead/restarting), backoff intervals, failure counts
- [ ] **Frame cleanup job** — Delete JPEG files for frames older than 7 days (currently frames accumulate forever)

## Tier 3: Performance Optimization

- [ ] **VLM idle unload** — Unload model from GPU memory after N minutes of inactivity, reload on next frame batch
- [ ] **Adaptive batch sizing** — Increase batch size when queue is deep, decrease when shallow

## Week 1: Core Product Loop

### Phase 3b: Time-Range Artifact Generation (Days 1-3)

The recorder produces observations and TopicBlocks continuously. This phase adds the on-demand CLI to query TopicBlocks by time range and generate artifacts.

- [ ] Make `topic_blocks.recording_id` nullable (migration) — recorder TBs have no recording
- [ ] Add time-range query methods to TopicBlock repository (`findByTimeRange(from, to)`)
- [ ] Add flush-aggregate step in `generate` action: run aggregation SQL on unclaimed observations before querying TBs
- [ ] `npx escribano generate --today --format standup` — generates artifact from today's TopicBlocks
- [ ] `npx escribano generate --from "9am" --to "12pm" --format card` — time-range artifact generation
- [ ] `--copy` flag to copy artifact to clipboard
- [ ] macOS notification on artifact completion (`osascript`)

### Menu Bar App (Days 3-5)

Separate Swift executable target in `Package.swift`. Communicates with recorder via shared SQLite (read-only from menu bar) and `launchctl` for lifecycle.

- [ ] Add `escribano-menu` target to `apps/recorder/Package.swift`
- [ ] Status indicator: green (running) / yellow (backpressure) / red (stopped)
- [ ] Dropdown menu: Start/Stop recorder, "Generate Now" (triggers `escribano generate --today`)
- [ ] Settings window: configure format, time range defaults
- [ ] Summary preview window: show latest artifact
- [ ] `npx escribano recorder install` also installs menu bar app

## Week 2: Distribution + Launch

### Distribution (Days 6-7)

Target: technical early adopters via CLI install, not consumer `.app`/`.dmg`.

- [ ] Create installer script (`curl -fsSL https://escribano.work/install.sh | sh`)
  - Downloads pre-built Swift recorder binary from GitHub Releases
  - Installs Node.js CLI via npm
  - Sets up LaunchAgent
  - Triggers Python venv auto-setup on first run
- [ ] GitHub Actions workflow: build Swift binary on push to `main`, create GitHub Release
- [ ] Test installer on clean macOS (M1 Air, M4 Max)

### Pricing (Days 7-8)

- [ ] Free tier: 3 summaries/week, card format only
- [ ] Pro tier: $29 one-time founders license, all formats, unlimited summaries
- [ ] Team tier: waitlist only (future per-seat/month)
- [ ] License validation: local license file at `~/.escribano/license.key`
- [ ] Stripe checkout for Pro tier
- [ ] Landing page integration

### Landing Page (Days 8-9)

- [ ] Update `apps/landing/` to reflect recorder product (not just batch pipeline)
- [ ] Add download/install section with installer script
- [ ] Add pricing section (Free / Pro / Team waitlist)
- [ ] Demo video or animated GIF showing the product loop
- [ ] Deploy via existing Coolify pipeline

### Launch Prep (Days 9-10)

- [ ] Write launch post (HN, Twitter, Reddit r/macapps)
- [ ] Test full flow on clean machine: install → capture → generate → artifact
- [ ] Create 2-min demo video
- [ ] Ensure `npx escribano doctor` validates all dependencies
- [ ] Tag v1.0.0-beta release

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| PR #54 rebase conflicts are extensive | Day 1 delay | Timebox rebase to 2h, skip if too complex |
| Phase 3b takes longer than 3 days | Delays menu bar | Ship `generate` CLI first, menu bar can follow |
| Menu bar app Swift complexity | Blocks Week 1 | Minimal UI (dropdown menu only), defer settings/preview windows |
| Apple Developer ID cert not purchased ($99/yr) | TCC permission lost on rebuild | Dev workaround: users run from Terminal.app (permission persists) |
| Stripe integration complexity | Blocks pricing | Ship with manual license generation first, automate later |

## Success Criteria

1. A new user can install Escribano from a single `curl` command
2. The recorder starts capturing on first launch
3. Running `escribano generate --today` produces a useful standup summary
4. The menu bar shows recorder status and can trigger generation
5. Free/Pro tiers enforce usage limits
6. Landing page has download link and pricing
