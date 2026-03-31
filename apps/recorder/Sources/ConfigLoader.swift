import Foundation

/// Loads environment variables from ~/.escribano/.env into the process environment.
/// Called early in app startup before any components read ProcessInfo.processInfo.environment.
/// Existing environment variables are NOT overwritten (shell env takes precedence).
func loadEnvFile(path: String = "~/.escribano/.env") {
    let expandedPath = (path as NSString).expandingTildeInPath
    
    guard FileManager.default.fileExists(atPath: expandedPath),
          let contents = try? String(contentsOfFile: expandedPath, encoding: .utf8) else {
        log("[ConfigLoader] No .env file found at \(expandedPath), using defaults")
        return
    }
    
    var loadedCount = 0
    var loadedVars: [String] = []
    
    for line in contents.components(separatedBy: .newlines) {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        
        // Skip empty lines and comments
        guard !trimmed.isEmpty, !trimmed.hasPrefix("#") else { continue }
        
        // Parse KEY=VALUE format
        guard let equalsIndex = trimmed.firstIndex(of: "=") else { continue }
        
        let key = String(trimmed[..<equalsIndex])
            .trimmingCharacters(in: .whitespaces)
        
        var value = String(trimmed[trimmed.index(after: equalsIndex)...])
            .trimmingCharacters(in: .whitespaces)
        
        // Remove surrounding quotes if present
        if (value.hasPrefix("\"") && value.hasSuffix("\"")) ||
           (value.hasPrefix("'") && value.hasSuffix("'")) {
            value = String(value.dropFirst().dropLast())
        }
        
        // Only set if not already in environment (shell env takes precedence)
        if ProcessInfo.processInfo.environment[key] == nil {
            setenv(key, value, 0) // 0 = don't overwrite existing
            loadedCount += 1
            if key.starts(with: "ESCRIBANO_") {
                loadedVars.append(key)
            }
        }
    }
    
    if loadedCount > 0 {
        log("[ConfigLoader] Loaded \(loadedCount) variables from .env: \(loadedVars.joined(separator: ", "))")
    } else {
        log("[ConfigLoader] .env file parsed but no new variables set (all already in environment)")
    }
}
