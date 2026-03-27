# Implementation Plan: Documentation Update — ADR Status Sync + MVP Sprint Plan

**Date**: 2026-03-27
**Status**: COMPLETED

## Overview

Update all ADR and TDD documents to reflect the actual state of the project after Phase 3a implementation (PR #53), add a "Deferred for MVP" note to ADR-012, mark Phase 3a complete in the BACKLOG, and create the `MVP-FINAL-PUSH.md` 2-week sprint plan document.

## Scope

- Work units: 6
- Execution phases: 3
- Files affected:
  - `docs/adr/010-swift-native-visual-intelligence.md`
  - `docs/adr/011-continuous-session-aggregation.md`
  - `docs/adr/012-distribution-pipeline.md`
  - `docs/adr/011/tdd-003-segmentation-cli.md`
  - `BACKLOG.md`
  - `MVP-FINAL-PUSH.md`

## Work Units

### WU-1: Update ADR-010 status to Accepted

**Dependencies**: none

**Context**: ADR-010 proposed moving VLM inference into Swift natively via `mlx-swift-lm`. During implementation, a 15× performance regression was discovered in `mlx-swift-lm` for Qwen3-VL models, so the project pivoted to a Swift→Python bridge approach. The ADR's status table currently shows `Superseded (partial)` from 2026-03-16, but Phase 2 is fully complete and the Python bridge pivot is the accepted, shipping architecture. The status should reflect that this ADR is **Accepted** with the Python bridge addendum as the canonical implementation.

**Files**:
- `docs/adr/010-swift-native-visual-intelligence.md` — modify

**Steps**:
1. In the Status table at the top of the file (lines 5-8), add a new row after the existing two rows. The new row should read:
   ```
   | Accepted           | 2026-03-19 | Phase 2 complete. Python bridge pivot (see Addendum) is the shipping architecture. Swift port/adapter pattern retained. |
   ```
2. The existing two rows (Proposed and Superseded) must remain unchanged — they are historical entries.

**Verification**: `grep -c "Accepted" docs/adr/010-swift-native-visual-intelligence.md | grep -q "1"`

**Rollback**:
- Modified files: `git checkout -- docs/adr/010-swift-native-visual-intelligence.md`

---

### WU-2: Update ADR-011 status and Layer 2 description

**Dependencies**: none

**Context**: ADR-011 defines the three-layer continuous session aggregation architecture. Its current status is "Proposed" from 2026-03-17. PR #53 implements Phase 3a (the SessionAggregator) but with a significant design change from what the ADR describes: Layer 2 was designed as "NO LLM, pure aggregation" using gap-aware windowing and statistical mode of activity types. The actual implementation in PR #53 uses **LLM-based semantic grouping** via the Python bridge's `text_infer` method — the LLM reads observation descriptions and produces labeled TopicBlocks with semantic understanding. Gap windowing (`splitByGap()`) was removed as redundant. The status should be updated to "Accepted (amended)" and a new section should document the Layer 2 implementation reality.

**Files**:
- `docs/adr/011-continuous-session-aggregation.md` — modify

**Steps**:
1. In the Status table at the top of the file (lines 5-7), add a new row after the existing row. The new row should read:
   ```
   | Accepted (amended) | 2026-03-27 | Phase 3a implemented in PR #53. Layer 2 changed: LLM-based semantic grouping replaces pure gap-aware windowing. See Addendum. |
   ```

2. At the very end of the file (after line 421, the last line which reads `- `apps/recorder/Sources/FrameAnalyzer.swift` — Actor pattern to follow for SessionAggregator`), append the following addendum section:

   ```markdown

   ## Addendum: Layer 2 Implementation Reality (2026-03-27)

   ### What Changed

   The original ADR specified Layer 2 (SessionAggregator) as **"Pure aggregation — NO LLM, NO model loading"** with gap-aware windowing using `SESSION_GAP_THRESHOLD` (20 min default). The actual implementation (PR #53) replaced this with **LLM-based semantic grouping**:

   | ADR-011 Design | Actual Implementation (PR #53) |
   |---|---|
   | Gap-aware windowing splits by time gaps | LLM reads observation descriptions, groups semantically |
   | `SESSION_GAP_THRESHOLD` (20 min) for splits | Gap windowing removed (`splitByGap()` deleted as redundant) |
   | Activity = statistical mode of observations | Activity = LLM-assigned label from semantic analysis |
   | No model loading, <1ms per TB | Uses `text_infer` via Python bridge (reuses loaded VLM) |
   | Pure aggregation from VLM outputs | Semantic understanding of observation descriptions |

   ### Why the Change

   Pure gap-aware windowing produced correct time boundaries but poor semantic labels. The VLM descriptions alone (activity type as statistical mode) couldn't distinguish meaningful work sessions — e.g., "coding in VS Code" appearing across multiple unrelated tasks would merge into one block. LLM grouping reads the actual descriptions and produces contextually meaningful TopicBlock labels like "API authentication implementation" vs "CI pipeline debugging."

   ### Architecture Impact

   - **WorkQueue actor** serializes bridge access: `FrameAnalyzer` submits at `.realtime` priority, `SessionAggregator` at `.normal`. Configurable via `ESCRIBANO_QUEUE_REALTIME_STREAK` (default 10).
   - **Sub-batching**: Large observation sets are split into batches of `ESCRIBANO_TB_LLM_BATCH_SIZE` (default 100) per LLM call.
   - **Fallback**: On LLM parse failure, creates a single catch-all TopicBlock for the batch.
   - **`ESCRIBANO_SESSION_GAP_THRESHOLD` deprecated** — no longer used. Grouping is purely semantic.

   ### New Environment Variables (from PR #53)

   | Variable | Default | Description |
   |---|---|---|
   | `ESCRIBANO_TB_POLL_INTERVAL` | `120` | Seconds between aggregation polls |
   | `ESCRIBANO_TB_MIN_OBSERVATIONS` | `3` | Min observations to trigger aggregation (was 5 in ADR) |
   | `ESCRIBANO_TB_MAX_OBS_PER_CYCLE` | `300` | Max observations processed per cycle |
   | `ESCRIBANO_TB_LLM_BATCH_SIZE` | `100` | Observations per LLM sub-batch |
   | `ESCRIBANO_QUEUE_REALTIME_STREAK` | `10` | Max consecutive realtime tasks before yielding to normal priority |
   ```

3. In the existing body, locate the paragraph at line 79 that reads:
   ```
   │  │  • Pure aggregation — NO LLM, NO model loading               │            │
   ```
   Do NOT modify the diagram — it represents the original design. The addendum documents the divergence.

**Verification**: `grep -c "Addendum: Layer 2 Implementation Reality" docs/adr/011-continuous-session-aggregation.md | grep -q "1"`

**Rollback**:
- Modified files: `git checkout -- docs/adr/011-continuous-session-aggregation.md`

---

### WU-3: Add "Deferred for MVP" note to ADR-012

**Dependencies**: none

**Context**: ADR-012 describes packaging Escribano as a consumer `.app` with embedded Python, distributed via `.dmg`. This is Phase 4 in the backlog. The current MVP strategy (from conversation context) is to target technical early adopters via CLI install (installer script + GitHub Releases), not full `.app`/`.dmg` packaging. ADR-012 should be updated to reflect this deferral — it's still the long-term plan but not the MVP path.

**Files**:
- `docs/adr/012-distribution-pipeline.md` — modify

**Steps**:
1. In the Status table at the top of the file (lines 5-7), add a new row after the existing row. The new row should read:
   ```
   | Deferred     | 2026-03-27 | Full `.app`/`.dmg` packaging deferred for MVP. MVP distribution targets technical early adopters via CLI install (`npx escribano recorder install`) + GitHub Releases for the Swift binary. See note below. |
   ```

2. After the Status table (after line 7, before line 9 `## Context`), insert a new section:
   ```markdown

   ### MVP Distribution Strategy (2026-03-27)

   The full `.app`/`.dmg` packaging described in this ADR is deferred. The MVP distribution targets technical early adopters who are comfortable with CLI installation:

   - **Recorder binary**: Pre-built Swift binary via GitHub Releases (or `swift build` from source)
   - **Node.js CLI**: `npx escribano` for batch processing and artifact generation
   - **LaunchAgent**: `npx escribano recorder install` for always-on capture
   - **Python bridge**: Auto-setup via `~/.escribano/venv` (existing zero-config flow)

   This avoids the complexity of `.app` bundle creation, embedded Python, code signing/notarization, and self-hosted CI runners. The `.app`/`.dmg` path remains the long-term plan for consumer distribution once the product loop is validated with early adopters.

   ```

**Verification**: `grep -c "Deferred" docs/adr/012-distribution-pipeline.md | grep -q "1"`

**Rollback**:
- Modified files: `git checkout -- docs/adr/012-distribution-pipeline.md`

---

### WU-4: Mark TDD-003 as superseded

**Dependencies**: none

**Context**: TDD-003 describes a `segments` table and `escribano cut` CLI command for the segmentation pipeline. The actual implementation (PR #53, Phase 3a) went a different direction: it uses TopicBlocks directly (not a separate `segments` table), LLM-based grouping (not activity-continuity segmentation), and the CLI command will be `escribano generate` (not `escribano cut`). The `segments` entity was explicitly rejected in ADR-011 ("Separate `segments` entity — TopicBlocks already serve this role; extra entity adds schema complexity with no value"). TDD-003 should be marked as superseded with a clear note pointing to the actual implementation.

**Files**:
- `docs/adr/011/tdd-003-segmentation-cli.md` — modify

**Steps**:
1. At the very top of the file (before line 1), insert the following superseded notice:
   ```markdown
   > **⚠️ SUPERSEDED (2026-03-27)**: This TDD has been superseded by the actual Phase 3a implementation (PR #53). Key differences:
   > - **No `segments` table** — TopicBlocks serve as the primary work unit (ADR-011: "Separate `segments` entity rejected — TopicBlocks already serve this role")
   > - **No `escribano cut` command** — Replaced by `escribano generate --today` / `escribano generate --from X --to Y` (Phase 3b)
   > - **No synthetic recordings** — TopicBlocks are decoupled from `recording_id` (nullable FK via migration 017)
   > - **LLM-based grouping** — Instead of activity-continuity segmentation, the SessionAggregator uses LLM semantic grouping via `text_infer`
   >
   > The document below is preserved for historical context. See ADR-011 Addendum and PR #53 for the actual implementation.

   ```

**Verification**: `grep -c "SUPERSEDED" docs/adr/011/tdd-003-segmentation-cli.md | grep -q "1"`

**Rollback**:
- Modified files: `git checkout -- docs/adr/011/tdd-003-segmentation-cli.md`

---

### WU-5: Update BACKLOG.md — mark Phase 3a complete, update Phase 3b

**Dependencies**: WU-1, WU-2, WU-3, WU-4 (needs all ADR updates done first to maintain consistency)

**Context**: BACKLOG.md still shows Phase 3a as unchecked todo items. PR #53 implements Phase 3a but with design changes from the original checklist (LLM grouping instead of gap-aware windowing, `SESSION_GAP_THRESHOLD` deprecated, migration numbered 017 not 016, `TB_MIN_OBSERVATIONS` default is 3 not 5). The Phase 3a section needs to be marked complete with notes reflecting the actual implementation, and Phase 3b needs minor updates. Also, "Recently Done" needs a new entry for Phase 3a and VLM-as-LLM POC.

**Files**:
- `BACKLOG.md` — modify

**Steps**:
1. Replace the Phase 3a section (lines 96-103) which currently reads:
   ```
   ##### Phase 3a: SessionAggregator (Swift actor in recorder)
   - [ ] Schema migration `016_session_aggregation.sql` — add `tb_id` to observations, `from_ts`/`to_ts`/`observation_count` to topic_blocks
   - [ ] `TopicBlockStore.port.swift` + `TopicBlockStore.sqlite.adapter.swift` — write topic_blocks, query by time range
   - [ ] `SessionAggregator.swift` — actor with gap-aware windowing, polls every `ESCRIBANO_TB_POLL_INTERVAL` (default 120s)
   - [ ] Wire `SessionAggregator` into `main.swift` as third async task alongside StreamCapture + FrameAnalyzer
   - [ ] `ESCRIBANO_SESSION_GAP_THRESHOLD` (default 20 min), `ESCRIBANO_TB_MIN_OBSERVATIONS` (default 5)
   - [ ] Backfill on startup: process all historical unclaimed observations via `WHERE tb_id IS NULL`
   - [ ] Update `escribano recorder status` to show TB count
   ```
   with:
   ```
   ##### Phase 3a: SessionAggregator (Swift actor in recorder)
   - [x] Schema migration `017_session_aggregation.sql` — add `tb_id` to observations, `from_ts`/`to_ts`/`observation_count` to topic_blocks
   - [x] `TopicBlockStore.port.swift` + `TopicBlockStore.sqlite.adapter.swift` — write topic_blocks, query by time range
   - [x] `SessionAggregator.swift` — LLM-based semantic grouping via `text_infer` (replaced gap-aware windowing from ADR-011)
   - [x] `WorkQueue.swift` — priority work queue serializing bridge access (FrameAnalyzer=realtime, SessionAggregator=normal)
   - [x] Wire `SessionAggregator` into `main.swift` as third async task alongside StreamCapture + FrameAnalyzer
   - [x] Protocol split: moved frame-claiming methods from `ObservationStore` to `FrameStore`
   - [x] `ESCRIBANO_TB_MIN_OBSERVATIONS` (default 3), `ESCRIBANO_TB_POLL_INTERVAL` (default 120s), `ESCRIBANO_TB_LLM_BATCH_SIZE` (default 100)
   - [x] Backfill on startup: process all historical unclaimed observations via `WHERE tb_id IS NULL`
   - **Phase 3a complete (2026-03-27)** — See PR #53. Design amended: LLM semantic grouping replaces pure gap-aware windowing. See ADR-011 Addendum.
   ```

2. In the "Recently Done" section (line 176 area), add a new bullet at the top of the `### 2026-03` section (after line 176, before the existing first bullet):
   ```
   - **Phase 3a complete** — SessionAggregator with LLM-based semantic grouping, WorkQueue priority serialization, protocol split (FrameStore/ObservationStore), migration 017. PR #53.
   - **VLM-as-LLM POC complete** — Validated single-model approach for frame analysis + text generation via shared Python bridge socket
   - **PR #55 merged** — Fixed deprecated `launchctl load/unload` → modern `bootstrap/bootout`, monitor false positives
   ```

**Verification**: `grep -c "Phase 3a complete" BACKLOG.md | grep -q "2"`

**Rollback**:
- Modified files: `git checkout -- BACKLOG.md`

---

### WU-6: Create MVP-FINAL-PUSH.md sprint plan

**Dependencies**: WU-5 (needs BACKLOG updated to reflect current state)

**Context**: The conversation established a 2-week MVP sprint plan with these priorities: (1) merge open PRs, (2) Phase 3b — time-range artifact generation, (3) menu bar app, (4) distribution via CLI install + GitHub Releases, (5) pricing (freemium + $29 founders), (6) landing page updates. This document should be the single source of truth for the sprint, replacing scattered conversation notes. The target is technical early adopters via CLI, not consumer `.app` packaging.

**Files**:
- `MVP-FINAL-PUSH.md` — create

**Steps**:
1. Create the file `MVP-FINAL-PUSH.md` at the repository root with the following content:

```markdown
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
```

**Verification**: `test -f MVP-FINAL-PUSH.md && grep -c "MVP Final Push" MVP-FINAL-PUSH.md | grep -q "1"`

**Rollback**:
- Created files: `rm -f MVP-FINAL-PUSH.md`

---

## Execution Plan

### Phase 1 — Parallel (no dependencies)
- WU-1: Update ADR-010 status to Accepted
- WU-2: Update ADR-011 status and Layer 2 description
- WU-3: Add "Deferred for MVP" note to ADR-012
- WU-4: Mark TDD-003 as superseded

### Phase 2 — Sequential (requires Phase 1)
- WU-5: Update BACKLOG.md — mark Phase 3a complete

### Phase 3 — Sequential (requires Phase 2)
- WU-6: Create MVP-FINAL-PUSH.md sprint plan

## Recovery Strategy

- **Automatic**: Each implementor rolls back and retries once on failure.
- **Dependency failure**: If a work unit fails and later units depend on it, those later units will not run. The orchestrator will report which units were skipped.
- **Global rollback**: `git checkout -- docs/adr/010-swift-native-visual-intelligence.md docs/adr/011-continuous-session-aggregation.md docs/adr/012-distribution-pipeline.md docs/adr/011/tdd-003-segmentation-cli.md BACKLOG.md && rm -f MVP-FINAL-PUSH.md`
- **Independent failures**: Work units with no dependency on a failed unit will still execute.
