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
