# TDD-006: CI/CD Build Infrastructure

## 1. Overview
This document outlines the GitHub Actions workflow and local Makefile architecture required to build, package, sign, and release the Escribano Mac App automatically.

## 2. Build Tooling
A central `Makefile` will orchestrate the build process:
- `make build-swift`: Compiles the Swift agent.
- `make fetch-python`: Downloads the standalone Python build and runs `pip install`.
- `make package-app`: Assembles the `.app` structure and copies in the binaries and resources.
- `make sign-app`: Applies the Developer ID certificate to both Swift and embedded Python binaries.
- `make create-dmg`: Packages the signed `.app` using a tool like `create-dmg`.
- `make notarize`: Submits to Apple and staples the ticket.

## 3. GitHub Actions Integration
- **Runner**: The pipeline relies on a `self-hosted` macOS runner (Apple Silicon M-series) to correctly build MLX and compile Swift for ARM64.
- **Triggers**: Pushing a tag (e.g., `v*`) kicks off the build process.
- **Artifacts**: The final notarized `.dmg` is uploaded to a GitHub Release automatically.

## 4. PR CI Workflow (Swift Build Validation)

Release builds run on the self-hosted runner, but **PR validation must not run untrusted fork code on a self-hosted machine**. Two separate workflows handle this:

| Workflow | Trigger | Runner | Purpose |
|----------|---------|--------|---------|
| `swift-ci.yml` | PR touching `apps/recorder/**` | `macos-latest` (GitHub-hosted) | Compile check, fast feedback, safe for forks |
| `release.yml` | Tag push `v*` | `self-hosted` (M4 Max) | Full build: fetch Python, sign, DMG, notarize, upload |

`swift-ci.yml` only runs `swift build --package-path apps/recorder -c release` — no signing, no Python, no MLX. Fast (~2 min) and free on GitHub's hosted runners.
