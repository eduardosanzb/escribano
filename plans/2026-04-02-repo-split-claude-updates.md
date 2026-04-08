# Implementation Plan: Repo Split CLAUDE.md Updates

**Date**: 2026-04-02  
**Status**: COMPLETED

## Overview

Rewrite `CLAUDE.md` in the private repo (`escribano-app`) to accurately reflect its Swift 6.0 / AppKit architecture, and update `CLAUDE.md` in the public repo (`escribano`) to document the repo split and submodule relationship.

## Scope

- Work units: 2
- Execution phases: 1
- Files affected:
  - `../escribano-app/CLAUDE.md` — rewrite
  - `CLAUDE.md` — modify

## Work Units

### WU-1: Rewrite escribano-app CLAUDE.md

**Dependencies**: none

**Context**: The private repo's `CLAUDE.md` is currently AI-generated fiction that incorrectly claims the app uses SwiftUI, GRDB, and MLX Swift. It needs a complete rewrite based on `apps/recorder/README.md` and `.env.example` to reflect its actual Swift 6.0, AppKit, ScreenCaptureKit, raw SQLite, and Python bridge architecture, including dev scripts and the submodule relationship.

**Files**:
- `../escribano-app/CLAUDE.md` — modify

**Steps**:
1. Rewrite the entire file to reflect the true architecture (Swift 6.0, AppKit, Python bridge, SQLite C API).
2. Add a section explaining the repo split history and the `escribano-ts` submodule workflow.
3. Include the 3 concurrent Tasks + `InferenceQueue` architecture and backpressure.
4. List all `package.json` pnpm dev scripts (`recorder:dev`, `build:app`, etc.).
5. Include the full recorder-specific environment variables table.

**Verification**: `cat ../escribano-app/CLAUDE.md | grep "AppKit"`

**Rollback**:
- `git checkout -- ../escribano-app/CLAUDE.md`

### WU-2: Add repo split context to public CLAUDE.md

**Dependencies**: none

**Context**: The public repo's `CLAUDE.md` only has a brief 3-line note about the recorder moving to `escribano-app`. It needs a prominent section documenting the two-repo architecture, the submodule relationship, and the fact that the full product backlog now lives in the private repo.

**Files**:
- `CLAUDE.md` — modify

**Steps**:
1. Locate the top of `CLAUDE.md`.
2. Add a detailed section (e.g., "## Two-Repo Architecture") explaining that `escribano` is the public TS pipeline, while `escribano-app` is the private native macOS app containing this repo as a submodule.
3. Mention that `ESCRIBANO_CHURN_THRESHOLD` and `ESCRIBANO_CHURN_THROTTLE_INTERVAL` apply to the pipeline.

**Verification**: `cat CLAUDE.md | grep "Two-Repo Architecture"`

**Rollback**:
- `git checkout -- CLAUDE.md`

## Execution Plan

### Phase 1 — Parallel (no dependencies)

- WU-1: Rewrite escribano-app CLAUDE.md
- WU-2: Add repo split context to public CLAUDE.md

## Recovery Strategy

- **Automatic**: Each implementor rolls back and retries once on failure.
- **Global rollback**: `git checkout HEAD -- ../escribano-app/CLAUDE.md CLAUDE.md`
