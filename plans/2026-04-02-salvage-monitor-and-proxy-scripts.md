# Implementation Plan: Migrate Remaining Tools and Scripts

**Date**: 2026-04-02 **Status**: COMPLETED

## Overview

The user wants to ensure all the helpful development scripts (like `monitor-resources.ts`, the dashboard, quality tests, and CLI aliases) are accessible from the root of the private `escribano-app` repo so their workflow remains smooth and uncomplicated. 

Additionally, because we deleted `monitor-resources.ts` from the public repo, we need to salvage it from the submodule (which is currently pinned to an older commit) and move it permanently into the private repo. 

## Scope

- Work units: 2
- Execution phases: 1
- Repositories affected: `escribano-app` (Private)

## Work Units

### WU-1: Salvage `monitor-resources.ts`

**Dependencies**: none

**Context**: The `monitor-resources.ts` script was deleted from the public repo during the cleanup phase, but the user still needs it for the private repo's development workflow. The submodule `escribano-ts` still contains a copy because it's pinned to an older commit. We must extract it before the submodule is updated.

**Files**:
- `~/repos/github.com/eduardosanzb/escribano-app/scripts/monitor-resources.ts` — create (copy from submodule)

**Steps**:
1. Run `mkdir -p /Users/eduardosanchez/repos/github.com/eduardosanzb/escribano-app/scripts`
2. Copy `/Users/eduardosanchez/repos/github.com/eduardosanzb/escribano-app/escribano-ts/scripts/monitor-resources.ts` to `/Users/eduardosanchez/repos/github.com/eduardosanzb/escribano-app/scripts/monitor-resources.ts`.
3. (Optional but good practice) Also salvage `build-recorder.sh` and `cleanup-recorder-tbs.sql` if they are useful to have around locally, though `build-recorder` logic is mostly in `package.json` now. We'll copy all three just in case.

**Verification**: `ls -la /Users/eduardosanchez/repos/github.com/eduardosanzb/escribano-app/scripts/monitor-resources.ts` exits 0

**Rollback**: 
- `rm -rf /Users/eduardosanchez/repos/github.com/eduardosanzb/escribano-app/scripts`

### WU-2: Add Proxy Scripts to package.json

**Dependencies**: none

**Context**: The user wants to run commands like `pnpm dashboard` and `pnpm quality-test` from the root of the private repo without having to `cd escribano-ts` every time. We will add proxy scripts to the root `package.json` to pass commands down.

**Files**:
- `~/repos/github.com/eduardosanzb/escribano-app/package.json` — modify

**Steps**:
1. Edit the root `package.json`.
2. Add proxy scripts that `cd escribano-ts && pnpm <command>`.
   - `"dashboard": "cd escribano-ts && pnpm dashboard"`
   - `"quality-test": "cd escribano-ts && pnpm quality-test"`
   - `"quality-test:fast": "cd escribano-ts && pnpm quality-test:fast"`
   - `"db:reset": "cd escribano-ts && pnpm db:reset"`
   - `"escribano": "cd escribano-ts && pnpm escribano"`
   - `"test": "cd escribano-ts && pnpm test"`
3. Add the script to run the local monitor we just salvaged:
   - `"recorder:monitor": "cd escribano-ts && pnpm tsx ../scripts/monitor-resources.ts"` (Run from `escribano-ts` directory so `tsx` and `.env` resolution works correctly).

**Verification**: `cat /Users/eduardosanchez/repos/github.com/eduardosanzb/escribano-app/package.json | grep "dashboard"` exits 0

**Rollback**:
- `git checkout -- package.json` (or revert the specific edits)

## Execution Plan

### Phase 1 — Parallel (no dependencies)
- WU-1: Salvage `monitor-resources.ts`
- WU-2: Add Proxy Scripts to package.json

## Recovery Strategy
- **Automatic**: Each implementor rolls back and retries once on failure.