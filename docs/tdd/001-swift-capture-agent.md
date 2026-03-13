# TDD-001: Swift Capture Agent

## 1. Overview

This document specifies the design for the Always-On Swift Capture Agent (Phase 1). It is a headless macOS
LaunchAgent that captures screenshots using `SCStream`, deduplicates them using a perceptual hash (pHash), and
writes them to a SQLite database in WAL mode.

## 2. Architecture & File Structure

**Location**: `apps/recorder/` **Language**: Swift 6.0 (macOS 15.0 target minimum)

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
  - `minimumFrameInterval = CMTime(value: 5, timescale: 1)` (5s interval)
  - `pixelFormat = kCVPixelFormatType_32BGRA`
- **Concurrency**: `@MainActor` class, `sampleHandlerQueue: .main`, `nonisolated(unsafe) let` for
  `CMSampleBuffer` to cross isolation boundary cleanly.
- **Multi-display**: Creates one `SCStream` per display, keyed by `CGDirectDisplayID` (to be robust across
  display reconnects, per ADR-009 Phase B learnings).

### 3.2 pHash Deduplication (`PHash.swift`)

- **Algorithm**: DCT-based pHash.
  - Resize to 32x32 grayscale.
  - 2D DCT via vDSP.
  - Extract top-left 8x8.
  - Median of 64 values -> 64-bit UInt64 hash.
- **Threshold**: Skip frame if `(currentHash ^ prevHash).nonzeroBitCount <= 8`.

### 3.3 Database & Storage (`DB.swift`)

- **Frames Location**: `~/.escribano/frames/{YYYY-MM-DD}/{timestamp}_{displayId}.jpg`
- **SQLite Location**: `~/.escribano/escribano.db`
- **WAL Mode Constraints**:
  - `PRAGMA journal_mode = WAL;`
  - `PRAGMA busy_timeout = 5000;`
  - `PRAGMA wal_autocheckpoint = 1000;`

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

### 3.5 Backpressure

- **Mechanism**: Query `SELECT COUNT(*) FROM frames WHERE analyzed = 0`.
- **Frequency**: Check every 10 frames (~50 seconds) to avoid DB spam.
- **Limits**:
  - _High-water mark_: 500 frames. Pause capture (`stream.stopCapture()`).
  - _Low-water mark_: 100 frames. Resume capture (`stream.startCapture()`).

## 4. CLI Commands (Node.js Side)

Added to `src/index.ts` via routing commands:

### 4.1 `escribano recorder install`

- Compiles Swift binary: `cd apps/recorder && swift build -c release`.
- Generates LaunchAgent Plist: `~/Library/LaunchAgents/com.escribano.capture.plist`.
- Plist contents: `RunAtLoad=true`, `KeepAlive=true`, `ProgramArguments=[<path_to_binary>]`.
- Executes: `launchctl load ...`

### 4.2 `escribano recorder status`

- Checks if LaunchAgent is running.
- Reports pending frames: `SELECT count(*) FROM frames WHERE analyzed=0`.
- Reports disk usage of `~/.escribano/frames/`.

## 5. Test Specs

- **Unit Tests (Swift)**:
  - Test `PHash.compute()` produces consistent output for identical images.
  - Test backpressure state machine transitions correctly.
- **Integration (Node)**:
  - Test `recorder install` correctly templates the plist and detects missing Swift compiler toolchain.
