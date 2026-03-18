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
