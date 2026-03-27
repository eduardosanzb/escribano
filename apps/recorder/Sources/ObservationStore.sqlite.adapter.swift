import Foundation
import SQLite3
// SQLITE_TRANSIENT: instructs SQLite to copy the string immediately (same as FrameStore.sqlite.adapter.swift).
// We redefine it here because each file is its own compilation unit.
private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
private let MIN_VALID_TIMESTAMP: Double = 1577836800.0  // 2020-01-01 00:00:00 UTC
// MARK: - SQLiteObservationStore
//
// "actor" keyword: this is not a class — it's an actor. See the explanation above.
// Every method is actor-isolated: callers must use "await".
// Swift guarantees the sqlite3* handle is accessed by only one task at a time.
actor SQLiteObservationStore: ObservationStore {
    private var handle: OpaquePointer?
    // Must match the version set after migration 017 runs.
    static let expectedSchemaVersion: Int32 = 17
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

        // Schema version check (matches FrameStore pattern)
        var version: Int32 = 0
        let versionSql = "PRAGMA user_version"
        var versionStmt: OpaquePointer?
        guard sqlite3_prepare_v2(handle, versionSql, -1, &versionStmt, nil) == SQLITE_OK else {
            throw ObservationStoreError.queryFailed("Failed to check schema version")
        }
        defer { sqlite3_finalize(versionStmt) }
        if sqlite3_step(versionStmt) == SQLITE_ROW {
            version = sqlite3_column_int(versionStmt, 0)
        }
        guard version >= Self.expectedSchemaVersion else {
            sqlite3_close(handle)
            handle = nil
            throw ObservationStoreError.queryFailed(
                "Database schema out of date (version \(version), expected \(Self.expectedSchemaVersion)). " +
                "Run 'escribano recorder install' from Node.js."
            )
        }
    }
    // MARK: - ObservationStore Protocol
    /// Insert one observation row per (frame, description) pair.
    func saveObservations(from frames: [DbFrame], descriptions: [FrameDescription]) async throws {
        let sql = """
            INSERT INTO observations
              (id, frame_id, type, timestamp, image_path,
               vlm_description, activity_type, apps, topics, vlm_stats, created_at)
            VALUES (?, ?, 'visual', ?, ?, ?, ?, ?, ?, ?, datetime('now'))
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
            if let statsJson = desc.vlmStats?.toJsonString() {
                sqlite3_bind_text(stmt, 9, statsJson,     -1, SQLITE_TRANSIENT)
            } else {
                sqlite3_bind_null(stmt, 9)
            }
            let rc = sqlite3_step(stmt)
            guard rc == SQLITE_DONE else {
                throw ObservationStoreError.insertFailed(String(cString: sqlite3_errmsg(handle)))
            }
        }
    }
    /// Fetch observations not yet claimed by any TopicBlock.
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
              AND o.frame_id IS NOT NULL
              AND o.vlm_description IS NOT NULL
              // Filter out observations with timestamps before 2020-01-01 (Unix epoch 1577836800).
              // This guards against observations with invalid/relative timestamps that could
              // skew aggregation results. Observations before this date are considered data errors.
              AND o.timestamp >= 1577836800.0
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

    /// Atomically claim observations for a TopicBlock.
    func claimObservations(ids: [String], tbId: String) async throws -> Int {
        guard !ids.isEmpty else { return 0 }
        log("[ObservationStore] claimObservations: tbId=\(tbId) ids=\(ids.count)")
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
            let errMsg = String(cString: sqlite3_errmsg(handle))
            log("[ObservationStore] claimObservations FAILED rc=\(rc): \(errMsg) [SQLITE_CONSTRAINT=19, SQLITE_BUSY=5]")
            throw ObservationStoreError.queryFailed(errMsg)
        }
        let changes = Int(sqlite3_changes(handle))
        log("[ObservationStore] claimObservations OK: \(changes) row(s) updated")
        return changes
    }

    func close() async {
        sqlite3_close(handle)
        handle = nil
    }
    // MARK: - Private Helpers
    private func parseJsonArray(_ json: String) -> [String] {
        guard let data = json.data(using: .utf8),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [String]
        else { return [] }
        return arr
    }
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
