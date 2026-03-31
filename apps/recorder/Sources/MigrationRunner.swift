import Foundation
import SQLite3

// MARK: - MigrationError

/// Typed errors for the MigrationRunner.
enum MigrationError: Error, LocalizedError {
    case connectionFailed(String)
    case migrationFailed(filename: String, error: String)
    case directoryNotFound(String)

    var errorDescription: String? {
        switch self {
        case .connectionFailed(let msg):
            return "MigrationRunner: connection failed — \(msg)"
        case .migrationFailed(let filename, let error):
            return "MigrationRunner: migration '\(filename)' failed — \(error)"
        case .directoryNotFound(let path):
            return "MigrationRunner: migrations directory not found at '\(path)'"
        }
    }
}

// MARK: - MigrationRunner
//
// Caseless enum used as a namespace (same pattern as Prompts and ResponseParser).
//
// Replicates the behaviour of the Node.js migration runner (src/db/migrate.ts):
//   1. Creates _schema_version table if absent
//   2. Reads MAX(version) as current version
//   3. Scans migrationsDir for NNN_*.sql files, sorts ascending
//   4. For each pending migration: BEGIN → exec SQL → INSERT _schema_version
//      → COMMIT (ROLLBACK on any failure) → PRAGMA user_version (post-commit)
//   5. Closes the dedicated SQLite connection and returns results
//
// Both Node.js and Swift can manage the same database because they use the
// identical tracking mechanism (_schema_version table + PRAGMA user_version).
enum MigrationRunner {

    // MARK: - Public API

    /// Run pending migrations against the SQLite database at `dbPath`.
    ///
    /// Opens a **new**, short-lived SQLite connection dedicated to migrations.
    /// This is intentional — migrations must run before any store opens, so
    /// a temporary handle is appropriate.
    ///
    /// - Parameters:
    ///   - dbPath: Full filesystem path to the SQLite database file.
    ///   - migrationsDir: Directory containing NNN_description.sql files.
    /// - Returns: A tuple of (applied filenames, final schema version).
    /// - Throws: `MigrationError` on connection failure or failed migration.
    static func run(dbPath: String, migrationsDir: String) throws -> (applied: [String], currentVersion: Int32) {
        // Ensure parent directory exists so SQLite can create the DB file.
        let dir = (dbPath as NSString).deletingLastPathComponent
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)

        // Open a dedicated connection for migrations.
        var handle: OpaquePointer?
        let openRc = sqlite3_open_v2(dbPath, &handle, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, nil)
        guard openRc == SQLITE_OK else {
            let errMsg = handle.map { String(cString: sqlite3_errmsg($0)) } ?? "unknown"
            throw MigrationError.connectionFailed(errMsg)
        }
        // Always close the handle on exit, even when an error is thrown.
        defer {
            sqlite3_close(handle)
        }

        // Configure pragmas to match Node.js settings (src/db/index.ts).
        try exec(handle, "PRAGMA journal_mode = WAL")
        try exec(handle, "PRAGMA synchronous = NORMAL")
        try exec(handle, "PRAGMA foreign_keys = ON")
        try exec(handle, "PRAGMA busy_timeout = 5000")

        // Create the version tracking table used by both Node.js and Swift runners.
        try exec(handle, """
            CREATE TABLE IF NOT EXISTS _schema_version (
                version    INTEGER NOT NULL,
                applied_at TEXT DEFAULT (datetime('now'))
            )
        """)

        // Read the highest applied version (NULL on a fresh database → treat as 0).
        let currentVersion = try readCurrentVersion(handle)
        log("[MigrationRunner] Current schema version: \(currentVersion)")

        // Scan the migrations directory for matching SQL files.
        let migrationFiles = try loadMigrationFiles(from: migrationsDir)

        // Filter to only pending migrations and apply them in order.
        let pending = migrationFiles.filter { $0.version > currentVersion }

        if pending.isEmpty {
            log("[MigrationRunner] Database is up to date (version \(currentVersion))")
            return (applied: [], currentVersion: currentVersion)
        }

        log("[MigrationRunner] Found \(pending.count) pending migration(s). Applying...")

        var applied: [String] = []

        for migration in pending {
            log("[MigrationRunner] Applying: \(migration.filename)")

            // Read the SQL file contents.
            guard let sql = try? String(contentsOfFile: migration.path, encoding: .utf8) else {
                throw MigrationError.migrationFailed(
                    filename: migration.filename,
                    error: "Could not read file at \(migration.path)"
                )
            }

            do {
                try applyMigration(handle: handle, migration: migration, sql: sql)
                applied.append(migration.filename)
                log("[MigrationRunner] Applied: \(migration.filename) → version \(migration.version)")
            } catch {
                throw error
            }
        }

        // Re-read the final version from the tracking table.
        let finalVersion = try readCurrentVersion(handle)
        log("[MigrationRunner] Migrations complete. Schema version: \(finalVersion)")

        return (applied: applied, currentVersion: finalVersion)
    }

    // MARK: - Directory Resolution

    /// Resolves the migrations directory using the following priority:
    ///   1. `Bundle.main.resourceURL/.../migrations` — used inside `.app` bundles
    ///   2. `ESCRIBANO_MIGRATIONS_PATH` environment variable — dev override
    ///   3. Returns `nil` if neither source is available
    static func resolveMigrationsDir() -> String? {
        // 1. App bundle resources (Escribano.app/Contents/Resources/migrations/)
        if let resourceURL = Bundle.main.resourceURL {
            let bundlePath = resourceURL.appendingPathComponent("migrations").path
            if FileManager.default.fileExists(atPath: bundlePath) {
                return bundlePath
            }
        }

        // 2. Developer override via environment variable
        if let envPath = ProcessInfo.processInfo.environment["ESCRIBANO_MIGRATIONS_PATH"],
           !envPath.isEmpty {
            return envPath
        }

        // 3. Not found — caller should log and continue without migrations
        return nil
    }

    // MARK: - Private Helpers

    /// Represents a parsed migration file entry.
    private struct MigrationFile {
        let version: Int32
        let filename: String
        let path: String
    }

    /// Scans `dir` for files matching `^\d+_.+\.sql$`, extracts numeric prefixes,
    /// and returns them sorted ascending by version number.
    private static func loadMigrationFiles(from dir: String) throws -> [MigrationFile] {
        guard FileManager.default.fileExists(atPath: dir) else {
            throw MigrationError.directoryNotFound(dir)
        }

        let contents: [String]
        do {
            contents = try FileManager.default.contentsOfDirectory(atPath: dir)
        } catch {
            throw MigrationError.directoryNotFound("\(dir): \(error.localizedDescription)")
        }

        // Filter to files whose name matches the expected pattern.
        let pattern = try! NSRegularExpression(pattern: #"^(\d+)_.+\.sql$"#)

        let files: [MigrationFile] = contents.compactMap { filename -> MigrationFile? in
            let range = NSRange(filename.startIndex..., in: filename)
            guard let match = pattern.firstMatch(in: filename, range: range),
                  let numRange = Range(match.range(at: 1), in: filename),
                  let version = Int32(filename[numRange])
            else {
                return nil
            }
            let fullPath = (dir as NSString).appendingPathComponent(filename)
            return MigrationFile(version: version, filename: filename, path: fullPath)
        }

        // Sort ascending by version so migrations are applied in order.
        return files.sorted { $0.version < $1.version }
    }

    /// Reads `MAX(version)` from `_schema_version`. Returns 0 if the table is empty.
    private static func readCurrentVersion(_ handle: OpaquePointer?) throws -> Int32 {
        let sql = "SELECT MAX(version) FROM _schema_version"
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &stmt, nil) == SQLITE_OK else {
            let errMsg = String(cString: sqlite3_errmsg(handle))
            throw MigrationError.connectionFailed("Failed to prepare version query: \(errMsg)")
        }
        defer { sqlite3_finalize(stmt) }

        let stepRc = sqlite3_step(stmt)
        guard stepRc == SQLITE_ROW else {
            // Empty result set should not happen after CREATE TABLE IF NOT EXISTS, but guard anyway.
            return 0
        }

        // If the table is empty, MAX(version) returns NULL (SQLITE_NULL column type).
        if sqlite3_column_type(stmt, 0) == SQLITE_NULL {
            return 0
        }
        return sqlite3_column_int(stmt, 0)
    }

    /// Applies a single migration inside a transaction.
    /// On failure: rolls back and throws `MigrationError.migrationFailed`.
    private static func applyMigration(handle: OpaquePointer?, migration: MigrationFile, sql: String) throws {
        // Begin transaction.
        do {
            try exec(handle, "BEGIN TRANSACTION")
        } catch {
            throw MigrationError.migrationFailed(
                filename: migration.filename,
                error: "Could not begin transaction: \(error.localizedDescription)"
            )
        }

        // Execute the migration SQL.
        var errmsg: UnsafeMutablePointer<CChar>?
        let sqlRc = sqlite3_exec(handle, sql, nil, nil, &errmsg)
        if sqlRc != SQLITE_OK {
            let msg = errmsg.map { String(cString: $0) } ?? "unknown"
            sqlite3_free(errmsg)
            execNoThrow(handle, "ROLLBACK")
            throw MigrationError.migrationFailed(filename: migration.filename, error: msg)
        }

        // Insert the version into the tracking table.
        let insertSql = "INSERT INTO _schema_version (version) VALUES (?)"
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(handle, insertSql, -1, &stmt, nil) == SQLITE_OK else {
            let msg = String(cString: sqlite3_errmsg(handle))
            execNoThrow(handle, "ROLLBACK")
            throw MigrationError.migrationFailed(filename: migration.filename, error: "Failed to prepare version insert: \(msg)")
        }
        defer { sqlite3_finalize(stmt) }

        sqlite3_bind_int(stmt, 1, migration.version)
        let insertRc = sqlite3_step(stmt)
        guard insertRc == SQLITE_DONE else {
            let msg = String(cString: sqlite3_errmsg(handle))
            execNoThrow(handle, "ROLLBACK")
            throw MigrationError.migrationFailed(filename: migration.filename, error: "Failed to insert version: \(msg)")
        }

        // Commit the transaction first.
        do {
            try exec(handle, "COMMIT")
        } catch {
            execNoThrow(handle, "ROLLBACK")
            throw MigrationError.migrationFailed(
                filename: migration.filename,
                error: "Failed to commit: \(error.localizedDescription)"
            )
        }

        // Set PRAGMA user_version AFTER a successful COMMIT.
        // PRAGMA user_version is non-transactional — it writes immediately to the
        // DB header regardless of transaction state. Moving it here ensures the
        // _schema_version row and user_version stay in sync: if COMMIT fails we
        // roll back without having advanced user_version. If COMMIT succeeds but
        // the PRAGMA fails we throw, but no rollback is meaningful.
        do {
            try exec(handle, "PRAGMA user_version = \(migration.version)")
        } catch {
            throw MigrationError.migrationFailed(
                filename: migration.filename,
                error: "COMMIT succeeded but failed to set user_version: \(error.localizedDescription)"
            )
        }
    }

    /// Executes a simple SQL command (no parameters). Throws `MigrationError.connectionFailed` on failure.
    private static func exec(_ handle: OpaquePointer?, _ sql: String) throws {
        var errmsg: UnsafeMutablePointer<CChar>?
        let rc = sqlite3_exec(handle, sql, nil, nil, &errmsg)
        guard rc == SQLITE_OK else {
            let msg = errmsg.map { String(cString: $0) } ?? "unknown"
            sqlite3_free(errmsg)
            throw MigrationError.connectionFailed(msg)
        }
    }

    /// Non-throwing variant of exec used during ROLLBACK cleanup paths.
    @discardableResult
    private static func execNoThrow(_ handle: OpaquePointer?, _ sql: String) -> Bool {
        var errmsg: UnsafeMutablePointer<CChar>?
        let rc = sqlite3_exec(handle, sql, nil, nil, &errmsg)
        if rc != SQLITE_OK {
            let msg = errmsg.map { String(cString: $0) } ?? "unknown"
            sqlite3_free(errmsg)
            log("[MigrationRunner] Warning: cleanup exec failed ('\(sql)'): \(msg)")
        }
        return rc == SQLITE_OK
    }
}
