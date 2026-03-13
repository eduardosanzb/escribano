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
    ├── main.swift             # Entry point, daemon lifecycle, lock/backpressure check
    ├── StreamCapture.swift    # SCStream Output delegate, manages screen capture
    ├── PHash.swift            # vDSP-accelerated DCT pHash algorithm
    ├── DB.swift               # SQLite connection (using C-API or lightweight wrapper)
    └── Backpressure.swift     # High-water/low-water mark logic
```

## 3. Core Components

### 3.1 ScreenCaptureKit Stream (`StreamCapture.swift`)

- **API**: `SCStream`
- **Configuration**:
  - `minimumFrameInterval = CMTime(value: 1, timescale: 1)` (1s interval, capped by pHash dedup)
    - Default is 1s to avoid missing high-activity frames. **The true throttle is pHash deduplication** (§3.2): frames within a hamming distance of 8 bits are skipped before reaching the DB, so visually identical frames are automatically discarded. Backpressure (§3.5) then pauses/resumes the capture stream based on unanalyzed frame count, not a fixed interval. This design captures high-frequency activity while automatically filtering noise.
  - `pixelFormat = kCVPixelFormatType_32BGRA`
    - A 32-bit pixel format where each pixel is stored as Blue, Green, Red, Alpha (4 bytes, in that order). ScreenCaptureKit delivers frames natively in this format on Apple Silicon, so we use it directly to avoid a pixel format conversion step. The raw pixel buffer feeds directly into the pHash DCT pipeline (which converts to grayscale internally), minimizing CPU overhead before deduplication.
- **Concurrency**: `@MainActor` class, `sampleHandlerQueue: .main`, `nonisolated(unsafe) let` for
  `CMSampleBuffer` to cross isolation boundary cleanly.
- **Multi-display**: Creates one `SCStream` per display, keyed by `CGDirectDisplayID` (to be robust across
  display reconnects, per ADR-009 Phase B learnings).

### 3.2 pHash Deduplication (`PHash.swift`)

**Rationale**: Perceptual hashing identifies near-duplicate frames across the 1-second capture interval. From ADR-009 Phase C (docs/SCREENCAPTUREKIT-POC-SPIKE.md), empirical testing across 6 real-world scenarios (IDLE, clock ticks, cursor blinks, mouse movement, typing, window switches) showed that pHash with threshold ≤ 8 **cleanly separates noise from meaningful visual changes**: noise produces hamming distances of 0–4 bits, while real activity produces 10+ bits, leaving a clean margin. Alternative deduplication methods were evaluated and rejected:
- **dHash**: Blind to localized digit changes (e.g., clock changing 10:00 → 10:01), unsuitable for time-aware analysis.
- **VN FeaturePrint** (Vision.framework): Adds 4.5–6.5ms overhead per frame at 1fps, too heavy for real-time capture.
- **SCFrameStatus**: Only fires ~1% of frames at 1fps, unreliable for sparse capture.

**Algorithm**: DCT-based pHash.
  - Resize frame to 32×32 grayscale.
  - Compute 2D DCT via vDSP (Accelerate.framework).
  - Extract top-left 8×8 DCT coefficients (64 values).
  - Median of 64 values → 64-bit UInt64 hash.

**Threshold**: Skip frame if `(currentHash ^ prevHash).nonzeroBitCount <= 8`.

**Libraries evaluated** (Feb 2026 survey):
- **SwiftImageHash** (9★, github.com/Eastwilding/swiftimagehash, last commit May 2024) — Pure Swift pHash implementation. **Blocker**: UIKit dependency (`import UIImage`), making it unsuitable for headless macOS daemons.
- **CocoaImageHashing** (262★, github.com/ameingast/cocoaimagehashing, archived Sep 2021) — Objective-C framework with aHash/dHash/pHash. **Blockers**: Archived, no Swift 6 concurrency support, heavyweight Objective-C patterns.

No actively maintained, headless-compatible Swift pHash libraries exist.

**Implementation**: The Escribano POC already contains a production-ready `PHash.swift` implementation (`scripts/poc-phash-dedup/Sources/PHash.swift`) using vDSP-accelerated DCT:
- Caches vDSP DCT setup (expensive to create per call)
- Implements full 32×32 → 8×8 DCT pipeline (2D: row-wise + column-wise passes)
- Computes median of 64 low-frequency coefficients
- Returns UInt64 hash with bit[i] = 1 if coefficient[i] > median
- **Why reuse**: Already empirically validated (Phase C), uses no external deps, minimal maintenance burden.

**Why DIY over libraries**: Accelerate.framework is available in all macOS distributions (zero extra dependencies). The vDSP DCT approach is hardware-accelerated on Apple Silicon. Library maintenance burden isn't worth the small codebase (~100 LOC total).

### 3.3 Database & Storage (`DB.swift`)

- **Frames Location**: `~/.escribano/frames/{YYYY-MM-DD}/{timestamp}_{displayId}.jpg`
- **SQLite Location**: `~/.escribano/escribano.db`
- **WAL Mode Configuration** (matches Node.js `src/db/index.ts:42-45`):
  - `PRAGMA journal_mode = WAL;` — Write-Ahead Logging mode allows concurrent reads while writes are in progress. Reduces lock contention between the capture agent (writer) and the analyzer (reader).
  - `PRAGMA synchronous = NORMAL;` — Less strict fsync behavior (vs FULL). Balances durability against write performance; acceptable for a single-machine local DB. **Source**: Node.js side already sets this; Swift agent must match to avoid conflicting pragma states.
  - `PRAGMA foreign_keys = ON;` — Enforces referential integrity (frames → observations relationships). **Source**: Node.js side already sets this; Swift agent must match.
  - `PRAGMA busy_timeout = 5000;` — 5-second timeout for lock contention. Default is 0 (immediate failure). 5s allows the analyzer to complete a batch and release locks without causing the capture agent to stall.
  - **WAL autocheckpoint**: Left at SQLite default (`PRAGMA wal_autocheckpoint = 1000 pages`, ~4MB WAL file size). Do **not** explicitly set in Swift agent. **Rationale**: (1) Node.js side doesn't set it (uses default), (2) 1000 WAL pages = ~4MB on disk, which at ~200 bytes per frame metadata means checkpoint occurs every ~20,000 frame inserts (~5.5 hours at 1fps). The default is reasonable for this workload.

### 3.4 Database Migration (014)

To be added to Node.js `src/db/migrations/014_recorder_frames.sql`:

```sql
CREATE TABLE frames (
  id                    TEXT PRIMARY KEY,
  display_id            TEXT NOT NULL,
  captured_at           TEXT NOT NULL,        -- ISO 8601
  timestamp             REAL NOT NULL,        -- Unix epoch
  image_path            TEXT NOT NULL,
  phash                 TEXT,                 -- Hex string representation
  width                 INTEGER,
  height                INTEGER,
  analyzed              INTEGER DEFAULT 0,    -- 0=pending, 1=complete, 2=failed
  processing_lock_id    TEXT,
  processing_started_at TEXT,
  retry_count           INTEGER DEFAULT 0,
  failed_at             TEXT,
  created_at            TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_frames_analyzed ON frames(analyzed);
CREATE INDEX idx_frames_captured ON frames(timestamp);
CREATE INDEX idx_frames_processing ON frames(processing_lock_id);
```

**Migration Bootstrap Strategy**:

The Swift capture agent cannot run migrations (no Node.js runtime). To prevent the agent from running against a stale schema:

1. **On startup**, the agent queries `PRAGMA user_version` from the SQLite database.
2. **If version is below expected**, the agent logs an error: `"Database schema out of date. Run 'escribano recorder install' from Node.js."` and exits with code 1.
3. **LaunchAgent plist** has `KeepAlive=true`, so launchd will retry the agent every few seconds, but it will keep failing until the user runs `escribano recorder install` from the Node.js side (which triggers all pending migrations).
4. **This makes the dependency explicit and observable**: the agent will not silently corrupt data on a stale schema.

At installation time (`escribano recorder install`), the Node.js CLI ensures that all migrations have been applied before starting the LaunchAgent.

### 3.5 Backpressure

- **Mechanism**: Query `SELECT COUNT(*) FROM frames WHERE analyzed = 0` to count pending frames.
- **Frequency**: Check every 10 frames (~10 seconds at 1fps) to avoid DB spam and excessive state transitions.
- **Configurable Thresholds** (environment variables):
  - `ESCRIBANO_CAPTURE_HIGH_WATER` (default: 500 frames) — Stop capturing (`stream.stopCapture()`).
  - `ESCRIBANO_CAPTURE_LOW_WATER` (default: 100 frames) — Resume capturing (`stream.startCapture()`).
  
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

- Compiles Fotógrafo binary: `cd apps/recorder && swift build -c release`.
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
- Reports disk usage of `~/.escribano/frames/`. _review_note: AMAZING IDEA!_

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
