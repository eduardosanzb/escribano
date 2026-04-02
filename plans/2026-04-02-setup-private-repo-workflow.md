# Implementation Plan: Setup Private Repo Workflow

**Date**: 2026-04-02 **Status**: COMPLETED

## Overview

Initialize the development workflow, configurations, and documentation for the new private Swift repo (`escribano-app`). This involves migrating the root config files (`.env.example`, `.gitignore`, `.opencode`), splitting the context files (`CLAUDE.md`, `BACKLOG.md`), moving the MVP tracker, and establishing a `package.json` to retain familiar development commands like `pnpm recorder:dev`.

## Scope

- Work units: 4
- Execution phases: 2
- Repositories affected: 
  - `escribano-app` (Private - additions and configuration)
  - `escribano` (Public - removing `MVP-FINAL-PUSH.md`)

## Work Units

### WU-1: Migrate Root Configurations

**Dependencies**: none

**Context**: The private repo needs a baseline configuration matching the original workspace to ensure OpenCode, git, and local environments work seamlessly.

**Files**:
- `~/repos/github.com/eduardosanzb/escribano-app/.env.example` — create
- `~/repos/github.com/eduardosanzb/escribano-app/.gitignore` — create
- `~/repos/github.com/eduardosanzb/escribano-app/opencode.json` — create
- `~/repos/github.com/eduardosanzb/escribano-app/.opencode/` — create

**Steps**:
1. Copy `.env.example`, `opencode.json`, and `.opencode/` from the `escribano-ts/` submodule to the root of `escribano-app`.
2. Create a new `.gitignore` in the root of `escribano-app` by combining the generic ignores from `escribano-ts/.gitignore` (like `.env`, macOS files) with the Swift-specific ignores from `apps/recorder/.gitignore`.
3. Update `.opencode/worktree.jsonc` to ensure it still symlinks `node_modules` and runs `pnpm install` (which will now use the new private repo's `package.json`).

**Verification**: `ls -la ~/repos/github.com/eduardosanzb/escribano-app/.opencode/worktree.jsonc` exits 0

**Rollback**: 
- `rm -rf ~/repos/github.com/eduardosanzb/escribano-app/.env.example ~/repos/github.com/eduardosanzb/escribano-app/.gitignore ~/repos/github.com/eduardosanzb/escribano-app/opencode.json ~/repos/github.com/eduardosanzb/escribano-app/.opencode`

### WU-2: Setup Dev Scripts (package.json)

**Dependencies**: none

**Context**: The user relies on `pnpm recorder:dev` to run the app locally. We need to provide a `package.json` in the private repo that bridges the gap to the `escribano-ts` submodule dependencies (like the python bridge and migration runner).

**Files**:
- `~/repos/github.com/eduardosanzb/escribano-app/package.json` — create

**Steps**:
1. Create `package.json` in the root of `escribano-app`.
2. Add a `"postinstall": "cd escribano-ts && pnpm install"` script to ensure the submodule dependencies are ready.
3. Add a `"recorder:dev"` script that mimics the old one, but adjusts paths to use `escribano-ts/`:
   - Runs `ensure-python-env.ts` via the submodule.
   - Builds the Swift package in `apps/recorder`.
   - Cleans up old processes.
   - Sets `ESCRIBANO_BRIDGE_PATH=$(pwd)/escribano-ts/scripts/mlx_bridge.py` and runs the built Swift binary.
4. Add `"build:recorder"` and `"recorder:install"` mapped appropriately.

**Verification**: `cat ~/repos/github.com/eduardosanzb/escribano-app/package.json | grep "recorder:dev"` exits 0

**Rollback**:
- `rm ~/repos/github.com/eduardosanzb/escribano-app/package.json`

### WU-3: Migrate Context and Backlog

**Dependencies**: none

**Context**: AI assistants need context (`CLAUDE.md`) and task tracking (`BACKLOG.md`) specific to the Swift recorder. We'll copy the pre-split versions from the pinned submodule and strip out the TypeScript pipeline details to create Swift-focused context files.

**Files**:
- `~/repos/github.com/eduardosanzb/escribano-app/CLAUDE.md` — create
- `~/repos/github.com/eduardosanzb/escribano-app/BACKLOG.md` — create

**Steps**:
1. Copy `CLAUDE.md` and `BACKLOG.md` from `escribano-ts/` to the root of `escribano-app`.
2. Edit the root `CLAUDE.md`: Remove the "TypeScript Batch Pipeline" sections, leaving the architecture, Swift conventions, and MLX setup details that apply to the recorder.
3. Edit the root `BACKLOG.md`: Keep the "Recorder MVP (ADR-009)" tasks and Swift hardening tasks. Remove the TS-specific tasks (like Outline syncing, OCR on keyframes, etc.).

**Verification**: `ls ~/repos/github.com/eduardosanzb/escribano-app/CLAUDE.md` exits 0

**Rollback**:
- `rm ~/repos/github.com/eduardosanzb/escribano-app/CLAUDE.md ~/repos/github.com/eduardosanzb/escribano-app/BACKLOG.md`

### WU-4: Move MVP-FINAL-PUSH.md

**Dependencies**: none

**Context**: The MVP tracking document belongs with the private repo where the active feature development for the recorder is happening.

**Files**:
- `~/repos/github.com/eduardosanzb/escribano-app/MVP-FINAL-PUSH.md` — create
- `/Users/eduardosanchez/repos/github.com/eduardosanzb/escribano/MVP-FINAL-PUSH.md` — delete

**Steps**:
1. Copy `/Users/eduardosanchez/repos/github.com/eduardosanzb/escribano/MVP-FINAL-PUSH.md` to `~/repos/github.com/eduardosanzb/escribano-app/MVP-FINAL-PUSH.md`.
2. In the public repo (`/Users/eduardosanchez/repos/github.com/eduardosanzb/escribano`), run `git rm MVP-FINAL-PUSH.md`.

**Verification**: `ls ~/repos/github.com/eduardosanzb/escribano-app/MVP-FINAL-PUSH.md` exits 0

**Rollback**:
- `git -C /Users/eduardosanchez/repos/github.com/eduardosanzb/escribano checkout HEAD -- MVP-FINAL-PUSH.md`
- `rm ~/repos/github.com/eduardosanzb/escribano-app/MVP-FINAL-PUSH.md`

## Execution Plan

### Phase 1 — Parallel (no dependencies)
- WU-1: Migrate Root Configurations
- WU-2: Setup Dev Scripts (package.json)
- WU-3: Migrate Context and Backlog
- WU-4: Move MVP-FINAL-PUSH.md

## Recovery Strategy
- **Automatic**: Each implementor rolls back and retries once on failure.
- **Global rollback**: `git reset HEAD~1 --hard` where appropriate, or delete the copied files from the private repo root since they are untracked.