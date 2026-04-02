# Implementation Plan: Swift App .env File Loading

**Date**: 2026-03-31
**Status**: COMPLETED

## Overview

The Swift recorder app currently reads all configuration from `ProcessInfo.processInfo.environment`, which only sees environment variables set at process launch time. When users launch the app from Finder/Dock (not from terminal), the app has no access to variables defined in `~/.escribano/.env`. This implementation adds `.env` file parsing directly in the Swift app, loading configuration on startup so user settings are respected regardless of how the app is launched.

## Problem Statement

User changed `ESCRIBANO_ANALYZE_BATCH_SIZE=1` in `~/.escribano/.env`, sourced the file in terminal, then reopened the app from Finder. The app still showed batch size 5 (the hardcoded default) because:
1. Sourcing `.env` in terminal only affects that shell session
2. Launching from Finder doesn't inherit shell environment
3. The Swift app doesn't parse `.env` itself

## Scope

- Work units: 3
- Execution phases: 2
- Files affected:
  - `apps/recorder/Sources/ConfigLoader.swift` — create
  - `apps/recorder/Sources/main.swift` — modify

## Work Units

### WU-1: Create ConfigLoader.swift

**Dependencies**: none

**Context**: The Swift app needs a utility to parse `~/.escribano/.env` and inject variables into the process environment via `setenv()`. This must happen before any component reads `ProcessInfo.processInfo.environment`. The parser should handle:
- Comments (lines starting with `#`)
- Empty lines
- Key=value pairs with optional quotes
- Not overwriting existing environment variables (shell env takes precedence)

**Files**:
- `apps/recorder/Sources/ConfigLoader.swift` — create

**Steps**:
1. Create new file `apps/recorder/Sources/ConfigLoader.swift` with this content:
```swift
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
```

2. The function uses `setenv(key, value, 0)` where the third parameter `0` means "don't overwrite if already exists". This ensures shell environment variables take precedence over `.env` file values.

3. The function logs what it loaded for debugging purposes, but only shows ESCRIBANO_* variables in the log message (not sensitive values like API tokens).

**Verification**: `cd apps/recorder && swift build 2>&1 | grep -c "error:" | grep -q "^0$"`

**Rollback**: `rm -f apps/recorder/Sources/ConfigLoader.swift`

---

### WU-2: Integrate ConfigLoader into main.swift

**Dependencies**: WU-1

**Context**: The `loadEnvFile()` function must be called BEFORE any code reads `ProcessInfo.processInfo.environment`. The earliest safe point is at the beginning of `applicationDidFinishLaunching`, before the menu bar is created and before the bootstrap task begins. This ensures all components (FrameAnalyzer, StreamCapture, SessionAggregator, PythonBridge) see the loaded environment variables.

**Files**:
- `apps/recorder/Sources/main.swift` — modify

**Steps**:
1. In `main.swift`, find the `applicationDidFinishLaunching` method (line 38).

2. Add a call to `loadEnvFile()` as the FIRST line of the method, before any other code:
```swift
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Load .env file early, before any components read environment variables
        loadEnvFile()
        
        signal(SIGTERM) { _ in
            DispatchQueue.main.async {
                log("[escribano-recorder] SIGTERM — shutting down")
                NSApp.terminate(nil)
            }
        }
        // ... rest of existing code
```

3. The call must happen before:
   - Line 52: `ProcessInfo.processInfo.environment["ESCRIBANO_BUILD_COMMIT"]`
   - Line 56: MenuBarController creation (which may read env vars)
   - Line 63: Bootstrap task (which initializes all components)

4. No other changes needed - the existing code will automatically pick up the loaded environment variables because they all use `ProcessInfo.processInfo.environment`.

**Verification**: 
```bash
cd apps/recorder && swift build 2>&1 | grep -c "error:" | grep -q "^0$"
# Then test: set ESCRIBANO_ANALYZE_BATCH_SIZE=1 in ~/.escribano/.env
# Run app from Finder, check logs for "Loaded X variables from .env"
```

**Rollback**: `git checkout -- apps/recorder/Sources/main.swift`

---

### WU-3: Add ConfigLoader.swift to Package.swift

**Dependencies**: WU-1

**Context**: The new `ConfigLoader.swift` file needs to be included in the Swift package build. Since it's in the `Sources/` directory alongside other Swift files, it should be picked up automatically by the default target configuration. However, we should verify the Package.swift doesn't have explicit file lists that would exclude it.

**Files**:
- `apps/recorder/Package.swift` — verify (no changes likely needed)

**Steps**:
1. Check `Package.swift` to confirm it uses default target discovery (no explicit `sources` parameter that would exclude new files).

2. The current Package.swift should have a target like:
```swift
.target(
    name: "escribano",
    dependencies: [],
    path: "Sources"
)
```

3. If the target uses `sources: ["specific", "files"]` explicitly, add `"ConfigLoader.swift"` to the list. Otherwise, no changes needed.

**Verification**: `cd apps/recorder && swift build 2>&1 | grep -i "configloader\|error" | head -10`

**Rollback**: N/A (verification only)

---

## Execution Plan

### Phase 1 — Parallel (no dependencies)
- WU-1: Create ConfigLoader.swift
- WU-3: Verify Package.swift includes new file

### Phase 2 — Sequential (requires Phase 1)
- WU-2: Integrate ConfigLoader into main.swift

## Testing Strategy

1. **Unit test**: Set a test variable in `~/.escribano/.env`, run app from terminal, verify log shows loaded variable
2. **Integration test**: Set `ESCRIBANO_ANALYZE_BATCH_SIZE=1` in `.env`, launch from Finder, verify batch size 1 is used
3. **Precedence test**: Set same variable in both shell env and `.env` with different values, verify shell env wins

## Recovery Strategy

- **Automatic**: Each implementor rolls back and retries once on failure.
- **Dependency failure**: If WU-1 fails, WU-2 will be skipped.
- **Global rollback**: `git checkout -- apps/recorder/Sources/main.swift && rm -f apps/recorder/Sources/ConfigLoader.swift`
- **Verification**: After Phase 2, run `swift build` to verify clean compilation.

## Success Criteria

1. App logs "Loaded X variables from .env" on startup when `.env` file exists
2. Variables set in `~/.escribano/.env` are respected when app launches from Finder
3. Shell environment variables take precedence over `.env` file values
4. No regression: app still works if `.env` file is missing or empty
