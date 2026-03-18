import Foundation
import SQLite3
// SQLITE_TRANSIENT: instructs SQLite to copy the string immediately (same as FrameStore.sqlite.adapter.swift).
// We redefine it here because each file is its own compilation unit.
private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
// MARK: - SQLiteObservationStore
//
// "actor" keyword: this is not a class — it's an actor. See the explanation above.
// Every method is actor-isolated: callers must use "await".
// Swift guarantees the sqlite3* handle is accessed by only one task at a time.
actor SQLiteObservationStore: ObservationStore {
    private var handle: OpaquePointer?
    // Must match the version set after migration 015 runs.
    static let expectedSchemaVersion: Int32 = 15
    // MARK: - Init
    /// Opens a second SQLite connection to the same DB file.
    /// Having two connections (FrameStore + ObservationStore) is fine in WAL mode:
    /// WAL allows one writer + multiple readers concurrently without blocking.
    init(path: String) throws {
        // Ensure directory exists
        let dir = (path as NSString).deletingLastPathComponent
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let rc = sqlite3_open_v2(path, &handle, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, nil)
        guard rc == SQLITE_OK else {
            let errMsg = handle.map { String(cString: sqlite3_errmsg($0)) } ?? "unknown"
            throw ObservationStoreError.connectionFailed(errMsg)
        }
        // Match Node.js pragma config exactly (src/db/index.ts:42-45)
        let pragmas = [
            "PRAGMA journal_mode = WAL",
            "PRAGMA synchronous = NORMAL",
            "PRAGMA foreign_keys = ON",
            "PRAGMA busy_timeout = 5000"
        ]
        for pragma in pragmas {
            sqlite3_exec(handle, pragma, nil, nil, nil)
        }
    }
    // MARK: - ObservationStore Protocol
    /// Fetch a batch of unanalyzed frames, oldest first.
    func claimFrames(batchSize: Int) async throws -> [DbFrame] {
        let sql = """
            SELECT id, display_id, captured_at, timestamp, image_path,
                   phash, width, height, retry_count
            FROM frames
            WHERE analyzed = 0 AND retry_count < 3
            ORDER BY timestamp ASC
            LIMIT ?
        """
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &stmt, nil) == SQLITE_OK else {
            throw ObservationStoreError.queryFailed(String(cString: sqlite3_errmsg(handle)))
        }
        defer { sqlite3_finalize(stmt) }
        sqlite3_bind_int(stmt, 1, Int32(batchSize))
        var frames: [DbFrame] = []
        while sqlite3_step(stmt) == SQLITE_ROW {
            let frame = DbFrame(
                id:          String(cString: sqlite3_column_text(stmt, 0)),
                displayId:   String(cString: sqlite3_column_text(stmt, 1)),
                capturedAt:  String(cString: sqlite3_column_text(stmt, 2)),
                timestamp:   sqlite3_column_double(stmt, 3),
                imagePath:   String(cString: sqlite3_column_text(stmt, 4)),
                phash:       String(cString: sqlite3_column_text(stmt, 5)),
                width:       Int(sqlite3_column_int(stmt, 6)),
                height:      Int(sqlite3_column_int(stmt, 7)),
                retryCount:  Int(sqlite3_column_int(stmt, 8))
            )
            frames.append(frame)
        }
        return frames
    }
    /// Insert one observation row per (frame, description) pair.
    func saveObservations(from frames: [DbFrame], descriptions: [FrameDescription]) async throws {
        let sql = """
            INSERT INTO observations
              (id, frame_id, type, timestamp, image_path,
               vlm_description, activity_type, apps, topics, created_at)
            VALUES (?, ?, 'visual', ?, ?, ?, ?, ?, ?, datetime('now'))
        """
        for (frame, desc) in zip(frames, descriptions) {
            var stmt: OpaquePointer?
            guard sqlite3_prepare_v2(handle, sql, -1, &stmt, nil) == SQLITE_OK else {
                throw ObservationStoreError.insertFailed(String(cString: sqlite3_errmsg(handle)))
            }
            defer { sqlite3_finalize(stmt) }
            let obsId = UUID().uuidString
            let appsJson: String
            let topicsJson: String
            if let appsData = try? JSONSerialization.data(withJSONObject: desc.apps),
               let appsStr = String(data: appsData, encoding: .utf8) {
                appsJson = appsStr
            } else {
                appsJson = "[]"
            }
            if let topicsData = try? JSONSerialization.data(withJSONObject: desc.topics),
               let topicsStr = String(data: topicsData, encoding: .utf8) {
                topicsJson = topicsStr
            } else {
                topicsJson = "[]"
            }
            sqlite3_bind_text(stmt, 1, obsId,             -1, SQLITE_TRANSIENT)
            sqlite3_bind_text(stmt, 2, frame.id,          -1, SQLITE_TRANSIENT)
            sqlite3_bind_double(stmt, 3, frame.timestamp)
            sqlite3_bind_text(stmt, 4, frame.imagePath,   -1, SQLITE_TRANSIENT)
            sqlite3_bind_text(stmt, 5, desc.description,  -1, SQLITE_TRANSIENT)
            sqlite3_bind_text(stmt, 6, desc.activity,     -1, SQLITE_TRANSIENT)
            sqlite3_bind_text(stmt, 7, appsJson,          -1, SQLITE_TRANSIENT)
            sqlite3_bind_text(stmt, 8, topicsJson,        -1, SQLITE_TRANSIENT)
            let rc = sqlite3_step(stmt)
            guard rc == SQLITE_DONE else {
                throw ObservationStoreError.insertFailed(String(cString: sqlite3_errmsg(handle)))
            }
        }
    }
    /// Batch-mark frames as analyzed (analyzed = 1).
    func markFramesAnalyzed(ids: [String]) async throws {
        guard !ids.isEmpty else { return }
        let placeholders = ids.map { _ in "?" }.joined(separator: ", ")
        let sql = "UPDATE frames SET analyzed = 1 WHERE id IN (\(placeholders))"
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &stmt, nil) == SQLITE_OK else {
            throw ObservationStoreError.queryFailed(String(cString: sqlite3_errmsg(handle)))
        }
        defer { sqlite3_finalize(stmt) }
        for (i, id) in ids.enumerated() {
            sqlite3_bind_text(stmt, Int32(i + 1), id, -1, SQLITE_TRANSIENT)
        }
        let rc = sqlite3_step(stmt)
        guard rc == SQLITE_DONE else {
            throw ObservationStoreError.queryFailed(String(cString: sqlite3_errmsg(handle)))
        }
    }
    /// Increment retry_count. If it reaches 3, permanently skip (analyzed = 2).
    func markFrameFailed(id: String) async throws {
        let sql = """
            UPDATE frames
            SET retry_count = retry_count + 1,
                analyzed    = CASE WHEN retry_count + 1 >= 3 THEN 2 ELSE 0 END
            WHERE id = ?
        """
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &stmt, nil) == SQLITE_OK else {
            print("[ObservationStore] markFrameFailed prepare error: \(String(cString: sqlite3_errmsg(handle)))")
            return
        }
        defer { sqlite3_finalize(stmt) }
        sqlite3_bind_text(stmt, 1, id, -1, SQLITE_TRANSIENT)
        sqlite3_step(stmt)
    }
    func close() async {
        sqlite3_close(handle)
        handle = nil
    }
    // MARK: - Private Helpers
    private func exec(_ sql: String) throws {
        var errmsg: UnsafeMutablePointer<CChar>?
        let rc = sqlite3_exec(handle, sql, nil, nil, &errmsg)
        guard rc == SQLITE_OK else {
            let msg = errmsg.map { String(cString: $0) } ?? "unknown"
            sqlite3_free(errmsg)
            throw ObservationStoreError.queryFailed(msg)
        }
    }
}
