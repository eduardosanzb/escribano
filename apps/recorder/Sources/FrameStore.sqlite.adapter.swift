import Foundation
import SQLite3

// SQLITE_TRANSIENT: tells SQLite to make its own copy of the string
// In Swift, we use unsafeBitCast to represent this constant from the C API.
private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

// MARK: - SQLiteFrameStore
// Adapter implementation of FrameStore using SQLite C API.
//
// This class handles:
// - Database connection lifecycle
// - SQLite pragma configuration (WAL mode, etc.)
// - Schema version validation on startup
// - Frame metadata persistence
//
// Architecture note: This is the "Adapter" in the Port/Adapter pattern.
// The Port (FrameStore protocol) is defined in FrameStore.swift and knows
// nothing about SQLite. This adapter bridges the protocol to SQLite specifics.
final class SQLiteFrameStore: FrameStore {
    private var handle: OpaquePointer?

    // Must match the version set by migration 014_recorder_frames.sql
    // and updated by src/db/migrate.ts after each migration.
    static let expectedSchemaVersion: Int32 = 17

    // MARK: - Initialization

    /// Creates a new SQLite connection and validates schema version.
    /// - Parameter path: Full path to the SQLite database file.
    /// - Throws: FrameStoreError.connectionFailed if open fails,
    ///           FrameStoreError.schemaMismatch if version is stale.
    init(path: String) throws {
        // Ensure parent directory exists using FileManager
        let dir = (path as NSString).deletingLastPathComponent
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)

        // sqlite3_open_v2: opens or creates the database file
        // SQLITE_OPEN_READWRITE: allows reads and writes
        // SQLITE_OPEN_CREATE: creates file if it doesn't exist
        let rc = sqlite3_open_v2(path, &handle, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, nil)
        guard rc == SQLITE_OK else {
            let errMsg = handle.map { String(cString: sqlite3_errmsg($0)) } ?? "unknown"
            throw FrameStoreError.connectionFailed(errMsg)
        }

        // Match Node.js pragma config exactly (src/db/index.ts:42-45)
        // WAL (Write-Ahead Logging) allows concurrent reads while writes are in progress.
        // This is critical for the capture agent (writer) and analyzer (reader) to coexist.
        try exec("PRAGMA journal_mode = WAL")
        try exec("PRAGMA synchronous = NORMAL")
        try exec("PRAGMA foreign_keys = ON")
        try exec("PRAGMA busy_timeout = 5000")

        // Schema version check — agent cannot run migrations, it only consumes the DB.
        // The Node.js CLI (escribano recorder install) is responsible for running migrations.
        let version = try getUserVersion()
        guard version >= Self.expectedSchemaVersion else {
            throw FrameStoreError.schemaMismatch(current: version, expected: Self.expectedSchemaVersion)
        }
    }

    // MARK: - FrameStore Protocol Implementation

    /// Inserts frame metadata into the frames table.
    /// - Parameter metadata: The frame metadata to persist.
    /// - Throws: FrameStoreError.insertFailed on SQLite errors.
    func insertFrame(_ metadata: FrameMetadata) throws {
        let sql = """
            INSERT INTO frames
              (id, display_id, captured_at, timestamp, image_path, phash, width, height)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """
        var stmt: OpaquePointer?

        // sqlite3_prepare_v2: compiles the SQL string into a prepared statement
        // This is more efficient than sqlite3_exec for repeated inserts because
        // the statement can be reused (though we finalize after each use here).
        guard sqlite3_prepare_v2(handle, sql, -1, &stmt, nil) == SQLITE_OK else {
            let errMsg = String(cString: sqlite3_errmsg(handle))
            throw FrameStoreError.insertFailed(errMsg)
        }
        defer { sqlite3_finalize(stmt) }

        // Binding parameters to the prepared statement
        // Parameter indices are 1-based in SQLite
        sqlite3_bind_text(stmt, 1, metadata.id,         -1, SQLITE_TRANSIENT)
        sqlite3_bind_text(stmt, 2, metadata.displayId,  -1, SQLITE_TRANSIENT)
        sqlite3_bind_text(stmt, 3, metadata.capturedAt, -1, SQLITE_TRANSIENT)
        sqlite3_bind_double(stmt, 4, metadata.timestamp)
        sqlite3_bind_text(stmt, 5, metadata.imagePath,  -1, SQLITE_TRANSIENT)
        sqlite3_bind_text(stmt, 6, metadata.phash,      -1, SQLITE_TRANSIENT)
        sqlite3_bind_int(stmt, 7, Int32(metadata.width))
        sqlite3_bind_int(stmt, 8, Int32(metadata.height))

        // sqlite3_step: executes the statement
        // SQLITE_DONE means the statement completed successfully
        let rc = sqlite3_step(stmt)
        guard rc == SQLITE_DONE else {
            let errMsg = String(cString: sqlite3_errmsg(handle))
            throw FrameStoreError.insertFailed(errMsg)
        }
    }

    /// Returns the number of frames currently pending analysis (analyzed = 0).
    /// - Throws: FrameStoreError.queryFailed on SQLite errors.
    /// - Returns: Count of unanalyzed frames.
    func pendingFrameCount() throws -> Int {
        var stmt: OpaquePointer?
        let sql = "SELECT COUNT(*) FROM frames WHERE analyzed = 0"

        guard sqlite3_prepare_v2(handle, sql, -1, &stmt, nil) == SQLITE_OK else {
            let errMsg = String(cString: sqlite3_errmsg(handle))
            throw FrameStoreError.queryFailed(errMsg)
        }
        defer { sqlite3_finalize(stmt) }

        // sqlite3_step advances to the first (and only) row
        sqlite3_step(stmt)

        // Column 0 contains the COUNT(*) result
        return Int(sqlite3_column_int(stmt, 0))
    }

    /// Closes the database connection and releases resources.
    func close() {
        sqlite3_close(handle)
        handle = nil
    }

    // MARK: - Private Helpers

    /// Retrieves the current PRAGMA user_version.
    /// This is set by the Node.js migration runner after each migration.
    private func getUserVersion() throws -> Int32 {
        var stmt: OpaquePointer?
        sqlite3_prepare_v2(handle, "PRAGMA user_version", -1, &stmt, nil)
        // defer: ensures the statement is finalized when the function returns
        defer { sqlite3_finalize(stmt) }
        sqlite3_step(stmt)
        return sqlite3_column_int(stmt, 0)
    }

    /// Executes a simple SQL command (no parameters).
    /// - Parameter sql: The SQL statement to execute.
    /// - Throws: FrameStoreError.queryFailed on SQLite errors.
    private func exec(_ sql: String) throws {
        var errmsg: UnsafeMutablePointer<CChar>?
        let rc = sqlite3_exec(handle, sql, nil, nil, &errmsg)
        guard rc == SQLITE_OK else {
            let msg = errmsg.map { String(cString: $0) } ?? "unknown"
            // sqlite3_free: must free error messages returned by sqlite3_exec
            sqlite3_free(errmsg)
            throw FrameStoreError.queryFailed(msg)
        }
    }
}
