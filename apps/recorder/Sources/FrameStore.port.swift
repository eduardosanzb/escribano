import Foundation

// MARK: - FrameStoreError
// Protocol-level error type. Abstracts away implementation-specific errors
// (like SQLite error codes) so that callers (StreamCapture, Backpressure)
// don't need to know about the underlying storage mechanism.
enum FrameStoreError: Error, LocalizedError {
    case connectionFailed(String)
    case schemaMismatch(current: Int32, expected: Int32)
    case insertFailed(String)
    case queryFailed(String)

    var errorDescription: String? {
        switch self {
        case .connectionFailed(let msg):
            return "FrameStore connection failed: \(msg)"
        case .schemaMismatch(let current, let expected):
            return "Schema mismatch: version \(current), expected \(expected)"
        case .insertFailed(let msg):
            return "Frame insert failed: \(msg)"
        case .queryFailed(let msg):
            return "Query failed: \(msg)"
        }
    }
}

// MARK: - FrameMetadata
// Value type representing a captured frame's metadata.
// This struct is passed to the store for persistence, keeping the protocol
// clean of implementation details (like SQLite statement handles).
struct FrameMetadata {
    let id: String
    let displayId: String
    let capturedAt: String
    let timestamp: Double
    let imagePath: String
    let phash: String
    let width: Int
    let height: Int
}

// MARK: - FrameStore Protocol
// Port interface for frame persistence. Following the Port/Adapter pattern:
// - Protocol (Port): Defines what operations the business logic needs
// - Concrete impl (Adapter): SQLiteFrameStore implements this protocol
//
// Benefits:
// - Testability: Can mock FrameStore in unit tests
// - Flexibility: Can swap backends (e.g., PostgreSQL, cloud storage)
// - Separation: Business logic (StreamCapture, Backpressure) is decoupled from storage
protocol FrameStore: AnyObject, Sendable {
    // Schema version this store implementation expects.
    // The concrete implementation should check this on init and throw
    // FrameStoreError.schemaMismatch if the database is out of date.
    static var expectedSchemaVersion: Int32 { get }

    // Inserts a frame's metadata into persistent storage.
    // Throws FrameStoreError.insertFailed on failure.
    func insertFrame(_ metadata: FrameMetadata) throws

    // Returns the count of frames awaiting analysis (analyzed = 0).
    // Throws FrameStoreError.queryFailed on failure.
    func pendingFrameCount() throws -> Int

    // Returns the total count of all frames (regardless of analyzed state).
    // Throws FrameStoreError.queryFailed on failure.
    func totalFrameCount() throws -> Int

    /// Fetch up to `batchSize` frames pending analysis (analyzed = 0, retry_count < 3).
    /// Returns oldest frames first (ORDER BY timestamp ASC).
    func claimFrames(batchSize: Int) throws -> [DbFrame]

    /// Set `analyzed = 1` for all frame IDs in the list (batch UPDATE).
    func markFramesAnalyzed(ids: [String]) throws

    /// Increment `retry_count` for a frame. If retry_count reaches 3, set `analyzed = 2`
    /// (permanently skipped — won't appear in future claimFrames calls).
    func markFrameFailed(id: String) throws

    /// Release frames back to the unanalyzed pool without incrementing retry_count.
    /// Used when the bridge crashes mid-batch — these frames were never actually analyzed.
    /// Only releases frames still in unanalyzed state (analyzed = 0).
    func releaseFrames(ids: [String]) throws

    // Releases resources (closes connections, etc.).
    func close()
}
