# ADR-010: Swift-Native Visual Intelligence

## Status

| State                  | Date       | Details                                                                                          |
|------------------------|------------|--------------------------------------------------------------------------------------------------|
| Proposed               | 2026-03-16 | MLX-Swift POC validates native inference. Replaces TDD-002 (Node Batch Analyzer) with in-process VLM task. |
| Superseded (partial)   | 2026-03-16 | mlx-swift-lm VLM performance bug discovered during implementation. Pivoted to Swift→Python bridge. See Addendum below. |

## Context

### Current State (Before ADR-010)

The always-on recorder architecture (ADR-009) proposed a **three-process model**:

1. **Swift Capture Process** — Writes frames to DB every 1s with pHash dedup
2. **Node Batch Analyzer** (TDD-002) — Polls frames, claims batch, runs VLM, writes observations
3. **CLI/Menu Bar** — User-triggered segmentation + artifact generation

**Technology Stack**: Swift → SQLite → Node → TypeScript → Python bridge → mlx-vlm → MLX inference

**IPC Boundaries**: 
- Swift ↔ Node: SQLite WAL (via frames table job queue)
- Node ↔ Python: Unix domain socket + JSON RPC

### Problem

1. **Python dependency complexity**: `~/.escribano/venv` setup, `uv` lockfile management, version conflicts
2. **Startup latency**: Python subprocess + venv activation delays VLM availability
3. **Unnecessary IPC boundary**: Swift captures frames → Node polls DB → sends to Python. This is two IPC hops for a single purpose (VLM analysis).
4. **Memory overhead**: Two separate processes (Node analyzer + Python bridge)
5. **Parsing anti-pattern**: In `intelligence.mlx.adapter.ts:740`, VLM response parsing is tightly coupled to inference. Hard to test or reuse.
6. **Model lifecycle inefficiency**: Load/unload per batch (TDD-002 design) when model could stay loaded for continuous analysis

### Opportunity

- **MLX-Swift POC validated** (March 15, 2026): Native Swift matches Python mlx-lm performance (~220 tok/s) with 17% less memory (1.3GB vs 1.5GB)
- **mlx-swift-lm** available via Swift Package Manager (zero new system dependencies)
- **1 process, 2 async tasks**: Capture task (existing) + VLM analyzer task (new) in same Swift process, sharing SQLite + backpressure coordination
- **No IPC overhead**: Both tasks are async/await in native Swift
- **Model stays loaded**: 4GB always-on, no startup penalty per batch
- **Decoupled parsing**: Extract `ResponseParser.swift` as standalone logic (testable, reusable)

## Decision

Move VLM inference into the Swift capture agent as a second concurrent async task.

**Single-process, dual-task architecture:**

```
┌─────────────────────────────────────────────────────┐
│  Swift Capture Agent (escribano recorder binary)   │
│                                                     │
│  Task 1: StreamCapture           Task 2: VLMAnalyzer
│  ┌──────────────────────────────┐ ┌───────────────┐
│  │ • SCStream 1s interval       │ │ • Poll frames │
│  │ • pHash dedup (threshold=4)  │ │ • Claim batch │
│  │ • Backpressure check ◀──────────► • Run VLM    │
│  │ • Write JPEG + frames DB row │ │ • Parse resp  │
│  │                              │ │ • Write obs   │
│  │ (1 producer)                 │ │ • Mark done   │
│  └──────────────────────────────┘ │               │
│                                  │ (1 consumer)   │
│                                  └───────────────┘
│                                         ▲
│                            VLM model (~4GB)
│                            Stays loaded
└─────────────────────────────────────────────────────┘
         │
         ▼
    SQLite (WAL)
         │
         ├─ frames (written by capture task)
         ├─ observations (written by VLM analyzer task)
         └─ (Backpressure via SELECT COUNT(*) WHERE analyzed=0)
         │
         ▼
    TypeScript Pipeline (TS reads observations)
    ├─ Segmentation (existing activity-segmentation.ts)
    ├─ Subject grouping (LLM, existing)
    └─ Artifact generation (existing generate-summary-v3.ts)
```

**Key decisions:**

1. **VLM inference runs in-process** — One `VLMAnalyzer` async task alongside `StreamCapture` task
2. **Model lifecycle** — Load at process startup, keep in memory, release at shutdown
3. **No concurrent analyzer risk** — Single process, no overlapping VLM instances (no `process_locks` table needed)
4. **Model upgrade** — Use `mlx-community/Qwen3-VL-4B-Instruct-4bit` (4B instead of 2B for better quality)
5. **Parsing decoupled** — `ResponseParser.swift` handles response formatting, independent of VLM runner
6. **Batch pipeline unchanged** — Python bridge retained for `--file` batch processing; no changes to `intelligence.mlx.adapter.ts`
7. **Port/Adapter pattern** — `ObservationStore` protocol with `SQLiteObservationStore` adapter (same pattern as `FrameStore`)

## Architecture

### New File Structure

```
apps/recorder/Sources/
├── main.swift                    # Manages lifecycle: load VLM, spawn capture + analyzer tasks
├── StreamCapture.swift           # Task 1: Existing capture logic (unchanged)
├── VLMAnalyzer.swift             # Task 2: NEW async task, polls frames & runs VLM
├── VLMRunner.swift               # Enhanced from POC: batch/single inference
├── ResponseParser.swift          # NEW: Decoupled parsing (Frame N format, activity normalization)
├── PHash.swift                   # Existing: pHash dedup
├── FrameStore.swift              # Existing: Port protocol
├── SQLiteFrameStore.swift        # Existing: Adapter
├── ObservationStore.swift        # NEW: Port protocol for observations
├── SQLiteObservationStore.swift  # NEW: Adapter implementation
└── Backpressure.swift            # Existing: High/low water mark logic
```

### Package.swift Update

Add `mlx-swift-lm` dependency (same as POC):

```swift
// swift-tools-version: 6.0
import PackageDescription

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

### Process Topology: main.swift

```swift
@main
struct EscribanoRecorder {
    static func main() async {
        // 1. Initialize database
        let db = SQLiteFrameStore(dbPath: "~/.escribano/escribano.db")
        let obsStore = SQLiteObservationStore(db: db)
        
        // 2. Load VLM model (once, at startup)
        let vlmAnalyzer = VLMAnalyzer(obsStore: obsStore)
        try await vlmAnalyzer.loadModel()
        
        // 3. Spawn two async tasks
        async let captureTask = streamCapture(frameStore: db)
        async let analyzeTask = vlmAnalyzer.analyzeLoop()
        
        // 4. Wait for both (exit on signal or error)
        _ = try await [captureTask, analyzeTask]
    }
}
```

### VLMAnalyzer Task

New file: `VLMAnalyzer.swift`

```swift
actor VLMAnalyzer {
    private let obsStore: ObservationStore
    private var modelContainer: ModelContainer?
    
    nonisolated let batchSize: Int
    nonisolated let pollInterval: TimeInterval
    
    func loadModel() async throws {
        // Load mlx-swift-lm model once at startup
        let config = ModelConfiguration(directory: URL(fileURLWithPath: modelDir))
        self.modelContainer = try await VLMModelFactory.shared.loadContainer(configuration: config)
    }
    
    func analyzeLoop() async {
        // Continuously poll frames and analyze
        while !Task.isCancelled {
            do {
                let frames = try await obsStore.claimFrames(batchSize: batchSize)
                if frames.isEmpty {
                    // No work; sleep and retry
                    try await Task.sleep(nanoseconds: UInt64(pollInterval * 1_000_000_000))
                    continue
                }
                
                let descriptions = try await runVLMBatch(frames: frames)
                try await obsStore.saveObservations(from: frames, descriptions: descriptions)
                try await obsStore.markFramesAnalyzed(ids: frames.map { $0.id })
            } catch {
                logger.error("VLM analysis error: \(error)")
                // Continue on error; stale lock cleanup happens next run
            }
        }
    }
    
    private func runVLMBatch(frames: [DbFrame]) async throws -> [FrameDescription] {
        guard let container = modelContainer else { throw AnalyzerError.modelNotLoaded }
        return try await VLMRunner.runBatch(
            imagePaths: frames.map { $0.image_path },
            container: container
        )
    }
}
```

### ResponseParser.swift

Extracted from `intelligence.mlx.adapter.ts` (ported to Swift):

```swift
enum ResponseParser {
    // Parse "Frame N: description: X | activity: Y | apps: Z | topics: W" format
    static func parseInterleavedOutput(_ response: String) -> [FrameDescription] {
        let lines = response.split(separator: "\n", omittingEmptySubsequences: true)
        var descriptions: [FrameDescription] = []
        
        for line in lines {
            let lineStr = String(line).trimmingCharacters(in: .whitespaces)
            guard lineStr.hasPrefix("Frame ") else { continue }
            
            if let parsed = parseSingleFrame(lineStr) {
                descriptions.append(parsed)
            }
        }
        return descriptions
    }
    
    private static func parseSingleFrame(_ line: String) -> FrameDescription? {
        // Extract: description: X
        guard let descStart = line.range(of: "description: ") else { return nil }
        let afterDesc = line[descStart.upperBound...]
        guard let descEnd = afterDesc.range(of: " | activity") else { return nil }
        let description = String(afterDesc[..<descEnd.lowerBound]).trimmingCharacters(in: .whitespaces)
        
        // Extract: activity: Y
        guard let actStart = afterDesc.range(of: "activity: ") else { return nil }
        let afterAct = afterDesc[actStart.upperBound...]
        guard let actEnd = afterAct.range(of: " | apps") else { return nil }
        let activity = normalizeActivity(String(afterAct[..<actEnd.lowerBound]).trimmingCharacters(in: .whitespaces))
        
        // Extract: apps: [Z]
        guard let appsStart = afterAct.range(of: "apps: ") else { return nil }
        let afterApps = afterAct[appsStart.upperBound...]
        guard let appsEnd = afterApps.range(of: " | topics") else { return nil }
        let appsStr = String(afterApps[..<appsEnd.lowerBound]).trimmingCharacters(in: .whitespaces)
        let apps = parseList(appsStr)
        
        // Extract: topics: W
        guard let topicsStart = afterApps.range(of: "topics: ") else { return nil }
        let topicsStr = String(afterApps[topicsStart.upperBound...]).trimmingCharacters(in: .whitespaces)
        let topics = parseList(topicsStr)
        
        return FrameDescription(
            description: description,
            activity: activity,
            apps: apps,
            topics: topics
        )
    }
    
    static func normalizeActivity(_ activity: String) -> String {
        let normalized = activity.lowercased().trimmingCharacters(in: .whitespaces)
        let aliases = [
            "debug": "debugging",
            "code": "coding",
            "review": "review",
            "meet": "meeting",
            "research": "research",
            "read": "reading",
            "terminal": "terminal",
            "cli": "terminal"
        ]
        for (key, val) in aliases {
            if normalized.contains(key) { return val }
        }
        return normalized
    }
    
    private static func parseList(_ str: String) -> [String] {
        // "[app1, app2]" → ["app1", "app2"]
        let trimmed = str.trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
        return trimmed.split(separator: ",").map {
            String($0).trimmingCharacters(in: .whitespaces)
        }
    }
}
```

### ObservationStore Protocol

New port interface (mirroring FrameStore pattern):

```swift
// ObservationStore.swift
protocol ObservationStore: Sendable {
    func claimFrames(batchSize: Int) async throws -> [DbFrame]
    func saveObservations(from frames: [DbFrame], descriptions: [FrameDescription]) async throws
    func markFramesAnalyzed(ids: [String]) async throws
}

// SQLiteObservationStore.swift
actor SQLiteObservationStore: ObservationStore {
    private let db: Database
    
    func claimFrames(batchSize: Int) async throws -> [DbFrame] {
        // SELECT * FROM frames WHERE analyzed = 0 LIMIT batchSize
        // (No locking needed; single process)
    }
    
    func saveObservations(from frames: [DbFrame], descriptions: [FrameDescription]) async throws {
        // INSERT INTO observations (frame_id, vlm_description, activity_type, apps, topics, ...)
        // FOR EACH (frame, description) pair
    }
    
    func markFramesAnalyzed(ids: [String]) async throws {
        // UPDATE frames SET analyzed = 1 WHERE id IN (...)
    }
}
```

### VLMRunner Enhancement

Extends the POC implementation (`scripts/poc-mlx-swift/Sources/VLMRunner.swift`) with a `runBatch` function that:
- Accepts pre-loaded `ModelContainer` (avoid reload per batch)
- Returns structured `[FrameDescription]` instead of raw strings
- Integrates with `ResponseParser.parseInterleavedOutput()`

## Consequences

### Positive

- **Eliminates Python bridge** — No venv, no `uv` lockfiles, no version conflicts
- **Instant startup** — Native binary, VLM model loads on process start (one-time cost)
- **Lower memory** — 17% less than Python bridge (external benchmark)
- **No IPC overhead** — Swift async/await, single process
- **Decoupled parsing** — `ResponseParser.swift` is testable, reusable
- **Always-loaded model** — No load/unload per batch cycle
- **Single-writer guarantee** — No concurrent analyzer risk (single process)

### Negative

- **Xcode required to build** — Metal shader embedding (same as POC limitation)
- **Two languages remain** — Swift for perception (capture + VLM), TypeScript for reasoning (segmentation + LLM). Deferred to Phase 4+ unification.
- **Model size** — 4B model ~4GB (vs 2B ~2GB), trade-off for better quality. Configurable via `ESCRIBANO_VLM_MODEL` if needed.

### Neutral

- **Batch pipeline unchanged** — Python bridge (`intelligence.mlx.adapter.ts`) retained for `--file` mode. No migration burden.
- **Database schema unchanged** — Same `frames` + `observations` tables; removes need for `process_locks` table.
- **TypeScript layer untouched** — Segmentation, LLM artifact generation, all existing logic works as-is.

## What Supersedes

| Superseded | Reason |
|-----------|--------|
| **TDD-002 (Node Batch Analyzer)** | Entire Node.js analyzer process eliminated. VLM inference now in-process Swift task. |
| **ADR-009 Phase 2 description** | Updated (see ADR-009 revision note). Phase 2 now means "VLM Analyzer task in Swift" not "Node batch analyzer". |
| **`process_locks` table design** | No longer needed (single process). Migration 015 adjusted to remove this table. |

## Migration Path

### Phase 1 (Complete)
- Swift capture agent shipping with pHash dedup, backpressure, LaunchAgent

### Phase 2 (This ADR)
- Add VLM analyzer task to same Swift process
- `mlx-swift-lm` dependency in `Package.swift`
- `VLMAnalyzer.swift`, `ResponseParser.swift`, `ObservationStore` port/adapter
- No Node.js analyzer needed

### Phase 3+ (Unchanged)
- Segmentation CLI (`escribano cut`) — reads observations, unchanged
- Artifact generation — LLM subject grouping, unchanged

## Build & Deployment

### Development (MVP)

```bash
# Compile with Metal shader embedding
cd apps/recorder
swift build -c release

# Install as LaunchAgent
npx escribano recorder install
```

### Production (Post-MVP)

Pre-built universal binary (ARM64 + x86_64) via GitHub Releases. Deferred pending validation.

## Deferred Decisions

| Topic | Reason |
|-------|--------|
| **Swift-only architecture** | Batch pipeline (`--file` mode) continues using Python bridge. Unify to Swift later if warranted. |
| **Other LLMs in Swift** | Qwen3.5 (subject grouping) via MLX-LM already works (POC verified). No blocker; using Node → Python bridge for now. Migrate if batch performance becomes issue. |
| **Model quantization options** | Currently hardcoded `Qwen3-VL-4B-Instruct-4bit`. Configurable via `ESCRIBANO_VLM_MODEL` if needed. |
| **Cross-platform recorder** | macOS-only for MVP (ScreenCaptureKit locks us). When Windows support warranted, create OS-specific capture adapters. |

## References

- [MLX-Swift POC Findings](../poc/mlx-swift-poc-findings.md) — Benchmark validation, Swift 6 concurrency patterns
- [ADR-009: Always-On Recorder](009-always-on-recorder.md) — Architecture that TDD-002 was designed for (now superseded by this ADR)
- [ADR-005: VLM-First Visual Pipeline](005-vlm-first-visual-pipeline.md) — Why VLM-first matters
- [ADR-006: MLX-VLM Adapter](006-mlx-vlm-adapter.md) — Current Python bridge (retained for batch mode)
- [TDD-001: Swift Capture Agent](../tdd/001-swift-capture-agent.md) — Phase 1 (extended by this ADR's Phase 2)
- [TDD-002: Node Batch Analyzer](../tdd/002-node-batch-analyzer.md) — SUPERSEDED by this ADR

## Addendum: Phase 2 Implementation Reality (2026-03-16)

When ADR-010 was drafted we believed the mlx-swift-lm POC measured 220 tok/s for Vision-Language inference and therefore promised a Swift-native VLM analyzer. The real benchmark was for a **text-only** LLM (Qwen3.5-27B) and never covered Qwen3-VL. During implementation mlx-swift-lm issue #19 revealed that every Qwen3-VL model runs at **10-13 tok/s** in Swift, a **15× regression** compared to the Python mlx-vlm bridge (170-190 tok/s on 4bit models).

Rather than wait for mlx-swift-lm to fix the perf bug, we pivoted: the recorder now reaches back to the existing Python bridge via the Unix socket (`~/.escribano/scripts/mlx_bridge.py`). Swift now implements a `VLMInferenceService` port that drives a new `PythonBridgeVLMAdapter`, which maintains a long-lived Unix socket connection, translates `VLMRequest`/`VLMResponse` payloads, and keeps the Python bridge running alongside the recorder.

### Actual Architecture Changes

- **What was deleted/renamed**: `VLMAnalyzer.swift` became `FrameAnalyzer.swift` and its dependency on `MLXLMCommon` was removed; `VLMRunner.swift` was deleted. `Package.swift` no longer depends on `mlx-swift-lm`.
- **What was added**: `Prompts.swift` (prompt builder extracted from the batch code), `VLMInferenceService.port.swift` (port + request/response structs), and `PythonBridge.vlm.adapter.swift` (adapter that drives the Python bridge).
- **Behavioral change**: Swift now always sends a batch-style prompt (even for a single frame), reuses the bridge via `/tmp/escribano-recorder-vlm.sock`, and writes observations once the Python response arrives
- **Documentation fix**: The status table now clearly states the pivot and points here for details
### Consequences

- **Positive**: Restores the 170-190 tok/s throughput from the Python bridge, eliminates the slow mlx-swift-lm dependency, and preserves the improved parsing/port structure from ADR-010.
- **Negative**: The recorder now depends on an extra Python process (`mlx_bridge.py`) copied to `~/.escribano/scripts/` during `recorder install`. The Unix socket is separate (`/tmp/escribano-recorder-vlm.sock`) so it does not conflict with the batch pipeline.
- **Neutral**: The TypeScript side remains unchanged; this change simply reuses its proven bridge implementation instead of reimplementing it in Swift.
