# TDD-001: Escribano Recorder Capture Agent

## 1. Overview

This document specifies the design for the Always-On Swift Capture Agent (Phase 1). It is a headless macOS LaunchAgent that captures screenshots using `SCStream`, deduplicates them using a perceptual hash (pHash), and writes them to a SQLite database in WAL mode.

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

- **Build step**: Compiles escribano-recorder binary: `cd apps/recorder && swift build -c release`.
  - The first `swift build -c release` takes 30-60 seconds (subsequent builds are incremental). The CLI shows a progress indicator before invoking the build:
  ```
  console.log('Compiling escribano-recorder (this may take a minute)...')
  ```
- Generates LaunchAgent Plist: `~/Library/LaunchAgents/com.escribano.capture.plist`.
- Plist contents: `RunAtLoad=true`, `KeepAlive=true`, `ProgramArguments=[<path_to_escribano_binary>]`.
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
   - Test `recorder install` correctly templates the plist, finds escribano binary, and detects missing Swift compiler toolchain.

## 6. Naming

The capture agent binary is named **`escribano`** (same as the CLI tool), keeping the surface area simple. The original codename **Fotógrafo** (The Photographer) was used during design but dropped to avoid confusion — users interact with a single `escribano` command for everything:

- `escribano recorder install` — build and register the background capture agent
- `escribano recorder status` — inspect agent state and pending frame count

---

## 7. Phase 2: VLM Analysis (Swift-Native Visual Intelligence)

**Status:** Defined in ADR-010  
**Supersedes:** TDD-002 (Node Batch Analyzer)

Phase 2 extends the capture agent to include **in-process VLM inference**. Instead of a separate Node.js analyzer polling the database (TDD-002), VLM runs as a second async task within the same Swift process.

### 7.1 Architecture

**Single process, two concurrent async tasks:**

```
┌────────────────────────────────────────┐
│  Capture Agent (Swift, single binary)  │
├────────────────────────────────────────┤
│  Task 1: StreamCapture    Task 2: VLMAnalyzer
│  (existing)               (new)
│                                        │
│  • Capture frames 1s       • Poll frames table
│  • pHash dedup             • Claim batch
│  • Backpressure check ◄─────► Run VLM
│  • Write JPEGs + DB        • Parse response
│                            • Write observations
└────────────────────────────────────────┘
         │
         ▼
    SQLite database
    (no process_locks needed — single process)
```

### 7.2 New Files

```
apps/recorder/Sources/
├── VLMAnalyzer.swift              # NEW: Async task for VLM analysis
├── VLMRunner.swift                # ENHANCED: From POC with batch + decoupled parsing
├── ResponseParser.swift           # NEW: Parse "Frame N: description: X | activity: Y | ..." format
├── ObservationStore.swift         # NEW: Port protocol for observations DB access
├── SQLiteObservationStore.swift  # NEW: SQLite adapter for ObservationStore
└── ... (other existing files)
```

### 7.3 Package.swift Dependency

Add `mlx-swift-lm` for native VLM inference (same POC dependency):

```swift
let package = Package(
    name: "escribano-recorder",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/ml-explore/mlx-swift.git", .upToNextMinor(from: "0.1.0"))
    ],
    targets: [
        .executableTarget(
            name: "escribano",
            dependencies: [
                .product(name: "MLXVLM", package: "mlx-swift"),
                .product(name: "MLXLMCommon", package: "mlx-swift")
            ],
            path: "Sources",
            linkerSettings: [
                .linkedLibrary("sqlite3")
            ]
        )
    ]
)
```

### 7.4 Process Lifecycle

**main.swift updates:**

```swift
@main
struct EscribanoRecorder {
    static func main() async {
        // 1. Initialize database
        let frameStore = SQLiteFrameStore(dbPath: "~/.escribano/escribano.db")
        let obsStore = SQLiteObservationStore(frameStore: frameStore)
        
        // 2. Load VLM model once (stays in memory)
        let vlmAnalyzer = VLMAnalyzer(obsStore: obsStore)
        try await vlmAnalyzer.loadModel()
        
        // 3. Spawn both async tasks
        async let captureTask = streamCapture(frameStore: frameStore)
        async let analyzeTask = vlmAnalyzer.analyzeLoop()
        
        // 4. Both tasks run concurrently until signal or error
        _ = try await [captureTask, analyzeTask]
    }
}
```

### 7.5 VLMAnalyzer Task

**VLMAnalyzer.swift:**

Implements the continuous analysis loop that:
- Polls the `frames` table for unanalyzed frames (WHERE analyzed = 0)
- Claims a batch (default: 20 frames, configurable via `ESCRIBANO_ANALYZE_BATCH_SIZE`)
- Runs batch VLM inference via enhanced `VLMRunner`
- Parses response via `ResponseParser.parseInterleavedOutput()`
- Inserts observations into DB via `ObservationStore`
- Marks frames as analyzed
- Retries on transient errors; gives up after 3 failures per frame

**Error handling:**
- VLM inference failure: catch at batch level, increment `retry_count`, mark as failed after 3 attempts
- DB insert failure: catch per-frame, leave frame unanalyzed for retry next cycle
- No process-level lock needed (single process)
- Backpressure from capture task prevents runaway frame accumulation

### 7.6 Response Parsing (Decoupled)

**ResponseParser.swift:**

Extracted logic from `intelligence.mlx.adapter.ts:740` (Python bridge parsing), ported to Swift:

- **parseInterleavedOutput()**: Convert "Frame 1: description: X | activity: Y | apps: Z | topics: W" format into structured `FrameDescription[]`
- **normalizeActivity()**: Synonym mapping (debug → debugging, code → coding, etc.)
- **stripThinkingTags()**: Remove `<think>...</think>` tags if present
- **parseList()**: Convert "[app1, app2]" JSON-like format to `[String]`

No coupling to VLM runner — can be tested independently, reused elsewhere.

### 7.7 ObservationStore (Port/Adapter Pattern)

**Port (ObservationStore.swift):**

```swift
protocol ObservationStore: Sendable {
    func claimFrames(batchSize: Int) async throws -> [DbFrame]
    func saveObservations(from frames: [DbFrame], descriptions: [FrameDescription]) async throws
    func markFramesAnalyzed(ids: [String]) async throws
    func markFrameFailed(id: String) async throws
}
```

**Adapter (SQLiteObservationStore.swift):**

Implements `ObservationStore` using SQLite:
- `claimFrames()`: `SELECT * FROM frames WHERE analyzed = 0 LIMIT batchSize`
- `saveObservations()`: `INSERT INTO observations (frame_id, vlm_description, activity_type, apps, topics, ...)`
- `markFramesAnalyzed()`: `UPDATE frames SET analyzed = 1 WHERE id IN (...)`
- `markFrameFailed()`: `UPDATE frames SET retry_count = retry_count + 1, analyzed = 2 WHERE id = ? AND retry_count >= 3`

No locking needed — single process, no concurrent analyzer.

### 7.8 Model Lifecycle

- **Load**: Once at process startup (via `vlmAnalyzer.loadModel()` in main)
- **Lifetime**: Stays in memory (~4GB for Qwen3-VL-4B-Instruct-4bit)
- **Unload**: On process shutdown (implicit via Swift runtime)
- **No reload per batch**: Single model instance shared by VLM analyzer task

Configuration: `ESCRIBANO_VLM_MODEL` (default: `mlx-community/Qwen3-VL-4B-Instruct-4bit`)

### 7.9 Batch Processing

**VLMRunner.swift enhancements:**

- `runBatch(imagePaths: [String], container: ModelContainer) -> [FrameDescription]`
  - Takes pre-loaded model (no reload)
  - Accepts array of frame paths
  - Returns structured descriptions
  - Integrates with `ResponseParser.parseInterleavedOutput()`

Uses same interleaved message format as current Python bridge:
```
Frame 1: [image]
Frame 2: [image]
...
Frame N: [image]
[batch prompt with N substituted]
```

### 7.10 Integration with Capture Task

Both tasks share:
- **Database**: SQLite in WAL mode (concurrent reads by both tasks)
- **Backpressure**: Capture task still checks `SELECT COUNT(*) WHERE analyzed = 0` to pause if analyzer falls behind
- **pHash dedup**: Unaffected; capture task filters before write

No IPC needed — both tasks are in-process async/await.

### 7.11 Configuration

New environment variables (in addition to Phase 1 vars):

| Variable | Description | Default |
|----------|-------------|---------|
| `ESCRIBANO_ANALYZE_BATCH_SIZE` | Frames per VLM batch | `20` |
| `ESCRIBANO_VLM_MODEL` | Model identifier | `mlx-community/Qwen3-VL-4B-Instruct-4bit` |
| `ESCRIBANO_VLM_MODEL_DIR` | Cache directory | `~/.cache/huggingface/hub/...` |

### 7.12 Build & Installation

No change to user workflow:

```bash
npx escribano recorder install    # Builds Swift binary with Phase 2 included
```

The `swift build -c release` step now includes VLM analyzer compilation.

### 7.13 Database Schema

**No `process_locks` table** — single process, no concurrent analyzer risk.

Migration 015 adjusted: remove `process_locks` creation (frames + observations tables unchanged).

### 7.14 Testing

- **Unit Tests (Swift)**:
  - `ResponseParser`: Test parsing of all format variants (description, activity, apps, topics)
  - `ObservationStore` mock: Test frame claiming, observation insertion, mark-analyzed logic
- **Integration (Swift)**:
  - Insert mock frames into DB, trigger analyzer task, verify observations created and frames marked
- **E2E**:
  - Run recorder for 5 minutes, verify observations match expected activities

### 7.15 Dependencies on Phase 1

- ✅ `frames` table with `analyzed` status
- ✅ Backpressure mechanism (already in Phase 1)
- ✅ `observations` table with `frame_id` FK (migration 015)

### 7.16 Comparison: TDD-002 vs ADR-010 Phase 2

| Aspect | TDD-002 (Node Batch Analyzer) | ADR-010 Phase 2 (Swift VLM) |
|--------|--------------------------------|----------------------------|
| Process | Separate Node.js process | In-process Swift task |
| IPC | SQLite job queue + socket to Python bridge | None (async/await) |
| Model lifecycle | Load/unload per batch | Load once, stays in memory |
| Concurrency guard | `process_locks` table + PID checks | None needed (single process) |
| Language | TypeScript | Swift |
| Dependencies | Node runtime, Python bridge | mlx-swift-lm (SPM) |
| Startup | Slow (launchd spawn, new process) | Instant (same process) |
| Memory | ~200MB Node + ~1.5GB Python bridge | ~1.3GB VLM only (17% less) |

---
