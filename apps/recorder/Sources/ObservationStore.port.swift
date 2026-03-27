import Foundation
// ============================================================================
// Shared value types for Phase 2 VLM pipeline
// ============================================================================
// MARK: - FrameDescription
// The structured output from parsing one VLM response line.
// "Sendable" means this value is safe to pass across actor and task boundaries —
// Swift 6 enforces this at compile time. Structs with only value-type fields
// (String, [String]) are automatically Sendable.
struct VLMStats: Sendable {
    let model: String
    let promptTokens: Int
    let generationTokens: Int
    let promptTps: Double
    let generationTps: Double
    let inferenceMs: Int
    let peakMemoryGb: Double
    let batchSize: Int

    func toJsonString() -> String? {
        let dict: [String: Any] = [
            "model":             model,
            "prompt_tokens":     promptTokens,
            "generation_tokens": generationTokens,
            "prompt_tps":        promptTps,
            "generation_tps":    generationTps,
            "inference_ms":      inferenceMs,
            "peak_memory_gb":    peakMemoryGb,
            "batch_size":        batchSize,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: dict),
              let str  = String(data: data, encoding: .utf8) else { return nil }
        return str
    }
}

struct FrameDescription: Sendable {
    let description: String  // e.g. "Fixing TypeScript type error in the fetch handler"
    let activity: String     // normalized: "debugging" | "coding" | "review" | ... | "other"
    let apps: [String]       // e.g. ["VS Code", "Chrome"]
    let topics: [String]     // e.g. ["TypeScript", "API"]
    let vlmStats: VLMStats?
}
// MARK: - DbFrame
// A row read from the `frames` table. Used by VLMAnalyzer to pass frames into the
// VLM batch pipeline. Separate from FrameMetadata (which is write-only on insert).
struct DbFrame: Sendable {
    let id: String
    let displayId: String
    let capturedAt: String
    let timestamp: Double
    let imagePath: String
    let phash: String
    let width: Int
    let height: Int
    let retryCount: Int
}

// MARK: - UnclaimedObservation
// An observation row enriched with its frame's captured_at timestamp.
// Used by SessionAggregator for LLM-based semantic grouping into TopicBlocks.
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
// ============================================================================
// Port interface
// ============================================================================
// MARK: - ObservationStoreError
enum ObservationStoreError: Error, LocalizedError {
    case connectionFailed(String)
    case queryFailed(String)
    case insertFailed(String)
    var errorDescription: String? {
        switch self {
        case .connectionFailed(let m): return "ObservationStore connection failed: \(m)"
        case .queryFailed(let m):      return "ObservationStore query failed: \(m)"
        case .insertFailed(let m):     return "ObservationStore insert failed: \(m)"
        }
    }
}
// MARK: - ObservationStore Protocol
//
// Port interface for Phase 2: reads unanalyzed frames, writes observations, marks frames done.
//
// Why "AnyObject"?
//   This constrains the protocol to class (reference) types only. Actors are reference types.
//   Without this, Swift can't guarantee the type has reference semantics needed for shared state.
//
// Why "Sendable"?
//   VLMAnalyzer (an actor) stores a reference to an ObservationStore. Swift 6 requires any
//   value stored in an actor to be Sendable — meaning it's safe to share across isolation
//   boundaries. Actors are implicitly Sendable, so SQLiteObservationStore (an actor) satisfies this.
//
// Why all methods are "async throws"?
//   The adapter is an actor (SQLiteObservationStore). Calling an actor's methods from outside
//   always requires "await" in Swift 6. Using "async" in the protocol makes this explicit.
//   "throws" allows DB errors to propagate up cleanly.
protocol ObservationStore: AnyObject, Sendable {
    /// Insert one observations row per (frame, description) pair.
    /// `frame_id` links back to the frames table.
    func saveObservations(from frames: [DbFrame], descriptions: [FrameDescription]) async throws
    /// Fetch observations not yet claimed by any TopicBlock.
    /// Returns observations ordered by timestamp ASC (oldest first).
    /// Uses frame.captured_at when available for accurate timestamps.
    /// These observations are grouped via LLM-based semantic analysis in SessionAggregator.
    /// - Parameter limit: Maximum number of observations to return (default 300)
    func fetchUnclaimed(limit: Int) async throws -> [UnclaimedObservation]
    /// Atomically claim observations for a TopicBlock.
    /// Sets tb_id on all observation IDs. Uses WHERE tb_id IS NULL guard
    /// to prevent double-claiming. Returns the count of rows actually updated.
    func claimObservations(ids: [String], tbId: String) async throws -> Int
    /// NEW — releases the sqlite3 handle on shutdown
    func close() async
}

extension ObservationStore {
    func close() async {}
}
