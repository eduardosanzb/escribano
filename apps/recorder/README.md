# Escribano Recorder

## Overview

The Escribano Recorder is a Swift package that runs as a macOS LaunchAgent to continuously capture
screen activity in the background. It uses ScreenCaptureKit to sample frames at ~1-second intervals,
deduplicates visually identical frames using perceptual hashing, and pipelines them through a Python
VLM bridge for frame-level description and LLM-based session aggregation — all without user
intervention.

## Architecture

Three concurrent async Tasks run in parallel after startup, coordinated by one shared actor:

1. **`StreamCapture`** (`@MainActor`) — Uses ScreenCaptureKit `SCStream` to capture frames at ~1s
   intervals. Applies pHash dedup (Hamming distance threshold=4) to skip visually identical frames.
   Writes accepted frames to the `frames` table via `FrameStore`.

2. **`FrameAnalyzer`** (actor) — Polls the `frames` table for unanalyzed frames, sends batches to
   the Python VLM bridge over a Unix socket, and writes per-frame descriptions (`vlm_description`,
   `activity_type`, `apps`, `topics`) to the `observations` table via `ObservationStore`.

3. **`SessionAggregator`** (actor) — Polls the `observations` table for rows not yet assigned to a
   topic block (`tb_id IS NULL`), sends them to the Python text bridge (same Unix socket) for LLM
   grouping, and creates `topic_blocks` rows via `TopicBlockStore`.

Additionally:

- **1 shared `WorkQueue`** (actor) — Serializes all bridge calls between `FrameAnalyzer` and
  `SessionAggregator`. Because VLM frame inference and LLM text generation share the same Python
  socket, all requests are queued through this actor with a priority mechanism to prevent
  starvation.

- **3 SQLite connections** — One per component (WAL mode enables concurrent reads alongside
  the single writer, avoiding lock contention between the three tasks).

- **1 `Backpressure` controller** — Monitors the count of pending (unanalyzed) frames and
  pauses/resumes `StreamCapture` when the count crosses the `HIGH_WATER` (500) and `LOW_WATER`
  (100) thresholds.

### Dataflow

```
ScreenCaptureKit
     ↓ frames (~1/s, pHash dedup)
 StreamCapture ──→ frames table (FrameStore)
                         ↓ (analyzed=0)
                   FrameAnalyzer ──→ Python VLM Bridge (Unix socket)
                         ↓ vlm_description, activity_type, apps, topics
                   observations table (ObservationStore)
                         ↓ (tb_id IS NULL)
                   SessionAggregator ──→ Python Text Bridge (same socket)
                         ↓ grouped TopicBlocks
                   topic_blocks table (TopicBlockStore)
```

## File Reference

| File | Description |
|------|-------------|
| `main.swift` | NSApplication delegate; wires up 3 tasks, 1 WorkQueue, and 3 SQLite connections |
| `StreamCapture.swift` | `@MainActor` SCStream capture loop with pHash dedup |
| `FrameAnalyzer.swift` | Actor; polls frames table and drives VLM inference loop |
| `SessionAggregator.swift` | Actor; polls observations table, drives LLM grouping, creates TopicBlocks |
| `Backpressure.swift` | `@MainActor` pause/resume based on pending frame count thresholds |
| `WorkQueue.swift` | Actor priority queue serializing all Python bridge calls |
| `PHash.swift` | vDSP-accelerated DCT perceptual hash for frame deduplication |
| `PythonBridge.vlm.adapter.swift` | Implements `VLMInferenceService` + `TextGenerationService` over Unix socket |
| `FrameStore.port.swift` | Protocol + types for frame persistence |
| `FrameStore.sqlite.adapter.swift` | `SQLiteFrameStore` (class, synchronous SQLite C API) |
| `ObservationStore.port.swift` | Protocol + types for observation persistence |
| `ObservationStore.sqlite.adapter.swift` | `SQLiteObservationStore` (actor, async SQLite C API) |
| `TopicBlockStore.port.swift` | Protocol for TopicBlock persistence |
| `TopicBlockStore.sqlite.adapter.swift` | `SQLiteTopicBlockStore` (actor) |
| `VLMInferenceService.port.swift` | Protocol for VLM frame inference |
| `TextGenerationService.port.swift` | Protocol for text generation |
| `Logger.swift` | Global `log()` function (timestamps to stdout) |
| `Prompts.swift` | VLM batch prompt template |
| `ResponseParser.swift` | Parses VLM NDJSON output |

## Configuration

All settings are read from environment variables at startup. When installed as a LaunchAgent, these
are injected into the plist by `npx escribano recorder install`. If you change values in
`~/.escribano/.env`, re-run `recorder install` for the changes to take effect.

| Variable | Default | Description |
|---|---|---|
| `ESCRIBANO_ANALYZE_BATCH_SIZE` | `5` | Frames per VLM batch |
| `ESCRIBANO_CAPTURE_HIGH_WATER` | `500` | Pause capture above this pending frame count |
| `ESCRIBANO_CAPTURE_LOW_WATER` | `100` | Resume capture below this pending frame count |
| `ESCRIBANO_PHASH_THRESHOLD` | `4` | Hamming distance threshold for pHash dedup |
| `ESCRIBANO_TB_POLL_INTERVAL` | `120` | Seconds between SessionAggregator polls |
| `ESCRIBANO_TB_MIN_OBSERVATIONS` | `3` | Minimum observations to trigger aggregation |
| `ESCRIBANO_TB_MAX_OBS_PER_CYCLE` | `300` | Max observations per aggregation cycle |
| `ESCRIBANO_TB_LLM_BATCH_SIZE` | `100` | Observations per LLM sub-batch |
| `ESCRIBANO_QUEUE_REALTIME_STREAK` | `10` | Max consecutive realtime tasks before a normal task runs |
| `ESCRIBANO_SESSION_GAP_THRESHOLD` | (removed) | Removed — was used for gap-based windowing, no longer needed |
| `ESCRIBANO_PYTHON_PATH` | auto | Python executable used to launch the bridge |
| `ESCRIBANO_MLX_RECORDER_SOCKET` | `/tmp/escribano-recorder-vlm.sock` | Unix socket path for Python bridge |

## Build & Run

```bash
# From project root — release build
swift build -c release --package-path apps/recorder

# Dev mode (builds and runs the binary directly, via pnpm script)
pnpm recorder:dev

# Install as a LaunchAgent (runs DB migrations + installs plist, registers with launchctl)
npx escribano recorder install

# Check agent status (pending frames, disk usage, agent state)
npx escribano recorder status
```

> **TCC permission note:** Screen recording permission is granted to the terminal or app used to
> run the binary. In dev mode, grant permission to Terminal.app — it persists across rebuilds.
> For the LaunchAgent (installed via `recorder install`), grant permission to the `escribano`
> binary itself after the first launch.

## Data Flow Detail

### 1. Capture (`StreamCapture`)

`SCStream` delivers `CMSampleBuffer` frames on the main actor at ~1-second intervals. Each frame is
converted to a JPEG (quality 85) and compared against the previous frame's pHash. If the Hamming
distance is ≤ `ESCRIBANO_PHASH_THRESHOLD` (default 4), the frame is discarded as visually
identical. Accepted frames are written to `~/.escribano/frames/{YYYY-MM-DD}/{timestamp}_{displayId}.jpg`
and inserted into the `frames` table with `analyzed=0`.

`Backpressure` checks the pending frame count every 10 captures and signals `StreamCapture` to
pause when the count exceeds `HIGH_WATER`, resuming when it drops below `LOW_WATER`.

### 2. VLM Analysis (`FrameAnalyzer`)

`FrameAnalyzer` wakes on a timer and claims a batch of up to `ESCRIBANO_ANALYZE_BATCH_SIZE` frames
(rows where `analyzed=0`). It sends them as a batch to the Python VLM bridge over a Unix socket.
The bridge runs `mlx-vlm` and streams back NDJSON — one JSON object per frame — parsed by
`ResponseParser`. Each result is written to the `observations` table with `vlm_description`,
`activity_type`, detected `apps`, and `topics`.

All bridge calls are routed through `WorkQueue` to serialize access to the shared Unix socket.

### 3. Session Aggregation (`SessionAggregator`)

`SessionAggregator` wakes every `ESCRIBANO_TB_POLL_INTERVAL` seconds (default 120s). It queries
observations where `tb_id IS NULL`, requires at least `ESCRIBANO_TB_MIN_OBSERVATIONS` rows, and
processes up to `ESCRIBANO_TB_MAX_OBS_PER_CYCLE` per cycle in sub-batches of
`ESCRIBANO_TB_LLM_BATCH_SIZE`. Sub-batches are sent to the same Python bridge (text generation
mode) to produce grouped `TopicBlock` records, which are written to the `topic_blocks` table.
Each processed observation is updated with the resulting `tb_id`.

On startup, `SessionAggregator` performs a backfill pass to claim any historical unclaimed
observations from previous runs.

## Common Issues & Dev Notes

### PythonBridge not started — call start() first

**Symptom:** `[SessionAggregator] text_infer failed for sub-batch: PythonBridge not started`

**Cause:** The SessionAggregator task starts before the VLM bridge has finished loading. The Python
bridge takes 30-120s to load the model on first run, but `isStarted` is only set to `true` after
`start()` completes.

**Fix:** Ensure `main.swift` awaits `vlmService.start()` before creating the `SessionAggregator`
task. The bridge must be fully ready before any component tries to use it.

```swift
// In main.swift: wait for bridge to be ready
self.analyzerTask = Task {
    try await analyzer.start()  // This blocks until bridge ready
    await analyzer.analyzeLoop()
}
// Wait here before starting aggregator
try await vlmService.start()
```

### FOREIGN KEY constraint failed (SQLITE_CONSTRAINT=19)

**Symptom:** `[ObservationStore] claimObservations FAILED rc=19: FOREIGN KEY constraint failed`

**Cause:** The `observations.tb_id` column has a foreign key constraint referencing
`topic_blocks(id)`. When creating TopicBlocks, the parent row must exist in `topic_blocks` before
children can reference it in `observations`.

**Fix:** Always save the TopicBlock to the database **before** claiming observations for it:

```swift
// CORRECT order:
let tb = createTopicBlock(...)
try await tbStore.save(tb)  // Insert parent first
try await obsStore.claimObservations(ids: obsIds, tbId: tb.id)  // Then link children
```

The fallback path in SessionAggregator previously had these reversed, causing FK violations when
the LLM grouping failed and fallback TopicBlocks were created.

### Race conditions with shared bridge

Both `FrameAnalyzer` and `SessionAggregator` use the same `PythonBridgeVLMAdapter` instance. The
bridge is an actor that serializes calls, but if `isStarted` is false, calls fail immediately.

**Solution:** The `WorkQueue` actor wraps all bridge calls and ensures proper ordering. Make sure
the bridge is started before any tasks begin submitting work to the queue.

### Schema version mismatches

If you see errors like "Database schema out of date (version X, expected Y)", run:

```bash
npx escribano recorder install
```

This applies pending migrations and regenerates the LaunchAgent plist.
