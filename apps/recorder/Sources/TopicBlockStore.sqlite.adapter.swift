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

        // Schema version check — the adapter cannot run migrations.
        // The Node.js CLI (escribano recorder install) is responsible for running migrations.
        let version = try Self.getUserVersion(handle: handle)
        guard version >= Self.expectedSchemaVersion else {
            sqlite3_close(handle)
            handle = nil
            throw TopicBlockStoreError.schemaMismatch(current: version, expected: Self.expectedSchemaVersion)
        }
    }

    // MARK: - Private Helpers

    private static func getUserVersion(handle: OpaquePointer?) throws -> Int32 {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(handle, "PRAGMA user_version", -1, &stmt, nil) == SQLITE_OK else {
            throw TopicBlockStoreError.queryFailed("Failed to prepare PRAGMA user_version")
        }
        defer { sqlite3_finalize(stmt) }
        sqlite3_step(stmt)
        return sqlite3_column_int(stmt, 0)
    }

    func save(_ block: TopicBlockInsert) async throws {
        log("[TopicBlockStore] save() called: id=\(block.id) recording=\(block.recordingId) obs=\(block.observationCount) from=\(Int(block.fromTs)) to=\(Int(block.toTs))")
        let sql = """
            INSERT INTO topic_blocks
              (id, recording_id, context_ids, classification, duration,
               from_ts, to_ts, observation_count, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        """
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &stmt, nil) == SQLITE_OK else {
            let errMsg = String(cString: sqlite3_errmsg(handle))
            log("[TopicBlockStore] save() prepare FAILED: \(errMsg)")
            throw TopicBlockStoreError.insertFailed(errMsg)
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
            let errMsg = String(cString: sqlite3_errmsg(handle))
            log("[TopicBlockStore] save() step FAILED rc=\(rc): \(errMsg) [SQLITE_CONSTRAINT=19, SQLITE_BUSY=5]")
            throw TopicBlockStoreError.insertFailed(errMsg)
        }
        log("[TopicBlockStore] save() OK: \(block.id)")
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
