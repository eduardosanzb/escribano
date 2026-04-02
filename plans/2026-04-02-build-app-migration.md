# Implementation Plan: Wire up build-app.sh and Remove Deprecated Installation

**Date**: 2026-04-02 **Status**: COMPLETED

## Overview

The Swift app is no longer a background daemon (`LaunchAgent`) installed via `recorder:install`. Instead, it's a standalone macOS Menu Bar `.app` bundle distributed via DMG, using the `build-app.sh` script. This plan migrates `build-app.sh` to the private repo, updates its paths to pull dependencies from the `escribano-ts` submodule, and removes the deprecated installation methods.

## Scope

- Work units: 3
- Execution phases: 1
- Repositories affected: 
  - `escribano-app` (Private - add script, update package.json, remove old scripts)
  - `escribano` (Public - remove build-app.sh)

## Work Units

### WU-1: Migrate and Update `build-app.sh`

**Dependencies**: none

**Context**: `build-app.sh` packages the Swift binary, migrations, and Python bridge into an `.app` bundle. Its paths need to be updated to point to the `escribano-ts` submodule for the shared resources.

**Files**:
- `/Users/eduardosanchez/repos/github.com/eduardosanzb/escribano-app/scripts/build-app.sh` — create/modify
- `/Users/eduardosanchez/repos/github.com/eduardosanzb/escribano/scripts/build-app.sh` — delete

**Steps**:
1. Copy `build-app.sh` from the public repo to the private repo's `scripts/` directory.
2. Edit the copied `build-app.sh` in the private repo:
   - Change `SQL_FILES=("$REPO_ROOT"/migrations/*.sql)` to `SQL_FILES=("$REPO_ROOT"/escribano-ts/migrations/*.sql)`
   - Change `cp "$REPO_ROOT/scripts/mlx_bridge.py" ...` to `cp "$REPO_ROOT/escribano-ts/scripts/mlx_bridge.py" ...`
3. Remove `build-app.sh` from the public repo (`git rm scripts/build-app.sh`).

**Verification**: `cat /Users/eduardosanchez/repos/github.com/eduardosanzb/escribano-app/scripts/build-app.sh | grep escribano-ts` exits 0

**Rollback**: 
- `git -C /Users/eduardosanchez/repos/github.com/eduardosanzb/escribano reset HEAD scripts/build-app.sh && git checkout -- scripts/build-app.sh`

### WU-2: Remove Deprecated Scripts

**Dependencies**: none

**Context**: `build-recorder.sh` is the deprecated CLI daemon builder. It should be removed from the private repo since `build-app.sh` replaces it entirely.

**Files**:
- `/Users/eduardosanchez/repos/github.com/eduardosanzb/escribano-app/scripts/build-recorder.sh` — delete

**Steps**:
1. Remove `build-recorder.sh` from the private repo.

**Verification**: `ls /Users/eduardosanchez/repos/github.com/eduardosanzb/escribano-app/scripts/build-recorder.sh` fails.

### WU-3: Update package.json

**Dependencies**: none

**Context**: Remove the deprecated `recorder:install` and `build:recorder` scripts from `package.json`, and replace them with `"build:app": "bash scripts/build-app.sh"`.

**Files**:
- `/Users/eduardosanchez/repos/github.com/eduardosanzb/escribano-app/package.json` — modify

**Steps**:
1. Edit `package.json` in the private repo.
2. Remove the `"recorder:install"` line completely.
3. Replace `"build:recorder": ...` with `"build:app": "bash scripts/build-app.sh"`.

**Verification**: `cat /Users/eduardosanchez/repos/github.com/eduardosanzb/escribano-app/package.json | grep build:app` exits 0

## Execution Plan

### Phase 1 — Parallel (no dependencies)
- WU-1: Migrate and Update `build-app.sh`
- WU-2: Remove Deprecated Scripts
- WU-3: Update package.json

## Recovery Strategy
- **Automatic**: Each implementor rolls back and retries once on failure.