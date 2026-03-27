# ADR-012: Mac App Distribution Pipeline & Embedded Python

## Status

| State    | Date       | Details |
|----------|------------|---------|
| Proposed | 2026-03-18 | Focuses on consumer Mac App distribution via `.dmg`, embedded Python, and async model downloads. |
| Deferred     | 2026-03-27 | Full `.app`/`.dmg` packaging deferred for MVP. MVP distribution targets technical early adopters via CLI install (`npx escribano recorder install`) + GitHub Releases for the Swift binary. See note below. |

### MVP Distribution Strategy (2026-03-27)

The full `.app`/`.dmg` packaging described in this ADR is deferred. The MVP distribution targets technical early adopters who are comfortable with CLI installation:

- **Recorder binary**: Pre-built Swift binary via GitHub Releases (or `swift build` from source)
- **Node.js CLI**: `npx escribano` for batch processing and artifact generation
- **LaunchAgent**: `npx escribano recorder install` for always-on capture
- **Python bridge**: Auto-setup via `~/.escribano/venv` (existing zero-config flow)

This avoids the complexity of `.app` bundle creation, embedded Python, code signing/notarization, and self-hosted CI runners. The `.app`/`.dmg` path remains the long-term plan for consumer distribution once the product loop is validated with early adopters.

## Context

### Current State

Escribano has two distinct products sharing one npm package:

1. **Batch pipeline** (`npx escribano --file video.mov`) — Node.js + Python + TypeScript. Processes pre-recorded videos. Needs `mlx-vlm`, `whisper-cli`, `ffmpeg`.
2. **Recorder** (`escribano` Swift binary) — Always-on capture agent. LaunchAgent. Pure Swift, no Node.js at runtime.

With the direction established in **ADR-009 (Always-On Recorder)** and **ADR-011 (Continuous Session Aggregation)**, the Swift recorder is becoming the primary product. The user experience should shift from a developer-focused CLI tool to a frictionless consumer Mac App. Non-technical users expect to download a `.dmg`, drag a `.app` bundle to the Applications folder, and launch it without running terminal commands (`npm`, `uv`) to bootstrap environments.

However, as per **ADR-010 (Swift-Native Visual Intelligence)**, while we want a pure Swift app eventually, `mlx-swift` is not yet stable/mature enough to fully replace our Python-based MLX pipeline. We must bridge the gap by retaining Python for the time being, but entirely hiding it from the end-user.

## Decision

We will package Escribano as a standard macOS application (`.app`) distributed via a `.dmg` file.

### 1. The `.app` Bundle and Embedded Python
Instead of relying on the user's system Python or bootstrapping via `uv` at runtime (which assumes developer tools/network reliability), we will **embed a standalone Python environment** directly inside the `.app` bundle (`Escribano.app/Contents/Resources/python_env`).

During CI:
- A pre-compiled standalone Python distribution is downloaded.
- `pip install mlx mlx-vlm` is executed into this environment.
- The entire hermetic environment is packaged into the Mac App.
- The Swift application will use `Process()` to execute Python scripts using this embedded interpreter.

### 2. Runtime Model Downloading with Backpressure
To keep the initial `.dmg` download small, **models will not be bundled**.
- When the user opens the app for the first time, it will check `~/.escribano/models/` for the required MLX models.
- If missing, it triggers an asynchronous download.
- Relying on the recorder's backpressure mechanism (ADR-009), the agent will continue to capture and buffer frames into the SQLite database.
- Once the model is ready, the VLM worker spins up and processes the buffered queue.

### 3. Decoupling the Legacy Pipeline
The NPM package (`npx escribano`) will be maintained as a separate, secondary track strictly for developers and the legacy batch processing feature. The Mac App is the canonical product.

## Architectural TDDs

The implementation details for this ADR are split into the following Technical Design Documents:

- **[TDD-004: Mac App Packaging & Embedded Python](012/tdd-004-mac-app-packaging-embedded-python.md)**: Specifications for building the `.app`, embedding Python, and code signing.
- **[TDD-005: Runtime Model Download Strategy](012/tdd-005-runtime-model-download.md)**: Specifications for the async download queue, UI state, and backpressure handling.
- **[TDD-006: CI/CD Build Infrastructure](012/tdd-006-ci-cd-build-infrastructure.md)**: Using self-hosted Mac runners to automate the `.app` and `.dmg` assembly.

## Consequences

### Positive
- **Consumer-Ready**: Frictionless drag-and-drop Mac installation.
- **Hermetic Runtime**: Zero reliance on user's local Python setup, avoiding `pip` or `uv` failures on non-dev machines.
- **Small Payload**: Avoiding bundled models keeps the download fast and lightweight.
- **Clean Separation**: Developer NPM tool and Consumer Mac App evolve independently.

### Negative
- **Build Complexity**: Creating `.app` bundles with embedded Python and proper code signing/notarization is significantly more complex than a CLI binary.
- **Self-Hosted Runner Dependency**: Apple Developer ID signing and `.app` packaging require the MacBook self-hosted runner to be consistently available.
- **Migration Required**: Existing users with `npx escribano recorder install` (LaunchAgent setup) will need to uninstall the npm-managed binary and install the `.app` manually. No automatic migration path.

## References

- [ADR-009: Always-On Recorder](009-always-on-recorder.md)
- [ADR-010: Swift-Native Visual Intelligence](010-swift-native-visual-intelligence.md)
- [ADR-011: Continuous Session Aggregation](011-continuous-session-aggregation.md)
