# Phase 3a Implementation Plan — SessionAggregator

> **STATUS: IMPLEMENTED (2026-03-22)** — This is a historical plan document. The actual implementation
> diverged in several key ways:
>
> - **Gap-aware windowing (`splitByGap`) was removed** — the LLM prompt handles activity boundaries.
> - **`ESCRIBANO_SESSION_GAP_THRESHOLD` was removed** — no longer needed.
> - **`minObservations` default is 3** (not 5).
> - **`maxObsPerCycle` default is 300** (not 500).
> - **`WorkQueue`** was added to serialize bridge calls between FrameAnalyzer and SessionAggregator.
> - **`FrameStore` / `ObservationStore` protocol split** — frame lifecycle moved to FrameStore.
> - **Thread safety** — `FrameAnalyzer` uses a dedicated `analyzerFrameStore` SQLite connection.
> - **Catch-all TB** — observations not assigned by the LLM are claimed into a catch-all TopicBlock.
>
> For the current implementation, see the actual source files in `apps/recorder/Sources/` and
> the updated documentation in `docs/architecture.md` and `docs/adr/011-continuous-session-aggregation.md`.

---

## Goal

<<<<<<< ours
Add a `SessionAggregator` Swift actor to the recorder daemon that continuously groups analyzed observations
into TopicBlocks using LLM-based semantic grouping via the existing Python bridge. This is Phase 3a of ADR-011
(Continuous Session Aggregation).
=======
Add a `SessionAggregator` Swift actor to the recorder daemon that continuously groups analyzed observations into TopicBlocks using LLM-based semantic grouping via the existing Python bridge. This is Phase 3a of ADR-011 (Continuous Session Aggregation).
>>>>>>> theirs

## Prerequisites

- Phase 2 complete (Python bridge VLM adapter working)
- VLM-as-LLM POC validated (text-only inference via VLM bridge works)
- Current schema version: 16 (`PRAGMA user_version`)

## Architecture Summary

```
Swift Recorder Process
├── Task 1: StreamCapture       (frame producer)
├── Task 2: FrameAnalyzer       (observation producer)
└── Task 3: SessionAggregator   (TopicBlock producer)  ← NEW
                │
                ├── Polls unclaimed observations every TB_POLL_INTERVAL (120s)
                ├── Groups by gap-aware windowing (gap > 20min → new window)
                ├── Sends text-only prompt to Python bridge for semantic grouping
                └── Writes TopicBlocks + claims observations atomically
```

## Key Decisions

<<<<<<< ours
| Decision              | Choice                                    | Rationale                                                                 |
| --------------------- | ----------------------------------------- | ------------------------------------------------------------------------- |
| Sentinel recording    | `id='__recorder__'` in `recordings` table | Avoids recreating `topic_blocks` table to drop NOT NULL on `recording_id` |
| LLM in daemon         | Yes, via existing VLM bridge `text_infer` | VLM-as-LLM POC validated; same process, same model, same socket           |
| Activity segmentation | Skipped                                   | Go directly from observations → LLM grouping                              |
| Max obs per cycle     | 300                                       | Prevents overprocessing large backlogs                                    |
| Migration number      | 017                                       | 016 already exists (`observations_vlm_stats.sql`)                         |
=======
| Decision | Choice | Rationale |
|---|---|---|
| Sentinel recording | `id='__recorder__'` in `recordings` table | Avoids recreating `topic_blocks` table to drop NOT NULL on `recording_id` |
| LLM in daemon | Yes, via existing VLM bridge `text_infer` | VLM-as-LLM POC validated; same process, same model, same socket |
| Activity segmentation | Skipped | Go directly from observations → LLM grouping |
| Max obs per cycle | 500 | Prevents overprocessing large backlogs |
| Migration number | 017 | 016 already exists (`observations_vlm_stats.sql`) |
>>>>>>> theirs

---

## Step 1: Python Bridge — Add `text_infer` Method

### File: `scripts/mlx_bridge.py`

### What

<<<<<<< ours
Add a `text_infer` method handler that reuses the VLM model for text-only generation. The `vlm_infer` handler
already supports `image=None` when no images are in messages, so `text_infer` is a thin wrapper that enforces
text-only mode.
=======
Add a `text_infer` method handler that reuses the VLM model for text-only generation. The `vlm_infer` handler already supports `image=None` when no images are in messages, so `text_infer` is a thin wrapper that enforces text-only mode.
>>>>>>> theirs

### Changes

In `handle_request()` (line ~376), add a new `elif` branch for `"text_infer"`:

```python
# After the existing vlm_infer branch, before load_llm:
elif method == "text_infer":
    # text_infer reuses the VLM model for text-only generation.
    # This works because Qwen3-VL handles text-only prompts natively.
    # We call handle_vlm_infer directly — it already handles image=None
    # when no image paths are in the messages.
    handle_vlm_infer(
        conn, model_obj, processor_obj, config_obj, params, request_id
    )
```

<<<<<<< ours
Also update the mode validation block. Currently `text_infer` would fall through to the "Unknown method" error
in VLM mode. The `text_infer` method should be allowed in **both** VLM and LLM modes (in VLM mode it reuses
the VLM; in LLM mode it could use the LLM — but for now we only need VLM mode):
=======
Also update the mode validation block. Currently `text_infer` would fall through to the "Unknown method" error in VLM mode. The `text_infer` method should be allowed in **both** VLM and LLM modes (in VLM mode it reuses the VLM; in LLM mode it could use the LLM — but for now we only need VLM mode):
>>>>>>> theirs

```python
# Update the mode validation block (~line 388-409):
# Remove the blanket "method not available in X mode" checks for text_infer.
# text_infer should be allowed in VLM mode.
# Keep the existing restrictions for vlm_infer (VLM only) and llm_infer (LLM only).
```

### Verification

```bash
# Manual test: send a text_infer request to the VLM bridge
# The bridge should return generated text without any images
echo '{"id":1,"method":"text_infer","params":{"messages":[{"role":"user","content":"Say hello"}],"maxTokens":100}}' | socat - UNIX-CONNECT:/tmp/escribano-recorder-vlm.sock
```

---

## Step 2: Migration 017 — Schema Changes

### File: `migrations/017_session_aggregation.sql` (NEW)

### What

<<<<<<< ours
Add `tb_id` FK to observations, add time-range columns to topic_blocks, create indexes, and insert the
sentinel recording.

> [!IMPORTANT] backup the current db manually before doing any changes ~/.escribano/escribano.db
=======
Add `tb_id` FK to observations, add time-range columns to topic_blocks, create indexes, and insert the sentinel recording.
>>>>>>> theirs

### SQL

```sql
-- Link observations to their TopicBlock
<<<<<<< ours
ALTER TABLE observations ADD COLUMN tb_id TEXT REFERENCES topic_blocks(id) ON DELETE SET NULL;
=======
ALTER TABLE observations ADD COLUMN tb_id TEXT REFERENCES topic_blocks(id);
>>>>>>> theirs
CREATE INDEX idx_observations_tb ON observations(tb_id);

-- Time-range columns on topic_blocks
ALTER TABLE topic_blocks ADD COLUMN from_ts REAL;
ALTER TABLE topic_blocks ADD COLUMN to_ts REAL;
ALTER TABLE topic_blocks ADD COLUMN observation_count INTEGER DEFAULT 0;

-- Index for time-range queries
CREATE INDEX idx_topic_blocks_time_range ON topic_blocks(from_ts, to_ts);

-- Sentinel recording for recorder-generated TopicBlocks.
-- The topic_blocks table has recording_id NOT NULL, so we use this sentinel
-- instead of recreating the table. Batch pipeline recordings are unaffected.
INSERT OR IGNORE INTO recordings (
    id, video_path, audio_mic_path, audio_system_path,
    duration, captured_at, status, processing_step,
    source_type, source_metadata, error_message
) VALUES (
    '__recorder__', NULL, NULL, NULL,
    0, datetime('now'), 'processed', 'complete',
    'raw', '{"type":"recorder_sentinel"}', NULL
);
```

### Why NOT recreate topic_blocks

SQLite doesn't support `ALTER TABLE ... ALTER COLUMN ... DROP NOT NULL`. We'd need to:
<<<<<<< ours

=======
>>>>>>> theirs
1. Create a new table without the constraint
2. Copy data
3. Drop old table
4. Rename new table

This is risky with existing data. The sentinel recording approach is simpler and safe.

### Verification

After running `npx escribano recorder install` (which triggers migrations):
<<<<<<< ours

=======
>>>>>>> theirs
```sql
PRAGMA user_version;  -- Should be 17
SELECT * FROM recordings WHERE id = '__recorder__';  -- Should return 1 row
SELECT sql FROM sqlite_master WHERE name = 'observations';  -- Should show tb_id column
```

<<<<<<< ours
we should leavea note on the migration and also on the CLAUDE.md and README.md about this syntethci
relationshiop

=======
>>>>>>> theirs
---

## Step 3: Swift — `TextGenerationService` Protocol

### File: `apps/recorder/Sources/TextGenerationService.port.swift` (NEW)

### What

<<<<<<< ours
Define a port protocol for text-only generation, separate from `VLMInferenceService` (which is frame-focused).
The `SessionAggregator` depends on this protocol, not on the concrete `PythonBridgeVLMAdapter`.
=======
Define a port protocol for text-only generation, separate from `VLMInferenceService` (which is frame-focused). The `SessionAggregator` depends on this protocol, not on the concrete `PythonBridgeVLMAdapter`.
>>>>>>> theirs

### Code

```swift
import Foundation

// MARK: - TextGenerationService (Port)
//
// Port interface for text-only generation using the loaded VLM model.
//
// The key insight from the VLM-as-LLM POC: Qwen3-VL handles text-only
// prompts natively. We don't need a separate LLM model — the already-loaded
// VLM can generate text for semantic grouping of observations.
//
// Current adapter: PythonBridgeVLMAdapter — calls mlx_bridge.py text_infer
// over the same Unix socket used for VLM inference.
//
// Why separate from VLMInferenceService?
//   VLMInferenceService deals with frames (DbFrame[], FrameDescription[]).
//   TextGenerationService deals with raw text (String → String).
//   Different concerns, different consumers (FrameAnalyzer vs SessionAggregator).
//   Same underlying adapter can implement both.

protocol TextGenerationService: AnyObject, Sendable {
    /// Generate text from a prompt using the loaded model.
    /// - Parameters:
    ///   - prompt: The text prompt to send
    ///   - maxTokens: Maximum tokens to generate (default: 2000)
    /// - Returns: The generated text response
    func generateText(prompt: String, maxTokens: Int) async throws -> String
}
```

---

## Step 4: Swift — Extend `PythonBridgeVLMAdapter` for Text Generation

### File: `apps/recorder/Sources/PythonBridge.vlm.adapter.swift`

### What

<<<<<<< ours
Make `PythonBridgeVLMAdapter` conform to `TextGenerationService` by adding a `generateText()` method that
sends a `text_infer` request over the same socket.
=======
Make `PythonBridgeVLMAdapter` conform to `TextGenerationService` by adding a `generateText()` method that sends a `text_infer` request over the same socket.
>>>>>>> theirs

### Changes

1. Update the actor declaration to conform to both protocols:

```swift
actor PythonBridgeVLMAdapter: VLMInferenceService, TextGenerationService {
```

2. Add the `generateText` method (after `runBatch`, before `stop`):

```swift
    func generateText(prompt: String, maxTokens: Int = 2000) async throws -> String {
        guard isStarted else {
            throw PythonBridgeError.notStarted
        }
        requestId += 1
        let id = requestId

        let request: [String: Any] = [
            "id": id,
            "method": "text_infer",
            "params": [
                "messages": [["role": "user", "content": prompt]],
                "maxTokens": maxTokens,
            ] as [String: Any],
        ]

        let (rawText, _) = try await sendAndReceive(request: request)
        return rawText
    }
```

### Why this works

- `sendAndReceive` is already implemented and handles the NDJSON protocol
<<<<<<< ours
- `text_infer` on the Python side calls `handle_vlm_infer` which passes `image=None` when no image paths are
  in messages
=======
- `text_infer` on the Python side calls `handle_vlm_infer` which passes `image=None` when no image paths are in messages
>>>>>>> theirs
- Same socket, same model, same process — no extra RAM or startup time

---

## Step 5: Swift — Extend `ObservationStore` Protocol & Adapter

### File: `apps/recorder/Sources/ObservationStore.port.swift`

### What

Add two new methods to the `ObservationStore` protocol:
<<<<<<< ours

=======
>>>>>>> theirs
- `fetchUnclaimed(limit:)` — get observations where `tb_id IS NULL`
- `claimObservations(ids:tbId:)` — atomically set `tb_id` on observations

### Protocol additions

Add to the `ObservationStore` protocol (after `markFrameFailed`):

```swift
    /// Fetch observations not yet claimed by any TopicBlock.
    /// Returns observations ordered by timestamp ASC (oldest first).
    /// Uses frame.captured_at when available for accurate timestamps.
<<<<<<< ours
    /// - Parameter limit: Maximum number of observations to return (default 300)
=======
    /// - Parameter limit: Maximum number of observations to return (default 500)
>>>>>>> theirs
    func fetchUnclaimed(limit: Int) async throws -> [UnclaimedObservation]

    /// Atomically claim observations for a TopicBlock.
    /// Sets tb_id on all observation IDs. Uses WHERE tb_id IS NULL guard
    /// to prevent double-claiming. Returns the count of rows actually updated.
    func claimObservations(ids: [String], tbId: String) async throws -> Int
```

Also add the `UnclaimedObservation` struct (after `DbFrame`):

```swift
/// An observation row enriched with its frame's captured_at timestamp.
/// Used by SessionAggregator for gap-aware windowing.
struct UnclaimedObservation: Sendable {
    let id: String
    let frameId: String?
    let timestamp: Double         // observation.timestamp (Unix epoch seconds)
    let capturedAt: Double        // frame.captured_at as Unix epoch, or observation.timestamp as fallback
    let vlmDescription: String
    let activityType: String
    let apps: [String]            // parsed from JSON
    let topics: [String]          // parsed from JSON
}
```

### File: `apps/recorder/Sources/ObservationStore.sqlite.adapter.swift`

### What

Implement the two new methods in `SQLiteObservationStore`.

### `fetchUnclaimed` implementation

```swift
    func fetchUnclaimed(limit: Int) async throws -> [UnclaimedObservation] {
        let sql = """
            SELECT o.id, o.frame_id, o.timestamp, o.vlm_description,
                   o.activity_type, o.apps, o.topics,
                   COALESCE(
                       CAST(strftime('%s', f.captured_at) AS REAL),
                       o.timestamp
                   ) AS effective_ts
            FROM observations o
            LEFT JOIN frames f ON o.frame_id = f.id
            WHERE o.tb_id IS NULL
              AND o.vlm_description IS NOT NULL
            ORDER BY effective_ts ASC
            LIMIT ?
        """
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &stmt, nil) == SQLITE_OK else {
            throw ObservationStoreError.queryFailed(String(cString: sqlite3_errmsg(handle)))
        }
        defer { sqlite3_finalize(stmt) }
        sqlite3_bind_int(stmt, 1, Int32(limit))

        var results: [UnclaimedObservation] = []
        while sqlite3_step(stmt) == SQLITE_ROW {
            let obsId = String(cString: sqlite3_column_text(stmt, 0))
            let frameId: String? = sqlite3_column_type(stmt, 1) != SQLITE_NULL
                ? String(cString: sqlite3_column_text(stmt, 1)) : nil
            let timestamp = sqlite3_column_double(stmt, 2)
            let vlmDesc = sqlite3_column_type(stmt, 3) != SQLITE_NULL
                ? String(cString: sqlite3_column_text(stmt, 3)) : ""
            let activity = sqlite3_column_type(stmt, 4) != SQLITE_NULL
                ? String(cString: sqlite3_column_text(stmt, 4)) : "other"
            let appsJson = sqlite3_column_type(stmt, 5) != SQLITE_NULL
                ? String(cString: sqlite3_column_text(stmt, 5)) : "[]"
            let topicsJson = sqlite3_column_type(stmt, 6) != SQLITE_NULL
                ? String(cString: sqlite3_column_text(stmt, 6)) : "[]"
            let effectiveTs = sqlite3_column_double(stmt, 7)

            let apps = parseJsonArray(appsJson)
            let topics = parseJsonArray(topicsJson)

            results.append(UnclaimedObservation(
                id: obsId,
                frameId: frameId,
                timestamp: timestamp,
                capturedAt: effectiveTs,
                vlmDescription: vlmDesc,
                activityType: activity,
                apps: apps,
                topics: topics
            ))
        }
        return results
    }
```

### `claimObservations` implementation

```swift
    func claimObservations(ids: [String], tbId: String) async throws -> Int {
        guard !ids.isEmpty else { return 0 }
        let placeholders = ids.map { _ in "?" }.joined(separator: ", ")
        let sql = "UPDATE observations SET tb_id = ? WHERE tb_id IS NULL AND id IN (\(placeholders))"

        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &stmt, nil) == SQLITE_OK else {
            throw ObservationStoreError.queryFailed(String(cString: sqlite3_errmsg(handle)))
        }
        defer { sqlite3_finalize(stmt) }

        // Bind tb_id as first parameter
        sqlite3_bind_text(stmt, 1, tbId, -1, SQLITE_TRANSIENT)
        // Bind observation IDs
        for (i, id) in ids.enumerated() {
            sqlite3_bind_text(stmt, Int32(i + 2), id, -1, SQLITE_TRANSIENT)
        }

        let rc = sqlite3_step(stmt)
        guard rc == SQLITE_DONE else {
            throw ObservationStoreError.queryFailed(String(cString: sqlite3_errmsg(handle)))
        }
        return Int(sqlite3_changes(handle))
    }
```

### Helper: `parseJsonArray`

Add to `SQLiteObservationStore`:

```swift
    private func parseJsonArray(_ json: String) -> [String] {
        guard let data = json.data(using: .utf8),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [String]
        else { return [] }
        return arr
    }
```

---

## Step 6: Swift — `TopicBlockStore` Port + Adapter

### File: `apps/recorder/Sources/TopicBlockStore.port.swift` (NEW)

### What

Port protocol for writing TopicBlocks from the SessionAggregator.

### Code

```swift
import Foundation

// MARK: - TopicBlockStore (Port)
//
// Port interface for Phase 3a: write TopicBlocks from the SessionAggregator.
//
// Follows the same pattern as ObservationStore:
//   - AnyObject + Sendable (stored in an actor)
//   - All methods async throws (actor-isolated adapter)
//
// The adapter opens a third SQLite connection (WAL allows it).

enum TopicBlockStoreError: Error, LocalizedError {
    case connectionFailed(String)
    case queryFailed(String)
    case insertFailed(String)

    var errorDescription: String? {
        switch self {
        case .connectionFailed(let m): return "TopicBlockStore connection failed: \(m)"
        case .queryFailed(let m):      return "TopicBlockStore query failed: \(m)"
        case .insertFailed(let m):     return "TopicBlockStore insert failed: \(m)"
        }
    }
}

/// A TopicBlock to be inserted into the database.
struct TopicBlockInsert: Sendable {
    let id: String
    let recordingId: String       // "__recorder__" for recorder-generated TBs
    let contextIds: String        // JSON array string, e.g. "[]"
    let classification: String    // JSON object with aggregated data
    let duration: Double          // to_ts - from_ts in seconds
    let fromTs: Double            // Unix epoch seconds
    let toTs: Double              // Unix epoch seconds
    let observationCount: Int
}

protocol TopicBlockStore: AnyObject, Sendable {
    /// Insert a new TopicBlock row.
    func save(_ block: TopicBlockInsert) async throws

    /// Count total TopicBlocks (for status display).
    func count() async throws -> Int

    /// Close the database connection.
    func close() async
}

extension TopicBlockStore {
    func close() async {}
}
```

### File: `apps/recorder/Sources/TopicBlockStore.sqlite.adapter.swift` (NEW)

### What

SQLite adapter implementing `TopicBlockStore`.

### Code

```swift
import Foundation
import SQLite3

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

// MARK: - SQLiteTopicBlockStore

actor SQLiteTopicBlockStore: TopicBlockStore {
    private var handle: OpaquePointer?

    static let expectedSchemaVersion: Int32 = 17

    init(path: String) throws {
        let dir = (path as NSString).deletingLastPathComponent
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)

        let rc = sqlite3_open_v2(path, &handle, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, nil)
        guard rc == SQLITE_OK else {
            let errMsg = handle.map { String(cString: sqlite3_errmsg($0)) } ?? "unknown"
            throw TopicBlockStoreError.connectionFailed(errMsg)
        }

        let pragmas = [
            "PRAGMA journal_mode = WAL",
            "PRAGMA synchronous = NORMAL",
            "PRAGMA foreign_keys = ON",
            "PRAGMA busy_timeout = 5000",
        ]
        for pragma in pragmas {
            sqlite3_exec(handle, pragma, nil, nil, nil)
        }
    }

    func save(_ block: TopicBlockInsert) async throws {
        let sql = """
            INSERT INTO topic_blocks
              (id, recording_id, context_ids, classification, duration,
               from_ts, to_ts, observation_count, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        """
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &stmt, nil) == SQLITE_OK else {
            throw TopicBlockStoreError.insertFailed(String(cString: sqlite3_errmsg(handle)))
        }
        defer { sqlite3_finalize(stmt) }

        sqlite3_bind_text(stmt, 1, block.id,             -1, SQLITE_TRANSIENT)
        sqlite3_bind_text(stmt, 2, block.recordingId,    -1, SQLITE_TRANSIENT)
        sqlite3_bind_text(stmt, 3, block.contextIds,     -1, SQLITE_TRANSIENT)
        sqlite3_bind_text(stmt, 4, block.classification, -1, SQLITE_TRANSIENT)
        sqlite3_bind_double(stmt, 5, block.duration)
        sqlite3_bind_double(stmt, 6, block.fromTs)
        sqlite3_bind_double(stmt, 7, block.toTs)
        sqlite3_bind_int(stmt, 8, Int32(block.observationCount))

        let rc = sqlite3_step(stmt)
        guard rc == SQLITE_DONE else {
            throw TopicBlockStoreError.insertFailed(String(cString: sqlite3_errmsg(handle)))
        }
    }

    func count() async throws -> Int {
        let sql = "SELECT COUNT(*) FROM topic_blocks"
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &stmt, nil) == SQLITE_OK else {
            throw TopicBlockStoreError.queryFailed(String(cString: sqlite3_errmsg(handle)))
        }
        defer { sqlite3_finalize(stmt) }
        sqlite3_step(stmt)
        return Int(sqlite3_column_int(stmt, 0))
    }

    func close() async {
        sqlite3_close(handle)
        handle = nil
    }
}
```

---

## Step 7: Swift — `SessionAggregator` Actor

### File: `apps/recorder/Sources/SessionAggregator.swift` (NEW)

### What

The core actor that:
<<<<<<< ours

=======
>>>>>>> theirs
1. Polls unclaimed observations on a timer
2. Groups them by gap-aware windowing
3. For each window, calls the VLM bridge with a text-only prompt for semantic grouping
4. Writes TopicBlocks and claims observations atomically

### Design

```
SessionAggregator (actor)
├── Dependencies:
│   ├── obsStore: ObservationStore      (read unclaimed, claim)
│   ├── tbStore: TopicBlockStore        (write TopicBlocks)
│   └── textService: TextGenerationService  (LLM grouping via VLM bridge)
│
├── Configuration (from env):
<<<<<<< ours
│   ├── ESCRIBANO_SESSION_GAP_THRESHOLD: 1200s (20 min)
│   ├── ESCRIBANO_TB_MIN_OBSERVATIONS: 5
│   ├── ESCRIBANO_TB_POLL_INTERVAL: 120s (2 min)
│   └── ESCRIBANO_TB_MAX_OBSERVATIONS_PER_CYCLE: 300
│
├── aggregateLoop():
│   │   while !Task.isCancelled:
│   │     1. fetchUnclaimed(limit: 300)
=======
│   ├── SESSION_GAP_THRESHOLD: 1200s (20 min)
│   ├── TB_MIN_OBSERVATIONS: 5
│   ├── TB_POLL_INTERVAL: 120s (2 min)
│   └── TB_MAX_OBSERVATIONS_PER_CYCLE: 500
│
├── aggregateLoop():
│   │   while !Task.isCancelled:
│   │     1. fetchUnclaimed(limit: 500)
>>>>>>> theirs
│   │     2. if empty → sleep(pollInterval), continue
│   │     3. splitByGap(observations, threshold) → windows[]
│   │     4. for each window with >= minObservations:
│   │     │     a. buildGroupingPrompt(window)
│   │     │     b. textService.generateText(prompt)
│   │     │     c. parseGroupingResponse(response) → groups[]
│   │     │     d. for each group:
│   │     │     │     - Create TopicBlockInsert
│   │     │     │     - tbStore.save(block)
│   │     │     │     - obsStore.claimObservations(ids, tbId)
│   │     5. sleep(pollInterval)
│
└── splitByGap(observations, threshold) → [[UnclaimedObservation]]:
        Walk sorted observations, split when gap > threshold
```

### Code

```swift
import Foundation

// MARK: - SessionAggregatorError

enum SessionAggregatorError: Error, LocalizedError {
    case textGenerationFailed(String)
    case noGroupsParsed

    var errorDescription: String? {
        switch self {
        case .textGenerationFailed(let m): return "Text generation failed: \(m)"
        case .noGroupsParsed:              return "No groups parsed from LLM response"
        }
    }
}

// MARK: - SessionAggregator

/// Actor that periodically groups unclaimed observations into TopicBlocks.
///
/// Follows the same pattern as FrameAnalyzer:
///   - Injected dependencies via init (port interfaces)
///   - Long-running loop with Task.isCancelled checks
///   - CancellationError breaks the loop
///
/// The LLM grouping uses the VLM bridge's text_infer method (same model,
/// same socket, zero extra RAM). This was validated in the VLM-as-LLM POC.
actor SessionAggregator {

    private let obsStore: any ObservationStore
    private let tbStore: any TopicBlockStore
    private let textService: any TextGenerationService

    // Configuration
    private let gapThreshold: Double   // seconds
    private let minObservations: Int
    private let pollInterval: Double   // seconds
    private let maxObsPerCycle: Int

    // Sentinel recording ID for recorder-generated TopicBlocks
    private let recorderRecordingId = "__recorder__"

    init(
        obsStore: any ObservationStore,
        tbStore: any TopicBlockStore,
        textService: any TextGenerationService
    ) {
        self.obsStore = obsStore
        self.tbStore = tbStore
        self.textService = textService

        self.gapThreshold = Double(
            ProcessInfo.processInfo.environment["ESCRIBANO_SESSION_GAP_THRESHOLD"] ?? ""
        ) ?? 1200.0  // 20 min default

        self.minObservations = Int(
            ProcessInfo.processInfo.environment["ESCRIBANO_TB_MIN_OBSERVATIONS"] ?? ""
        ) ?? 5

        self.pollInterval = Double(
            ProcessInfo.processInfo.environment["ESCRIBANO_TB_POLL_INTERVAL"] ?? ""
        ) ?? 120.0  // 2 min default

        self.maxObsPerCycle = Int(
            ProcessInfo.processInfo.environment["ESCRIBANO_TB_MAX_OBS_PER_CYCLE"] ?? ""
<<<<<<< ours
        ) ?? 300
=======
        ) ?? 500
>>>>>>> theirs
    }

    /// Main aggregation loop. Runs until Task is cancelled.
    func aggregateLoop() async {
        log("[SessionAggregator] Starting. Gap=\(Int(gapThreshold))s MinObs=\(minObservations) Poll=\(Int(pollInterval))s MaxObs=\(maxObsPerCycle)")

        while !Task.isCancelled {
            do {
                let observations = try await obsStore.fetchUnclaimed(limit: maxObsPerCycle)

                if observations.isEmpty {
                    try await Task.sleep(for: .seconds(pollInterval))
                    continue
                }

                log("[SessionAggregator] Found \(observations.count) unclaimed observations")

                let windows = splitByGap(observations)
                var totalTBs = 0

                for window in windows {
                    guard window.count >= minObservations else {
                        log("[SessionAggregator] Skipping window with \(window.count) obs (< \(minObservations) min)")
                        continue
                    }

                    do {
                        let created = try await processWindow(window)
                        totalTBs += created
                    } catch {
                        log("[SessionAggregator] Error processing window: \(error.localizedDescription)")
                        // Continue with next window — don't fail the whole cycle
                    }
                }

                if totalTBs > 0 {
                    log("[SessionAggregator] Cycle complete: created \(totalTBs) TopicBlock(s)")
                }

                try await Task.sleep(for: .seconds(pollInterval))

            } catch is CancellationError {
                break
            } catch {
                log("[SessionAggregator] Unexpected error: \(error.localizedDescription)")
                try? await Task.sleep(for: .seconds(pollInterval))
            }
        }

        log("[SessionAggregator] Loop exited.")
    }

    // MARK: - Gap-Aware Windowing

    /// Split observations into windows separated by gaps > threshold.
    /// Observations are already sorted by capturedAt ASC from fetchUnclaimed.
    private func splitByGap(_ observations: [UnclaimedObservation]) -> [[UnclaimedObservation]] {
        guard !observations.isEmpty else { return [] }

        var windows: [[UnclaimedObservation]] = []
        var currentWindow: [UnclaimedObservation] = [observations[0]]

        for i in 1..<observations.count {
            let gap = observations[i].capturedAt - observations[i - 1].capturedAt
            if gap > gapThreshold {
                windows.append(currentWindow)
                currentWindow = [observations[i]]
            } else {
                currentWindow.append(observations[i])
            }
        }
        windows.append(currentWindow)

        return windows
    }

    // MARK: - Window Processing

    /// Process a single time window: group observations via LLM, create TopicBlocks.
    /// Returns the number of TopicBlocks created.
    private func processWindow(_ window: [UnclaimedObservation]) async throws -> Int {
        let fromTs = window.first!.capturedAt
        let toTs = window.last!.capturedAt

        let prompt = buildGroupingPrompt(window)

        let response: String
        do {
            response = try await textService.generateText(prompt: prompt, maxTokens: 2000)
        } catch {
            throw SessionAggregatorError.textGenerationFailed(error.localizedDescription)
        }

        let groups = parseGroupingResponse(response, observations: window)

        if groups.isEmpty {
            // Fallback: treat entire window as one TopicBlock
            log("[SessionAggregator] No groups parsed — creating single TB for window")
            let tb = createTopicBlock(from: window, label: dominantActivity(window))
            try await tbStore.save(tb)
            let claimed = try await obsStore.claimObservations(
                ids: window.map { $0.id }, tbId: tb.id
            )
            log("[SessionAggregator] Fallback TB \(tb.id): \(claimed)/\(window.count) obs claimed")
            return 1
        }

        var created = 0
        for group in groups {
            let groupObs = group.observationIds.compactMap { targetId in
                window.first { $0.id == targetId }
            }
            guard !groupObs.isEmpty else { continue }

            let tb = createTopicBlock(from: groupObs, label: group.label)
            try await tbStore.save(tb)
            let claimed = try await obsStore.claimObservations(
                ids: groupObs.map { $0.id }, tbId: tb.id
            )
            log("[SessionAggregator] TB \(tb.id) (\(group.label)): \(claimed)/\(groupObs.count) obs claimed")
            created += 1
        }

        return created
    }

    // MARK: - TopicBlock Construction

    private func createTopicBlock(from observations: [UnclaimedObservation], label: String) -> TopicBlockInsert {
        let id = "tb-\(UUID().uuidString)"
        let fromTs = observations.map { $0.capturedAt }.min() ?? 0
        let toTs = observations.map { $0.capturedAt }.max() ?? 0
        let duration = toTs - fromTs

        // Aggregate apps and topics
        var appsSet = Set<String>()
        var topicsSet = Set<String>()
        var activityCounts: [String: Int] = [:]

        for obs in observations {
            for app in obs.apps { appsSet.insert(app) }
            for topic in obs.topics { topicsSet.insert(topic) }
            activityCounts[obs.activityType, default: 0] += 1
        }

        let dominantActivity = activityCounts.max(by: { $0.value < $1.value })?.key ?? "other"

        // Build key_description from VLM descriptions (first 5 + last if many)
        let descSample: [String]
        if observations.count <= 6 {
            descSample = observations.map { $0.vlmDescription }
        } else {
            descSample = Array(observations.prefix(5).map { $0.vlmDescription })
                + [observations.last!.vlmDescription]
        }
        let keyDescription = descSample.joined(separator: "; ")

        let classification: [String: Any] = [
            "activity_type": dominantActivity,
            "key_description": keyDescription,
            "start_time": fromTs,
            "end_time": toTs,
            "duration": duration,
            "apps": Array(appsSet),
            "topics": Array(topicsSet),
            "transcript_count": 0,
            "has_transcript": false,
            "combined_transcript": "",
            "label": label,
        ]

        let classificationJson: String
        if let data = try? JSONSerialization.data(withJSONObject: classification),
           let str = String(data: data, encoding: .utf8) {
            classificationJson = str
        } else {
            classificationJson = "{}"
        }

        return TopicBlockInsert(
            id: id,
            recordingId: recorderRecordingId,
            contextIds: "[]",
            classification: classificationJson,
            duration: duration,
            fromTs: fromTs,
            toTs: toTs,
            observationCount: observations.count
        )
    }

    // MARK: - LLM Grouping Prompt

    private func buildGroupingPrompt(_ observations: [UnclaimedObservation]) -> String {
        let fromTs = observations.first?.capturedAt ?? 0
        let toTs = observations.last?.capturedAt ?? 0

        // Build observation descriptions for the prompt
        var blockDescriptions = ""
        for (i, obs) in observations.enumerated() {
            let timeStr = formatTime(obs.capturedAt)
            blockDescriptions += """
            OBS \(i + 1):
            Time: \(timeStr)
            Activity: \(obs.activityType)
            Description: \(obs.vlmDescription)
            Apps: \(obs.apps.joined(separator: ", "))
            Topics: \(obs.topics.joined(separator: ", "))
            ID: \(obs.id)

            """
        }

        let exampleIds: String
        if observations.count >= 2 {
            exampleIds = "\"\(observations[0].id)\", \"\(observations[1].id)\""
        } else {
            exampleIds = "\"\(observations[0].id)\""
        }

        return """
        /no_think
        You are analyzing \(observations.count) screen observations from a continuous work recording spanning \(formatTime(fromTs)) to \(formatTime(toTs)).

        Your task is to group these observations into 1-6 coherent work segments. Each segment represents a distinct thread of work.

        GROUPING RULES:
        1. Group observations that belong to the same work thread, even if not consecutive
        2. Personal activities (WhatsApp, Instagram, social media) should be grouped into a "Personal" segment
        3. Deep work on the same project/codebase should be grouped together
        4. If all observations are about the same project, one group is correct — do not invent artificial splits

        OBSERVATIONS TO GROUP:
        \(blockDescriptions)

        For each group, output ONE line in this EXACT format:
        Group 1: label: [Descriptive segment name] | obsIds: [\(exampleIds)]

        CRITICAL REQUIREMENTS:
        - Each group MUST have "label" and "obsIds"
        - Observation IDs are the IDs shown above (copy them exactly)
        - Include ALL \(observations.count) observation IDs across all groups
        - Create 1-6 groups
        - Output ONLY the group lines — no explanation, no preamble
        """
    }

    // MARK: - Response Parsing

    private struct ParsedGroup {
        let label: String
        let observationIds: [String]
    }

    private func parseGroupingResponse(_ response: String, observations: [UnclaimedObservation]) -> [ParsedGroup] {
        let validIds = Set(observations.map { $0.id })
        var groups: [ParsedGroup] = []

        // Strip thinking tags (Qwen3 may add <think>...</think>)
        var cleaned = response
        while let start = cleaned.range(of: "<think>"),
              let end = cleaned.range(of: "</think>"),
              start.lowerBound <= end.lowerBound {
            cleaned.removeSubrange(start.lowerBound..<end.upperBound)
        }
        // Handle orphan </think>
        if let orphan = cleaned.range(of: "</think>") {
            cleaned = String(cleaned[orphan.upperBound...])
        }

        let lines = cleaned.split(separator: "\n", omittingEmptySubsequences: true)

        // Match: Group N: label: ... | obsIds: [id1, id2, ...]
        for line in lines {
            let lineStr = String(line).trimmingCharacters(in: .whitespaces)
            guard lineStr.lowercased().hasPrefix("group ") else { continue }

            // Extract label
            guard let labelStart = lineStr.range(of: "label: "),
                  let separator = lineStr.range(of: " | obsIds:") else { continue }
            let label = String(lineStr[labelStart.upperBound..<separator.lowerBound])
                .trimmingCharacters(in: .whitespaces)

            // Extract obsIds
            guard let idsStart = lineStr.range(of: "obsIds: ["),
                  let idsEnd = lineStr.range(of: "]", range: idsStart.upperBound..<lineStr.endIndex) else { continue }
            let idsStr = String(lineStr[idsStart.upperBound..<idsEnd.lowerBound])

            let ids = idsStr.split(separator: ",")
                .map { String($0).trimmingCharacters(in: CharacterSet(charactersIn: " \"'")) }
                .filter { validIds.contains($0) }

            if !ids.isEmpty && !label.isEmpty {
                groups.append(ParsedGroup(label: label, observationIds: ids))
            }
        }

        return groups
    }

    // MARK: - Helpers

    private func dominantActivity(_ observations: [UnclaimedObservation]) -> String {
        var counts: [String: Int] = [:]
        for obs in observations {
            counts[obs.activityType, default: 0] += 1
        }
        return counts.max(by: { $0.value < $1.value })?.key ?? "Work Session"
    }

    private func formatTime(_ unixTimestamp: Double) -> String {
        let date = Date(timeIntervalSince1970: unixTimestamp)
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: date)
    }
}
```

---

## Step 8: Swift — Wire Into `main.swift`

### File: `apps/recorder/Sources/main.swift`

### What

Add `SessionAggregator` as a third async task alongside StreamCapture and FrameAnalyzer.

### Changes

1. Add new properties to `EscribanoRecorderDelegate`:

```swift
    private var tbStore: (any TopicBlockStore)?
    private var aggregator: SessionAggregator?
    private var aggregatorTask: Task<Void, Never>?
```

2. After the FrameAnalyzer wiring block (after line 151), add:

```swift
        // 4. Create TopicBlockStore and SessionAggregator for Phase 3a.
        //    The aggregator polls unclaimed observations every TB_POLL_INTERVAL
        //    and groups them into TopicBlocks using the VLM bridge for semantic grouping.
        let tbStore: any TopicBlockStore
        do {
            tbStore = try SQLiteTopicBlockStore(path: dbPath)
        } catch {
            log("[escribano-recorder] ERROR: Cannot open topic block store: \(error.localizedDescription)")
            exit(1)
        }
        self.tbStore = tbStore

        // vlmService conforms to both VLMInferenceService and TextGenerationService
        let aggregator = SessionAggregator(
            obsStore: obsStore,
            tbStore: tbStore,
            textService: vlmService
        )
        self.aggregator = aggregator
        self.aggregatorTask = Task {
            // Wait for VLM service to be ready before starting aggregation.
            // The FrameAnalyzer.start() call above ensures the bridge is up.
            // We add a small delay to let the first few observations accumulate.
            try? await Task.sleep(for: .seconds(30))
            await aggregator.aggregateLoop()
        }
        log("[escribano-recorder] SessionAggregator task started.")
```

3. Update `applicationWillTerminate` to cancel the aggregator and close tbStore:

```swift
    func applicationWillTerminate(_ notification: Notification) {
        log("[escribano-recorder] applicationWillTerminate — cleaning up")
        analyzerTask?.cancel()
        aggregatorTask?.cancel()       // ← NEW
        vlmAdapter?.terminateSync()
        store?.close()
        // tbStore and obsStore close are async — best effort in sync context
    }
```

---

## Step 9: Bump Schema Versions in Swift Stores

### File: `apps/recorder/Sources/FrameStore.sqlite.adapter.swift`

Change line 25:
<<<<<<< ours

=======
>>>>>>> theirs
```swift
    static let expectedSchemaVersion: Int32 = 17  // was 15
```

### File: `apps/recorder/Sources/ObservationStore.sqlite.adapter.swift`

Change line 14:
<<<<<<< ours

=======
>>>>>>> theirs
```swift
    static let expectedSchemaVersion: Int32 = 17  // was 16
```

### Why

<<<<<<< ours
Both stores check `PRAGMA user_version >= expectedSchemaVersion` on startup. After migration 017 runs, the
user_version will be 17. The stores need to accept this version (and any future version ≥ 17).

Note: Both stores already use `>=` comparison (via `FrameStoreError.schemaMismatch` which checks
`version >= Self.expectedSchemaVersion`). Wait — actually, `FrameStore.sqlite.adapter.swift` line 58 does:

=======
Both stores check `PRAGMA user_version >= expectedSchemaVersion` on startup. After migration 017 runs, the user_version will be 17. The stores need to accept this version (and any future version ≥ 17).

Note: Both stores already use `>=` comparison (via `FrameStoreError.schemaMismatch` which checks `version >= Self.expectedSchemaVersion`). Wait — actually, `FrameStore.sqlite.adapter.swift` line 58 does:
>>>>>>> theirs
```swift
guard version >= Self.expectedSchemaVersion else {
```

<<<<<<< ours
So setting `expectedSchemaVersion = 17` means it requires _at least_ 17. This is correct — after migration 017
runs, `user_version` will be 17.

But `SQLiteObservationStore` does NOT have a version check currently. It just opens the connection. We should
add one for consistency, OR leave it as-is since it doesn't validate schema. The safest approach: bump
`expectedSchemaVersion` on both stores and add a version check to `SQLiteObservationStore.init()`:

In `SQLiteObservationStore.init()`, after the pragma block, add:

=======
So setting `expectedSchemaVersion = 17` means it requires *at least* 17. This is correct — after migration 017 runs, `user_version` will be 17.

But `SQLiteObservationStore` does NOT have a version check currently. It just opens the connection. We should add one for consistency, OR leave it as-is since it doesn't validate schema. The safest approach: bump `expectedSchemaVersion` on both stores and add a version check to `SQLiteObservationStore.init()`:

In `SQLiteObservationStore.init()`, after the pragma block, add:
>>>>>>> theirs
```swift
        // Schema version check (matches FrameStore pattern)
        var versionStmt: OpaquePointer?
        sqlite3_prepare_v2(handle, "PRAGMA user_version", -1, &versionStmt, nil)
        defer { sqlite3_finalize(versionStmt) }
        sqlite3_step(versionStmt)
        let version = sqlite3_column_int(versionStmt, 0)
        guard version >= Self.expectedSchemaVersion else {
            throw ObservationStoreError.connectionFailed(
                "Schema version \(version) < expected \(Self.expectedSchemaVersion). Run 'escribano recorder install'."
            )
        }
```

---

## Step 10: Update `escribano recorder status` — Show TB Count

### File: `src/actions/recorder-commands.ts`

### What

Add TopicBlock count to the status output, alongside pending frames.

### Changes

In `recorderStatus()`, after the pending frames block (around line 224), add:

```typescript
<<<<<<< ours
// TopicBlock count from DB
if (existsSync(DB_PATH)) {
  let db: Database | undefined;
  try {
    db = new Database(DB_PATH, { readonly: true });
    const tbRow = db
      .prepare("SELECT COUNT(*) as cnt FROM topic_blocks WHERE recording_id = '__recorder__'")
      .get() as { cnt: number };
    const unclaimedRow = db
      .prepare("SELECT COUNT(*) as cnt FROM observations WHERE tb_id IS NULL AND vlm_description IS NOT NULL")
      .get() as { cnt: number };
    console.log(`Topic blocks      : ${tbRow.cnt} (${unclaimedRow.cnt} unclaimed observations)`);
  } catch {
    // topic_blocks table may not exist yet (pre-migration-017)
  } finally {
    if (db) {
      db.close();
    }
  }
}
=======
    // TopicBlock count from DB
    if (existsSync(DB_PATH)) {
      try {
        const db = new Database(DB_PATH, { readonly: true });
        const tbRow = db
          .prepare("SELECT COUNT(*) as cnt FROM topic_blocks WHERE recording_id = '__recorder__'")
          .get() as { cnt: number };
        const unclaimedRow = db
          .prepare('SELECT COUNT(*) as cnt FROM observations WHERE tb_id IS NULL AND vlm_description IS NOT NULL')
          .get() as { cnt: number };
        db.close();
        console.log(`Topic blocks      : ${tbRow.cnt} (${unclaimedRow.cnt} unclaimed observations)`);
      } catch {
        // topic_blocks table may not exist yet (pre-migration-017)
      }
    }
>>>>>>> theirs
```

---

## Build & Test Checklist

### Build

```bash
# 1. Run migration
npx escribano recorder install
# Verify: PRAGMA user_version = 17

# 2. Build Swift recorder
pnpm build:recorder
# Alternatively for dev: pnpm recorder:dev

# 3. Verify Swift compilation
swift build -c release
# (from apps/recorder/)
```

### Test Scenarios

1. **Fresh start**: No unclaimed observations → aggregator sleeps quietly
2. **Backfill**: Historical unclaimed observations → creates TBs for all past sessions
3. **Gap detection**: 20+ min gap in timestamps → separate TBs
4. **LLM grouping**: Multi-project observations → grouped into labeled TBs
5. **Fallback**: LLM returns unparseable response → single TB for window
6. **Concurrent safety**: FrameAnalyzer writes observations while SessionAggregator reads → WAL handles it
7. **Shutdown**: SIGTERM → aggregator loop exits cleanly
8. **Status**: `escribano recorder status` shows TB count

### Smoke Test

```bash
# Start recorder in dev mode
pnpm recorder:dev

# Wait 5+ minutes for observations to accumulate
# Check logs for aggregator activity:
grep "SessionAggregator" ~/.escribano/logs/escribano-recorder.log

# Check DB:
sqlite3 ~/.escribano/escribano.db "SELECT COUNT(*) FROM topic_blocks WHERE recording_id = '__recorder__'"

# Check status:
npx escribano recorder status
```

---

## Files Summary

### New Files (6)
<<<<<<< ours

| File                                                         | Description                                                                   |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `migrations/017_session_aggregation.sql`                     | Schema: tb_id on observations, time-range on topic_blocks, sentinel recording |
| `apps/recorder/Sources/TextGenerationService.port.swift`     | Port protocol for text-only generation                                        |
| `apps/recorder/Sources/TopicBlockStore.port.swift`           | Port protocol + types for TopicBlock persistence                              |
| `apps/recorder/Sources/TopicBlockStore.sqlite.adapter.swift` | SQLite adapter implementing TopicBlockStore                                   |
| `apps/recorder/Sources/SessionAggregator.swift`              | Core actor: gap windowing + LLM grouping + TB creation                        |

### Modified Files (6)

| File                                                          | Changes                                                                                                  |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `scripts/mlx_bridge.py`                                       | Add `text_infer` method handler (~5 lines)                                                               |
| `apps/recorder/Sources/PythonBridge.vlm.adapter.swift`        | Conform to TextGenerationService, add `generateText()` method                                            |
| `apps/recorder/Sources/ObservationStore.port.swift`           | Add `UnclaimedObservation` struct, `fetchUnclaimed`, `claimObservations` to protocol                     |
| `apps/recorder/Sources/ObservationStore.sqlite.adapter.swift` | Implement `fetchUnclaimed`, `claimObservations`, `parseJsonArray`, bump version to 17, add version check |
| `apps/recorder/Sources/FrameStore.sqlite.adapter.swift`       | Bump `expectedSchemaVersion` to 17                                                                       |
| `apps/recorder/Sources/main.swift`                            | Wire SessionAggregator as Task 3, add cleanup                                                            |
| `src/actions/recorder-commands.ts`                            | Add TB count + unclaimed obs to status output                                                            |

### Unchanged Files (for reference)

| File                                                   | Why Referenced                                    |
| ------------------------------------------------------ | ------------------------------------------------- |
| `apps/recorder/Sources/FrameAnalyzer.swift`            | Pattern reference for actor + poll loop           |
| `apps/recorder/Sources/VLMInferenceService.port.swift` | Pattern reference for port protocol               |
| `apps/recorder/Sources/Prompts.swift`                  | Reference for prompt structure                    |
| `apps/recorder/Sources/ResponseParser.swift`           | Reference for VLM output parsing                  |
| `src/services/subject-grouping.ts`                     | Reference for LLM grouping prompt + parsing logic |
| `prompts/subject-grouping.md`                          | Reference for grouping prompt template            |
| `src/db/migrate.ts`                                    | Runs migration 017, bumps user_version            |
=======
| File | Description |
|---|---|
| `migrations/017_session_aggregation.sql` | Schema: tb_id on observations, time-range on topic_blocks, sentinel recording |
| `apps/recorder/Sources/TextGenerationService.port.swift` | Port protocol for text-only generation |
| `apps/recorder/Sources/TopicBlockStore.port.swift` | Port protocol + types for TopicBlock persistence |
| `apps/recorder/Sources/TopicBlockStore.sqlite.adapter.swift` | SQLite adapter implementing TopicBlockStore |
| `apps/recorder/Sources/SessionAggregator.swift` | Core actor: gap windowing + LLM grouping + TB creation |

### Modified Files (6)
| File | Changes |
|---|---|
| `scripts/mlx_bridge.py` | Add `text_infer` method handler (~5 lines) |
| `apps/recorder/Sources/PythonBridge.vlm.adapter.swift` | Conform to TextGenerationService, add `generateText()` method |
| `apps/recorder/Sources/ObservationStore.port.swift` | Add `UnclaimedObservation` struct, `fetchUnclaimed`, `claimObservations` to protocol |
| `apps/recorder/Sources/ObservationStore.sqlite.adapter.swift` | Implement `fetchUnclaimed`, `claimObservations`, `parseJsonArray`, bump version to 17, add version check |
| `apps/recorder/Sources/FrameStore.sqlite.adapter.swift` | Bump `expectedSchemaVersion` to 17 |
| `apps/recorder/Sources/main.swift` | Wire SessionAggregator as Task 3, add cleanup |
| `src/actions/recorder-commands.ts` | Add TB count + unclaimed obs to status output |

### Unchanged Files (for reference)
| File | Why Referenced |
|---|---|
| `apps/recorder/Sources/FrameAnalyzer.swift` | Pattern reference for actor + poll loop |
| `apps/recorder/Sources/VLMInferenceService.port.swift` | Pattern reference for port protocol |
| `apps/recorder/Sources/Prompts.swift` | Reference for prompt structure |
| `apps/recorder/Sources/ResponseParser.swift` | Reference for VLM output parsing |
| `src/services/subject-grouping.ts` | Reference for LLM grouping prompt + parsing logic |
| `prompts/subject-grouping.md` | Reference for grouping prompt template |
| `src/db/migrate.ts` | Runs migration 017, bumps user_version |
>>>>>>> theirs

---

## Dependency Graph

```
Step 1 (Python bridge text_infer) ─────────────────────────────────────┐
Step 2 (Migration 017) ──────────────────────────────────────┐         │
Step 3 (TextGenerationService protocol) ──────┐              │         │
Step 4 (Extend PythonBridgeVLMAdapter) ◄──────┤              │         │
                                              │              │         │
Step 5 (Extend ObservationStore) ◄────────────┼──────────────┤         │
Step 6 (TopicBlockStore port+adapter) ◄───────┼──────────────┤         │
                                              │              │         │
Step 7 (SessionAggregator) ◄──────────────────┴──────────────┼─────────┘
                                                             │
Step 8 (Wire main.swift) ◄───────────────────────────────────┤
Step 9 (Bump schema versions) ◄───────────────────────────────┘
Step 10 (recorder status) — independent, can be done anytime
```

Steps 1-6 can be done in any order. Steps 7-8 depend on 1-6. Step 9 depends on 2.

---

## Post-Phase 3a: What Comes Next (Phase 3b)

Phase 3b adds the Node.js `generate` subcommand that queries TopicBlocks by time range:
<<<<<<< ours

=======
>>>>>>> theirs
- `npx escribano generate --today --format standup`
- `npx escribano generate --from 9am --to 12pm --format card`
- Flush-aggregate step (same gap logic in Node.js)
- macOS notification on completion
- Artifact caching by `(from_ts, to_ts, format)`

This is a separate plan document.
