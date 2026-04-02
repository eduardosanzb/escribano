# Plan: Split Escribano into Public TS + Private Swift Repo

**Status:** IN PROGRESS  
**Created:** 2026-03-31  
**Goal:** Move Swift recorder to private `escribano-app` repo, keep TS pipeline public

---

## Context

The user wants to:
1. Keep the TypeScript batch pipeline **public** (open-source, community-friendly)
2. Move the Swift recorder to a **private** repo (`escribano-app`) for monetization
3. Link them via git submodule so development can happen in one place

**Target Architecture:**
```
Private: escribano-app
├── apps/recorder/              # Swift source (migrated)
├── escribano-ts/               # Submodule → public repo
│   ├── scripts/mlx_bridge.py   # ← Referenced from here (not copied)
│   └── src/db/migrations/      # ← Referenced from here (not copied)
└── README.md

Public: escribano (current repo)
├── src/                        # TS pipeline
├── scripts/mlx_bridge.py       # Single source of truth
├── src/db/migrations/          # Single source of truth (shared contract)
└── README.md
```

---

## Shared Files Strategy

Files used by both repos stay in the public repo and are referenced via submodule:

| File | Location | Private repo path |
|------|----------|-------------------|
| `mlx_bridge.py` | Public only | `escribano-ts/scripts/mlx_bridge.py` |
| Migrations | Public only | `escribano-ts/src/db/migrations/` |

**Benefits:**
- Single source of truth — no duplication, no drift
- Submodule IS the sync mechanism — no git hooks/GHA needed
- When public repo updates, private repo updates submodule reference

---

## Work Units

### Phase 1: Prepare Private Repo Structure

#### Unit 1.1: Create private repo on GitHub
- **Type:** Implementation
- **Description:** Create new private repository `escribano-app` using gh CLI
- **Command:** `gh repo create escribano-app --private --description "Escribano Swift recorder (private)"`
- **Verification:** `gh repo view eduardosanzb/escribano-app` succeeds

#### Unit 1.2: Initialize private repo with Swift code
- **Type:** Implementation
- **Description:** Clone private repo, copy Swift source files preserving structure
- **Files to copy:**
  - `apps/recorder/Sources/*` → `apps/recorder/Sources/`
  - `apps/recorder/Package.swift`
  - `apps/recorder/entitlements.plist`
  - `apps/recorder/.gitignore`
  - `apps/recorder/README.md`
- **Verification:** `swift build -c release` succeeds in private repo

#### Unit 1.3: Add public repo as submodule
- **Type:** Implementation
- **Description:** Add the public TS repo as a submodule in the private repo. Shared files (mlx_bridge.py, migrations) are accessed via the submodule path.
- **Command:** `git submodule add git@github.com:eduardosanzb/escribano.git escribano-ts`
- **Shared file access:**
  - `mlx_bridge.py` → `escribano-ts/scripts/mlx_bridge.py`
  - Migrations → `escribano-ts/src/db/migrations/`
- **Verification:** `escribano-ts/` directory exists with TS code

---

### Phase 2: Clean Up Public Repo

#### Unit 2.1: Remove Swift recorder directory
- **Type:** Implementation
- **Description:** Delete `apps/recorder/` from public repo
- **Command:** `git rm -r apps/recorder/`
- **Verification:** Directory no longer exists

#### Unit 2.2: Remove recorder scripts from package.json
- **Type:** Implementation
- **Description:** Remove recorder-related npm scripts
- **Scripts to remove:**
  - `build:recorder`
  - `prerecorder:dev`
  - `recorder:dev`
  - `recorder:install`
  - `recorder:monitor`
- **Verification:** `grep -c "recorder" package.json` returns 0

#### Unit 2.3: Delete recorder TypeScript files
- **Type:** Implementation
- **Description:** Remove TypeScript files that are recorder-specific
- **Files to delete:**
  - `src/actions/recorder-commands.ts`
  - `scripts/monitor-resources.ts`
  - `scripts/build-recorder.sh`
  - `scripts/cleanup-recorder-tbs.sql`
- **Verification:** Files no longer exist

#### Unit 2.4: Update src/index.ts
- **Type:** Implementation
- **Description:** Remove recorder CLI commands and imports
- **Changes:**
  - Remove `import { installRecorder, statusRecorder, restartRecorder } from './actions/recorder-commands.js'`
  - Remove `recorder` subcommand handling (lines 136-138, 171-194, 269-294)
  - Remove `--recorder` CLI option
- **Verification:** `pnpm build` succeeds, no recorder references

#### Unit 2.5: Delete recorder documentation
- **Type:** Implementation
- **Description:** Remove ADRs and docs specific to recorder
- **Files to delete:**
  - `docs/adr/009-always-on-recorder.md`
  - `docs/adr/010-swift-native-visual-intelligence.md`
  - `docs/adr/011-continuous-session-aggregation.md`
  - `docs/adr/012-distribution-pipeline.md`
  - `docs/SCREENCAPTUREKIT-POC-SPIKE.md`
- **Verification:** Files no longer exist

#### Unit 2.6: Update CLAUDE.md
- **Type:** Implementation
- **Description:** Remove recorder-specific sections
- **Changes:**
  - Remove "Recorder (Always-On)" env vars section
  - Remove recorder CLI commands from CLI section
  - Remove recorder architecture references
  - Add note: "Recorder moved to private repo (escribano-app)"
- **Verification:** No recorder references in file

#### Unit 2.7: Update BACKLOG.md
- **Type:** Implementation
- **Description:** Remove recorder tasks from backlog
- **Changes:**
  - Remove "Recorder MVP (ADR-009)" section
  - Remove "Recorder Hardening" section
  - Remove "Phase 4: Distribution Pipeline"
  - Add note about private repo
- **Verification:** No recorder tasks in backlog

---

### Phase 3: Update Shared Schema Documentation

#### Unit 3.1: Document schema as shared contract
- **Type:** Implementation
- **Description:** Add comments to migrations explaining they're shared
- **Files to modify:**
  - `src/db/migrations/014_recorder_frames.sql` — add header comment
  - `src/db/migrations/015_observations_frame_fk.sql` — add header comment
  - `src/db/migrations/017_session_aggregation.sql` — add header comment
- **Comment format:**
  ```sql
  -- SHARED SCHEMA: This migration is part of the contract between
  -- escribano (public TS) and escribano-app (private Swift).
  -- Both repos must agree on this schema version.
  ```
- **Verification:** Comments present in all 3 files

---

### Phase 4: Finalize and Commit

#### Unit 4.1: Commit changes to public repo
- **Type:** Implementation
- **Description:** Commit all removals and updates
- **Command:** `git add -A && git commit -m "refactor: move Swift recorder to private repo (escribano-app)"`
- **Verification:** Clean working tree

#### Unit 4.2: Commit changes to private repo
- **Type:** Implementation
- **Description:** Commit all additions in private repo
- **Command:** `git add -A && git commit -m "feat: initialize from public escribano repo"`
- **Verification:** Clean working tree

---

## Execution Order

```
Phase 1 (Private Repo Setup)
├── Unit 1.1 ─── Implementation (gh repo create)
├── Unit 1.2 ─── After 1.1
└── Unit 1.3 ─── After 1.2

Phase 2 (Public Repo Cleanup) — Can run in parallel with Phase 1
├── Unit 2.1 ─── Independent
├── Unit 2.2 ─── Independent
├── Unit 2.3 ─── Independent
├── Unit 2.4 ─── After 2.3 (needs recorder-commands.ts deleted)
├── Unit 2.5 ─── Independent
├── Unit 2.6 ─── Independent
└── Unit 2.7 ─── Independent

Phase 3 (Schema Docs) — Can run in parallel
└── Unit 3.1 ─── Independent

Phase 4 (Finalize) — Must be last
├── Unit 4.1 ─── After all Phase 2 + 3 units
└── Unit 4.2 ─── After all Phase 1 units
```

---

## Parallelization Strategy

**Batch 1 (Can run in parallel):**
- Unit 1.1 — create repo via gh CLI
- Unit 2.1, 2.2, 2.3, 2.5, 2.6, 2.7, 3.1 — all independent

**Batch 2 (After Batch 1):**
- Unit 1.2, 1.3 — private repo setup
- Unit 2.4 — needs recorder-commands.ts deleted first

**Batch 3 (Final):**
- Unit 4.1, 4.2 — commits

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Git history lost for Swift files | Use `git filter-repo` or accept fresh start (simpler) |
| Schema drift between repos | Document as shared contract, version in migrations |
| `mlx_bridge.py` diverges | Single source of truth in public repo; private repo references via submodule |
| CI breaks after removal | Update CI config if needed (check `.github/workflows/`) |

---

## User Decisions Required

1. **Worktree preference** — Does user want to work in a new worktree or current directory?

---

## Verification Commands

After completion:
```bash
# In public repo
grep -r "recorder" src/ scripts/ package.json  # Should return minimal/no results
pnpm build                                     # Should succeed
pnpm test                                      # Should pass

# In private repo
swift build -c release                         # Should succeed
ls apps/recorder/Sources/                      # Should show all Swift files
ls escribano-ts/                               # Should show TS submodule
ls escribano-ts/scripts/mlx_bridge.py          # Should show shared bridge script
ls escribano-ts/src/db/migrations/             # Should show shared migrations
```
