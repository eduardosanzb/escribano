# MVP Final Push — 2-Week Sprint Plan

**Created**: 2026-03-27
**Updated**: 2026-03-31
**Target**: Ship distributable `.app` + DMG to technical early adopters
**Deadline**: 2026-04-10

## Product Goal

Close the loop from always-on capture → automatic artifact generation → user-accessible output. Ship as a self-contained macOS `.app` in a DMG — no LaunchAgent, no `curl | sh`, no separate menu bar binary.

## Architecture Decisions (from design session 2026-03-30)

- **Single binary**: NSStatusItem added directly to existing `EscribanoRecorderDelegate` — one process does capture + analysis + menu bar
- **No LaunchAgent**: The `.app` manages its own lifecycle. `SMAppService.mainApp` for "Start at Login"
- **Split**: Swift `.app` = capture + analysis + menu bar (always running). Node.js CLI = report generation (on-demand). Shared state = SQLite WAL at `~/.escribano/escribano.db`
- **Python stays for MVP**: Require Python 3 installed. Auto-create `~/.escribano/venv`, auto-install `mlx-vlm` on first launch with progress indicator. `python-build-standalone` embedding deferred to Phase 4
- **Stats from DB**: Menu bar queries SQLite directly on a 5s timer — no actor state exposure needed
- **Ad-hoc signing**: Developer ID deferred. Users right-click → Open for Gatekeeper. TCC tracks .app bundle path

## Completed Prerequisites

- [x] Merge PR #53 (Phase 3a SessionAggregator)
- [x] Merge PR #54 (code quality improvements)
- [x] Recorder hardening (bridge crash recovery, exponential backoff, sleep/wake hooks) — PR in review
- [x] Full architectural design for menu bar app (edge cases, bootstrap, permission handling)
- [x] Research: LM Studio uses `venvstacks` + `python-build-standalone` for Python bundling (informing Phase 4)

---

## Day 1 (2026-03-31): Swift Menu Bar App + DMG

### Menu Bar App — Single Binary

Add NSStatusItem to existing recorder binary. One process, one target.

- [ ] NSStatusItem in `EscribanoRecorderDelegate` with status indicator (green=running, yellow=paused/backpressure, red=error)
- [ ] Menu layout:
  ```
  [●] Escribano
  ─────────────────────────────
  Recording — {N} displays
  Frames: {captured} captured · {pending} pending
  Topic Blocks: {count} today
  RAM: {total} MB (recorder {r} + bridge {b})
  CPU: {cpu}%
  ─────────────────────────────
  ⏸  Pause Recording          ← toggles to ▶ Resume
  ─────────────────────────────
  ☑  Start at Login
     Quit Escribano
  ```
- [ ] Stats from DB: 5s timer querying `pendingFrameCount()`, total frames, `tbStore.count()`
- [ ] Resource monitoring: `mach_task_basic_info` for self RSS, `proc_pidinfo` for Python bridge via `storedPID`
- [ ] Pause/Resume: toggle `StreamCapture.pause()`/`resume()` from menu action
- [ ] `SMAppService.mainApp` for Start at Login checkbox
- [ ] Duplicate instance prevention via `NSRunningApplication` bundle identifier check

### Bootstrap & Permissions

- [ ] Port DB migration runner to Swift — bundle 17 SQL files as `.app` Resources, execute with `sqlite3_exec`
- [ ] Python venv auto-setup from Swift — shell out to `python3 -m venv ~/.escribano/venv` + `pip install mlx-vlm` on first launch, show progress in menu bar
- [ ] Bundle `mlx_bridge.py` in `.app` Resources
- [ ] Screen Recording permission: if `CGPreflightScreenCaptureAccess()` fails, stay alive, show "Grant Screen Recording" in menu, poll on timer
- [ ] LaunchAgent migration: on first launch, detect old `~/Library/LaunchAgents/com.escribano.capture.plist`, bootout + delete
- [ ] Create `~/.escribano/` directory structure on first launch if missing

### Capture Quality Guards

- [x] Screen lock detection — `DistributedNotificationCenter` listens for `com.apple.screenIsLocked`/`screenIsUnlocked`, pauses all captures on lock, resumes on unlock
- [x] Frame churn rate limiter — rolling 60s window tracks frame-to-frame pHash changes; when unique frames/min exceeds `ESCRIBANO_CHURN_THRESHOLD` (default 40), throttles capture to 1 frame per `ESCRIBANO_CHURN_THROTTLE_INTERVAL` (default 30s); auto-resumes when rate normalizes
- [ ] (Future) Observation-based smart throttle — use VLM activity detection (e.g., consecutive "YouTube" observations) to confirm/override churn-based throttle

### DMG Packaging

- [ ] `.app` bundle structure: `Info.plist`, `entitlements.plist`, bundled Resources (SQL migrations, `mlx_bridge.py`)
- [ ] Build script: `swift build -c release` → assemble `.app` bundle → ad-hoc `codesign`
- [ ] DMG creation via `hdiutil` (or `create-dmg` if simpler)
- [ ] Test: download DMG → drag to Applications → right-click Open → captures frames → menu bar shows stats

---

## Days 2-5: Phase 3b — Time-Range Artifact Generation

The recorder produces observations and TopicBlocks continuously. This phase adds the on-demand Node.js CLI to query by time range and generate artifacts.

- [ ] Make `topic_blocks.recording_id` nullable (migration 018) — recorder TBs have no recording_id
- [ ] Add time-range query methods to TopicBlock repository (`findByTimeRange(from, to)`)
- [ ] Add flush-aggregate step: run aggregation SQL on unclaimed observations before querying TBs
- [ ] `npx escribano generate --today --format standup` — generates artifact from today's TopicBlocks
- [ ] `npx escribano generate --from "9am" --to "12pm" --format card` — time-range artifact
- [ ] `--copy` flag to copy artifact to clipboard
- [ ] macOS notification on artifact completion (`osascript`)

---

## Days 6-8: Distribution + Launch Prep

### Distribution

- [ ] GitHub Actions workflow: build `.app`, create DMG, attach to GitHub Release on tag push
- [ ] Test DMG install on clean macOS (M1 Air 16GB, M4 Max 128GB)
- [ ] Update `escribano doctor` to validate: Python 3 present, screen recording permission, disk space

### Landing Page

- [ ] Update `apps/landing/` to reflect `.app` product (not batch pipeline / CLI installer)
- [ ] Add download section linking to GitHub Releases DMG
- [ ] Demo video or animated GIF showing: install → capture → generate → artifact
- [ ] Deploy via existing Coolify pipeline

### Launch

- [ ] Write launch post (HN, Twitter, Reddit r/macapps)
- [ ] Test full flow on clean machine: DMG install → first launch bootstrap → capture → generate → artifact
- [ ] Create 2-min demo video
- [ ] Tag v1.0.0-beta release

---

## Deferred to Post-MVP

- **Apple Developer ID signing** — requires $99/yr developer account; ad-hoc signing sufficient for beta
- **Embedded Python (`python-build-standalone`)** — MVP requires user has Python 3; Phase 4 bundles it
- **Pricing / Stripe / license validation** — ship free first, monetize after validation
- **Settings window in menu bar** — configure via `~/.escribano/.env` for now
- **Summary preview window** — `generate --stdout` or `--copy` sufficient for MVP
- **`escribano recorder install/status/restart` CLI commands** — deprecated, replaced by `.app` lifecycle
- **Display hotplug detection** — "Quit + relaunch" covers it for MVP

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Swift menu bar + capture in single process is complex | Day 1 overrun | Existing delegate is already `@MainActor` + `NSApplication.shared.run()` — NSStatusItem is additive |
| Python venv setup fails on user machine | First launch broken | Show clear error in menu bar with "Python 3 required" message; link to install instructions |
| Screen Recording permission UX is confusing | Users give up | Menu bar shows persistent warning + instructions until permission granted |
| Phase 3b takes longer than 4 days | Delays launch | Ship .app with menu bar first (capture works), add `generate` CLI as fast-follow |
| Unsigned app scares users | Lower adoption | Document right-click → Open in README + landing page; Developer ID is post-MVP |

## Success Criteria

1. A user downloads a DMG, drags to Applications, and the recorder starts capturing on first launch
2. Menu bar shows live stats (frames captured, pending, topic blocks)
3. Running `npx escribano generate --today` produces a useful standup summary from recorder data
4. First launch auto-creates Python venv and installs `mlx-vlm` without user intervention
5. The app self-heals: bridge crash recovery, backpressure, sleep/wake (from hardening PR)
