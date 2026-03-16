import Foundation
import SQLite3

struct Observation {
    let imagePath: String
    let oldDescription: String
}

enum DBReader {
    
    static func loadObservations(recordingId: String, limit: Int? = nil) throws -> [Observation] {
        let dbPath = "\(NSHomeDirectory())/.escribano/escribano.db"
        var db: OpaquePointer?
        
        guard sqlite3_open(dbPath, &db) == SQLITE_OK else {
            throw NSError(domain: "DBReader", code: -1, userInfo: [NSLocalizedDescriptionKey: "Failed to open database"])
        }
        defer { sqlite3_close(db) }
        
        let query = """
        SELECT image_path, vlm_description 
        FROM observations 
        WHERE recording_id = ? AND type = 'visual' 
          AND vlm_description IS NOT NULL 
          AND image_path IS NOT NULL 
        ORDER BY timestamp
        \(limit.map { "LIMIT \($0)" } ?? "")
        """
        
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, query, -1, &stmt, nil) == SQLITE_OK else {
            throw NSError(domain: "DBReader", code: -1, userInfo: [NSLocalizedDescriptionKey: "Failed to prepare statement"])
        }
        defer { sqlite3_finalize(stmt) }
        
        // Bind recordingId — use nil as destructor (let SQLite handle memory)
        guard sqlite3_bind_text(stmt, 1, recordingId, -1, nil) == SQLITE_OK else {
            throw NSError(domain: "DBReader", code: -1, userInfo: [NSLocalizedDescriptionKey: "Failed to bind parameter"])
        }
        
        var observations: [Observation] = []
        while sqlite3_step(stmt) == SQLITE_ROW {
            let imagePath = String(cString: sqlite3_column_text(stmt, 0))
            let vlmDesc = String(cString: sqlite3_column_text(stmt, 1))
            observations.append(Observation(imagePath: imagePath, oldDescription: vlmDesc))
        }
        
        return observations
    }
}
