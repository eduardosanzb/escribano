# ADR-012: Distribution Pipeline & Build Infrastructure

## Status

| State    | Date       | Details |
|----------|------------|---------|
| Proposed | 2026-03-18 | Informed by OpenDictation architecture analysis. Separates recorder and pipeline distribution, adds CI automation. |

## Context

### Current State

Escribano has two distinct products sharing one npm package:

1. **Batch pipeline** (`npx escribano --file video.mov`) — Node.js + Python + TypeScript. Processes pre-recorded videos. Needs `mlx-vlm`, `whisper-cli`, `ffmpeg`.
2. **Recorder** (`escribano` Swift binary) — Always-on capture agent. LaunchAgent. Pure Swift, no Node.js at runtime. 8 source files, no external Swift dependencies.

These products have different lifecycles: the recorder runs 24/7 and changes infrequently (capture logic is stable), while the pipeline evolves rapidly (VLM prompts, LLM models, artifact formats). Yet today they're bundled together — the Swift binary ships inside the npm package.

**Current distribution flow:**
1. Developer runs `pnpm build:recorder` locally → `bin/recorder-macos-arm64`
2. `npm publish` bundles everything: `dist/` (TS) + `bin/` (Swift binary) + `scripts/` (Python)
3. `postpublish` hook runs `create-release.mjs` → creates git tag → generates changelog via local Ollama → creates GitHub Release
4. User runs `npx escribano recorder install` → copies binary from npm package to `~/.escribano/bin/`

**Problems:**
1. **Coupled releases**: Can't update the recorder without publishing a new npm version (and vice versa)
2. **No Swift CI**: PRs breaking Swift build go undetected
3. **Manual process**: Building + publishing requires local Ollama for release notes
4. **No version tracking**: The Swift binary has no `--version` flag
5. **Slow pipeline first-run**: Python venv creation blocks for 2-5 minutes
6. **npm bloat**: The binary (~373KB) ships to every `npm install` even if user only wants the batch pipeline

### Reference: OpenDictation

[OpenDictation](https://github.com/kdcokenny/OpenDictation) — macOS dictation tool with mature release pipeline:

- **Sparkle + GitHub Actions**: Tag push → CI builds → DMG → GitHub Release. 23 releases in 15 days.
- **Makefile as build orchestrator**: Single entry point for build, release, DMG, lint, test.
- **State machine pattern**: Explicit `DictationStateMachine` with `@Published` enum states.
- **isMockMode**: Test all UI states without hardware permissions.
- **Pre-built XCFramework**: Dependencies downloaded as artifacts in CI (not built).

**Key difference**: OpenDictation is a `.app` bundle (Sparkle works natively). Escribano's recorder is a bare CLI binary. We use GitHub Releases instead of Sparkle.

## Decision

Split distribution into two independent release tracks sharing the same repository and SQLite database schema.

### Two Release Tracks

```
┌─────────────────────────────────────────────────────────────┐
│                     Same Git Repository                      │
│                                                              │
│  Track A: Recorder (Swift)         Track B: Pipeline (npm)   │
│  ─────────────────────────         ───────────────────────   │
│  Tag: recorder-v1.0.0              Tag: v0.6.0               │
│  CI: recorder-release.yml          CI: pipeline-release.yml  │
│  Artifact: GitHub Release          Artifact: npm registry    │
│  Install: recorder install         Install: npx escribano    │
│    (downloads binary from          Update: npm update         │
│     GitHub Releases)                                         │
│  Update: recorder update                                     │
│                                                              │
│              ┌─────────────────────┐                         │
│              │  Shared SQLite DB   │                         │
│              │  ~/.escribano/      │                         │
│              │  escribano.db       │                         │
│              └─────────────────────┘                         │
│              │                     │                         │
│              │  frames (write)     │  observations (read)    │
│              │  recorder ──────────│──────── pipeline        │
│              └─────────────────────┘                         │
└─────────────────────────────────────────────────────────────┘
```

**Coupling point**: Shared SQLite database + migration schema. Both tracks must agree on the DB schema. Migrations live in `migrations/` and are version-tracked.

### Layer 1: Swift CI + Makefile

**Swift CI workflow** (`.github/workflows/swift-ci.yml`):
- Trigger: PRs touching `apps/recorder/**`
- Runner: `self-hosted` (MacBook M4 Max as GitHub Actions runner)
- Steps: `swift build --package-path apps/recorder -c release`

> **Self-hosted runner**: All macOS workflows use `runs-on: self-hosted` — free, faster than GitHub's hosted runners. Setup: repo Settings → Actions → Runners → New self-hosted runner.
>
> **Security**: If repo is public, restrict self-hosted runners to `push` events only (not `pull_request` from forks).

**Makefile** (project root):
```makefile
.PHONY: all build build-node build-recorder test lint clean setup help

all: build

build: build-node build-recorder

build-node:
	pnpm build

build-recorder:
	bash scripts/build-recorder.sh

test:
	pnpm test

lint:
	pnpm biome ci .

clean:
	rm -rf dist/ apps/recorder/.build/ bin/recorder-macos-arm64

setup:
	pnpm install

help:
	@echo "Targets: build, build-node, build-recorder, test, lint, clean, setup"
```

### Layer 2: Version-Aware Binary + Recorder Release Track

**Version baked into Swift binary**:

`build-recorder.sh` generates `apps/recorder/Sources/Version.swift` before compilation:

```swift
// Auto-generated by build-recorder.sh — do not edit
let escribanoVersion = "1.0.0"
let escribanoBuildNumber = "42"  // GITHUB_RUN_NUMBER or "dev"
```

`main.swift` adds `--version` flag that prints version and exits.

**Recorder release workflow** (`.github/workflows/recorder-release.yml`):

Triggered on `recorder-v*` tag push (e.g., `git tag recorder-v1.0.0 && git push origin recorder-v1.0.0`).

```
1. Checkout code on self-hosted runner
2. swift build --package-path apps/recorder -c release
3. Version injection from tag (recorder-v1.0.0 → "1.0.0")
4. Code sign: ad-hoc initially, Developer ID when available
5. Create GitHub Release (tag: recorder-v1.0.0)
6. Upload recorder-macos-arm64 as release asset
7. Auto-generate release notes from commits touching apps/recorder/
```

**Pipeline release workflow** (`.github/workflows/pipeline-release.yml`):

Triggered on `v*` tag push (e.g., `git tag v0.6.0 && git push origin v0.6.0`).

```
1. Checkout code on ubuntu-latest
2. pnpm install && pnpm build
3. npm publish (with NPM_TOKEN secret)
4. Create GitHub Release with auto-generated notes
```

**npm package no longer bundles the Swift binary.** Remove `bin` from `package.json` `files` array. The `recorder install` command downloads from GitHub Releases instead.

### Layer 3: `recorder install` + `recorder update` via GitHub Releases

Modify `recorder install` to download the binary from the latest `recorder-v*` GitHub Release instead of copying from the npm package:

```typescript
export async function recorderInstall(): Promise<void> {
  // 1. Fetch latest recorder release
  const releases = await fetch(
    "https://api.github.com/repos/eduardosanzb/escribano/releases"
  );
  const recorderRelease = (await releases.json())
    .find(r => r.tag_name.startsWith("recorder-v"));

  // 2. Download binary asset
  const asset = recorderRelease.assets
    .find(a => a.name === "recorder-macos-arm64");
  // Download to ~/.escribano/bin/escribano

  // 3. Generate LaunchAgent plist (existing logic)
  // 4. launchctl load (existing logic)
}
```

Add `recorder update` command:

```typescript
export async function recorderUpdate(): Promise<void> {
  // 1. Read installed version: ~/.escribano/bin/escribano --version
  // 2. Fetch latest recorder-v* release from GitHub API
  // 3. Compare semver — if newer: download, replace, restart LaunchAgent
}
```

Wire as `npx escribano recorder update` (alongside existing `install` and `status`).

### Layer 4: Bundled Python venv

> Only needed for the **pipeline** (`--file` / `--latest` mode), not the recorder.

**CI job** (added to `pipeline-release.yml`):
- Build venv on `self-hosted` (ARM64 required for mlx)
- `python3 -m venv` + `pip install mlx-vlm mlx mlx-lm`
- Upload as release asset `escribano-venv-macos-arm64.tar.gz`

**Install flow** (modify `src/python-deps.ts`):
```
if ~/.escribano/venv exists AND version matches → skip
else if GitHub Release has venv artifact → download + extract
else → pip install (current fallback)
```

**Size concern**: ~1.5-2GB compressed. May need external hosting (Coolify CDN) if over GitHub's 2GB asset limit.

## Architectural Improvements (Informed by OpenDictation)

### A. Formalize Recorder State Machine

Replace scattered booleans with explicit enum (mirrors OpenDictation's `DictationStateMachine`):

```swift
enum RecorderState: Codable {
    case idle
    case waitingForPermission
    case starting
    case capturing
    case paused(PauseReason)
    case error(String)
}

enum PauseReason: Codable {
    case backpressure
    case userRequested
}
```

- State written to `~/.escribano/recorder-state.json` on every transition
- `recorder status` reads this file for rich diagnostics
- Enables future state-aware UI (menu bar icon, notifications)

**Files**: `apps/recorder/Sources/RecorderState.swift` (new), `apps/recorder/Sources/main.swift` (modify)

### B. `--mock` Mode for Testing

- `InMemoryFrameStore`: Dictionary-based, no SQLite, no Screen Recording permission
- `MockStreamCapture`: Generates synthetic frames
- Enables CI testing of startup/shutdown lifecycle
- Foundation for Swift test target (`swift test`)

**Files**: `apps/recorder/Sources/main.swift` (modify), `apps/recorder/Sources/InMemoryFrameStore.swift` (new)

### C. Port/Adapter Validation

OpenDictation's `TranscriptionProvider` protocol confirms Escribano's port/adapter approach is correct. No changes needed.

## Consequences

### Positive

- **Independent release cadence**: Recorder and pipeline evolve at their own pace
- **Lighter npm package**: No Swift binary in npm; pipeline users don't download unnecessary code
- **Tag-and-ship velocity**: Push a tag → CI handles everything
- **Swift build validation**: PRs that break the recorder are caught before merge
- **Version-aware diagnostics**: `recorder status` shows installed version + update availability
- **Faster pipeline first-run**: Pre-built venv eliminates 2-5 minute pip install

### Negative

- **Self-hosted runner dependency**: MacBook must be on for CI builds
- **Network dependency on install**: `recorder install` now requires internet to download from GitHub Releases (previously worked offline from npm cache)
- **Two tag conventions**: `recorder-v*` vs `v*` — need discipline to tag correctly
- **Venv artifact size**: May exceed GitHub Release limits

### Neutral

- **No Sparkle yet**: Deferred until recorder wraps in `.app` bundle
- **No DMG yet**: Deferred until `.app` bundling
- **Shared DB schema**: Both products must agree on migrations — this coupling remains

## What This Supersedes

| Superseded | Reason |
|-----------|--------|
| `scripts/create-release.mjs` (postpublish hook) | Replaced by two CI workflows. No more local Ollama. |
| Binary bundled in npm package (`bin/` in `files` array) | Recorder distributed via GitHub Releases independently. |
| Single release cycle for both products | Split into `recorder-v*` and `v*` tracks. |

## Deferred Decisions

| Topic | Reason |
|-------|--------|
| **Sparkle + `.app` bundle** | Requires wrapping CLI in `.app`. Do when we add menu bar UI. |
| **create-dmg** | Requires `.app` bundle first. |
| **Apple Developer ID signing** | Orthogonal. Plug into `recorder-release.yml` via secret when available. |
| **Universal binary (x86_64 + ARM64)** | MLX is Apple Silicon only. |
| **DB schema versioning across tracks** | Currently both tracks share migrations. If they diverge significantly, consider schema version negotiation. |

## Implementation Order

```
Layer 1 (Swift CI + Makefile)
  └─→ Layer 2 (Version + two release workflows)
        ├─→ Layer 3 (recorder install/update from GitHub Releases)
        └─→ Layer 4 (Bundled venv for pipeline)

Architectural A, B (state machine, mock mode) — independent, any time
```

## Files to Create/Modify

| File | Action | Layer |
|------|--------|-------|
| `Makefile` | Create | 1 |
| `.github/workflows/swift-ci.yml` | Create | 1 |
| `.github/workflows/recorder-release.yml` | Create | 2 |
| `.github/workflows/pipeline-release.yml` | Create | 2 |
| `scripts/build-recorder.sh` | Modify (add Version.swift generation from tag) | 2 |
| `apps/recorder/Sources/Version.swift` | Generated at build time (gitignored) | 2 |
| `apps/recorder/Sources/main.swift` | Modify (`--version` flag) | 2 |
| `.gitignore` | Add `apps/recorder/Sources/Version.swift` | 2 |
| `package.json` | Remove `bin` from `files`, remove `postpublish` hook | 2 |
| `scripts/create-release.mjs` | Delete (replaced by CI workflows) | 2 |
| `src/actions/recorder-commands.ts` | Modify: `install` downloads from GH Releases, add `update` | 3 |
| `src/index.ts` | Modify (wire `recorder update` subcommand) | 3 |
| `src/python-deps.ts` | Modify (download pre-built venv from pipeline release) | 4 |
| `apps/recorder/Sources/RecorderState.swift` | Create | Arch A |
| `apps/recorder/Sources/InMemoryFrameStore.swift` | Create | Arch B |

## References

- [OpenDictation](https://github.com/kdcokenny/OpenDictation) — Reference for Sparkle + GitHub Actions + create-dmg
- [ADR-009: Always-On Recorder](009-always-on-recorder.md) — Recorder architecture
- [ADR-010: Swift-Native Visual Intelligence](010-swift-native-visual-intelligence.md) — VLM analyzer (deferred)
- [Sparkle Project](https://sparkle-project.org/) — macOS auto-update framework (deferred)

## Verification

| Layer | How to verify |
|-------|---------------|
| 1 | PR touching `apps/recorder/` → swift-ci.yml triggers, build passes. `make build` succeeds locally. |
| 2 | Push `recorder-v1.0.0` tag → recorder-release.yml creates GitHub Release with binary. Push `v0.6.0` → pipeline-release.yml publishes to npm. Both work independently. |
| 3 | Run `npx escribano recorder install` on clean machine → downloads binary from GitHub Releases (not npm). `recorder update` detects newer release. |
| 4 | Fresh machine: `npx escribano --file video.mov` → downloads pre-built venv from pipeline release. |
| Arch A | `recorder status` shows structured state from `recorder-state.json`. |
| Arch B | `escribano --mock` starts without Screen Recording permission. |
