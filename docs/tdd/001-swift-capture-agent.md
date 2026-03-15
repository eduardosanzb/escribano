# TDD-001: Fotógrafo Capture Agent

## 1. Overview

This document specifies the design for the Always-On Swift Capture Agent (Phase 1), codenamed **Fotógrafo** (The Photographer). It is a headless macOS LaunchAgent that captures screenshots using `SCStream`, deduplicates them using a perceptual hash (pHash), and writes them to a SQLite database in WAL mode.

## 2. Architecture & File Structure

**Location**: `apps/recorder/` **Language**: Swift 6.0 (macOS 14.0 minimum deployment target)

_Rationale_: macOS 14 (Sonoma) covers ~80% of Mac users (Statcounter, early 2024) and provides all essential ScreenCaptureKit APIs. `SCStream` has been available since macOS 12.3, so we are not limited by version constraints on the core capture API. macOS 15-only features (`SCContentSharingPicker`, HDR capture, monthly privacy prompts) are non-blocking enhancements and can be adopted via `@available` checks in a future iteration without compromising MVP functionality.

```
apps/recorder/
├── Package.swift
└── Sources/
    ├── main.swift             # Entry point, NSApplication lifecycle, multi-display support
    ├── StreamCapture.swift    # SCStream Output delegate, manages screen capture per display
    ├── PHash.swift            # vDSP-accelerated DCT pHash algorithm
    ├── FrameStore.swift       # Port protocol (FrameStore, FrameMetadata, FrameStoreError)
    ├── SQLiteFrameStore.swift # Adapter implementation using SQLite C API
    └── Backpressure.swift     # High-water/low-water mark logic (uses FrameStore protocol)
```

## 3. Core Components

### 3.1 ScreenCaptureKit Stream (`StreamCapture.swift`)

- **API**: `SCStream`
- **Configuration**:
  - `minimumFrameInterval = CMTime(value: 1, timescale: 1)` (1s interval, capped by pHash dedup)
    - Default is 1s to avoid missing high-activity frames. **The true throttle is pHash deduplication** (§3.2): frames within a hamming distance of 4 bits are skipped before reaching the DB, so visually identical frames are automatically discarded. Backpressure (§3.5) then pauses/resumes the capture stream based on unanalyzed frame count, not a fixed interval. This design captures high-frequency activity while automatically filtering noise.
  - `pixelFormat = kCVPixelFormatType_32BGRA`
    - A 32-bit pixel format where each pixel is stored as Blue, Green, Red, Alpha (4 bytes, in that order). ScreenCaptureKit delivers frames natively in this format on Apple Silicon, so we use it directly to avoid a pixel format conversion step. The raw pixel buffer feeds directly into the pHash DCT pipeline (which converts to grayscale internally), minimizing CPU overhead before deduplication.
- **Concurrency**: `@MainActor` class, `sampleHandlerQueue: .main`, `nonisolated(unsafe) let` for
  `CMSampleBuffer` to cross isolation boundary cleanly.
- **Multi-display**: Creates one `SCStream` per display, keyed by `CGDirectDisplayID` (to be robust across
  display reconnects, per ADR-009 Phase B learnings). **Implemented in Phase 1.**

### 3.2 pHash Deduplication (`PHash.swift`)

**Rationale**: Perceptual hashing identifies near-duplicate frames across the 1-second capture interval. From ADR-009 Phase C (docs/SCREENCAPTUREKIT-POC-SPIKE.md), empirical testing across 6 real-world scenarios (IDLE, clock ticks, cursor blinks, mouse movement, typing, window switches) showed that pHash with threshold ≤ 8 cleanly separates noise from meaningful visual changes. **Update (v2)**: Real-world testing with the Phase 1 agent showed that the original threshold of 8 was too aggressive for low-contrast UI changes (e.g., Raycast opening on a dark background produced 6 bits). The default has been tuned to **4 bits** for better sensitivity to subtle but meaningful changes.

**Threshold**: Skip frame if `(currentHash ^ prevHash).nonzeroBitCount <= ESCRIBANO_PHASH_THRESHOLD` (default: 4).

**Debug Logging**: When `ESCRIBANO_DEBUG_PHASH=true`, the agent logs every hamming distance comparison and prints rolling statistics every 100 frames.

**Implementation**: The Escribano POC already contains a production-ready `PHash.swift` implementation (`scripts/poc-phash-dedup/Sources/PHash.swift`) using vDSP-accelerated DCT:
- Caches vDSP DCT setup (expensive to create per call)
- Implements full 32×32 → 8×8 DCT pipeline (2D: row-wise + column-wise passes)
- Computes median of 64 low-frequency coefficients
- Returns UInt64 hash with bit[i] = 1 if coefficient[i] > median

### 3.3 Database & Storage (`FrameStore.swift`, `SQLiteFrameStore.swift`)

- **Architecture**: Follows the Escribano Port/Adapter pattern. `FrameStore` protocol defines the interface, while `SQLiteFrameStore` provides the implementation using the SQLite C API. This decouples the capture logic from the storage engine.
- **Frames Location**: `~/.escribano/frames/{YYYY-MM-DD}/{timestamp}_{displayId}.jpg`
- **Frame Format**: JPEG at quality 85. Balances file size (~50-100 KB/frame at 1024px width) with text fidelity for future OCR. Lossy compression is acceptable for VLM analysis (models are robust to mild artifacts) and keeps storage manageable (~200-500 MB/day before cleanup).
- **SQLite Location**: `~/.escribano/escribano.db`
- **WAL Mode Configuration** (matches Node.js `src/db/index.ts:42-45`):
  - `PRAGMA journal_mode = WAL;` — Write-Ahead Logging mode allows concurrent reads while writes are in progress. Reduces lock contention between the capture agent (writer) and the analyzer (reader).
  - `PRAGMA synchronous = NORMAL;` — Less strict fsync behavior (vs FULL). Balances durability against write performance; acceptable for a single-machine local DB. **Source**: Node.js side already sets this; Swift agent must match to avoid conflicting pragma states.
  - `PRAGMA foreign_keys = ON;` — Enforces referential integrity (frames → observations relationships). **Source**: Node.js side already sets this; Swift agent must match.
  - `PRAGMA busy_timeout = 5000;` — 5-second timeout for lock contention. Default is 0 (immediate failure). 5s allows the analyzer to complete a batch and release locks without causing the capture agent to stall.

### 3.5 Backpressure

- **Mechanism**: Query `SELECT COUNT(*) FROM frames WHERE analyzed = 0` via the `FrameStore` interface to count pending frames.
- **Frequency**: Check every 10 frames (~10 seconds at 1fps) to avoid DB spam and excessive state transitions.
- **Configurable Thresholds** (environment variables):
  - `ESCRIBANO_CAPTURE_HIGH_WATER` (default: 500 frames) — Stop capturing (`stream.stopCapture()`).
  - `ESCRIBANO_CAPTURE_LOW_WATER` (default: 100 frames) — Resume capturing (`stream.startCapture()`).

## 5. Resource Usage (Baseline)

Validated on MacBook Pro M4 Max (128GB RAM):
- **Memory**: ~34MB RAM
- **CPU**: ~1.6% (single core)

Extrapolated for M1 Air (16GB RAM):
- **Memory**: ~34MB RAM
- **CPU**: ~2.5-3.5%

  
- **Default Sizing Rationale**:
  - **High-water: 500 frames** — ~25–50 MB unanalyzed (at typical JPEG compression ~50–100 KB/frame). Signals analyzer is falling behind without risking OOM.
  - **Low-water: 100 frames** — ~5–10 MB, comfortable operating point. Hysteresis gap (500→100) prevents thrashing on/off near a single threshold.
  - **Why these numbers**: Analyzer runs every 2 minutes (Phase 2 LaunchAgent `StartInterval=120`). At 1fps, 2 minutes = 120 frames captured. A high-water of 500 means the analyzer can miss 4+ runs before backpressure triggers. Conservative for MVP.
  
- **Configuration at runtime**: Set environment variables before starting the LaunchAgent:
  ```bash
  # For low-RAM systems (e.g., 16GB), reduce high-water mark
  export ESCRIBANO_CAPTURE_HIGH_WATER=250
  export ESCRIBANO_CAPTURE_LOW_WATER=50
  # Then run: escribano recorder install
  ```
  
- **Monitoring**: Use `escribano recorder status` to check real-time pending frame count and see if backpressure is active.

## 4. CLI Commands (Node.js Side)

Added to `src/index.ts` via routing commands:

### 4.1 `escribano recorder install`

- **Prerequisite check**: Verifies `swift` is in PATH. If missing, prints:
  ```
  Error: Swift toolchain not found.
  Install Xcode Command Line Tools: xcode-select --install
  ```
  and exits with code 1.

- **Build step**: Compiles Fotógrafo binary: `cd apps/recorder && swift build -c release`.
  - The first `swift build -c release` takes 30-60 seconds (subsequent builds are incremental). The CLI shows a progress indicator before invoking the build:
  ```
  console.log('Compiling Fotógrafo (this may take a minute)...')
  ```
- Generates LaunchAgent Plist: `~/Library/LaunchAgents/com.escribano.capture.plist`.
- Plist contents: `RunAtLoad=true`, `KeepAlive=true`, `ProgramArguments=[<path_to_fotografo_binary>]`.
- Executes: `launchctl load ...`

**Scope (MVP — Dev Mode)**:
This implementation is a development-mode solution suitable for open-source users with Xcode toolchain installed (`swift` available in PATH). The Node.js CLI compiles from source via `swift build -c release`.

**Production Path (Deferred)**:
A production installer would ship a pre-compiled universal binary (ARM64 + x86_64) via one of:
- **Signed `.pkg` installer**: Distributes the binary with auto-updates.
- **npm `postinstall` script**: Runs on `npm install`, downloads pre-built binary from GitHub Releases.

This requires: code signing, binary hosting, update mechanics, and clean uninstall (removing LaunchAgent plist). These are deferred to a later phase. For MVP, requiring Xcode is acceptable.

### 4.2 `escribano recorder status`

- Checks if LaunchAgent is running.
- Reports pending frames: `SELECT count(*) FROM frames WHERE analyzed=0`.
- Reports disk usage of `~/.escribano/frames/`.

## 5. Test Specs

- **Unit Tests (Swift)**:
  - Test `PHash.compute()` produces consistent output for identical images.
  - Test backpressure state machine transitions correctly.
- **Integration (Node)**:
  - Test `recorder install` correctly templates the plist, finds Fotógrafo binary, and detects missing Swift compiler toolchain.

## 6. Naming

**Fotógrafo** (The Photographer) continues Escribano's Spanish naming theme:
- **Escribano** (The Scribe) — captures and transcribes work sessions
- **Fotógrafo** (The Photographer) — photographs (captures visually) screen activity

This naming is consistent, thematic, and human-readable across the CLI (`escribano recorder`, `fotógrafo` binary).
