# Implementation Plan: Fix Inline Comment Handling in ConfigLoader

**Date**: 2026-03-31
**Status**: COMPLETED

## Overview

The ConfigLoader.swift currently injects the entire value string (including inline comments) into environment variables. When a user writes:
```bash
ESCRIBANO_VLM_BATCH_SIZE=1         # 1-4 frames (lower = more reliable)
```

The Swift code injects:
```
"1         # 1-4 frames (lower = more reliable)"
```

Then Python tries to parse this as an integer and fails with:
```
ValueError: invalid literal for int() with base 10: '1         # 1-4 frames (lower = more reliable)'
```

This fix updates ConfigLoader to strip inline comments that are preceded by whitespace (matching Python, Go, Docker, and Rust behavior).

## Scope

- Work units: 1
- Execution phases: 1
- Files affected:
  - `apps/recorder/Sources/ConfigLoader.swift` — modify

## Work Units

### WU-1: Strip Inline Comments from .env Values

**Dependencies**: none

**Context**: The current ConfigLoader extracts the entire value from after `=` to the end of the line. It needs to be updated to:
1. Strip inline comments that are preceded by whitespace (` #` or `\t#`)
2. Respect quoted values (don't strip comments inside quotes)
3. Match the behavior of Python python-dotenv, Go godotenv, Docker Compose, and Rust dotenv

This follows the "de facto" standard: inline comments are supported but require whitespace before the `#` character.

**Files**:
- `apps/recorder/Sources/ConfigLoader.swift` — modify

**Steps**:
1. Read the current `ConfigLoader.swift` file (54 lines).

2. Replace the value extraction logic (lines 30-37) with a new implementation that:
   - First extracts the raw value (everything after `=`)
   - Checks if the value is quoted (starts with `"` or `'`)
   - If quoted: find the closing quote and only strip comments after that
   - If not quoted: strip everything from the first ` #` or `\t#` onward
   - Then apply the existing quote-stripping logic

3. The updated implementation should be:
```swift
import Foundation

/// Loads environment variables from ~/.escribano/.env into the process environment.
/// Called early in app startup before any components read ProcessInfo.processInfo.environment.
/// Existing environment variables are NOT overwritten (shell env takes precedence).
///
/// Inline comments are supported (must be preceded by whitespace):
///   KEY=value                    # This is a comment
///   KEY=value # comment          # This is also a comment
///   KEY=value#not-a-comment      # # is part of the value (no whitespace before it)
///   KEY="value # not comment"    # Inside quotes, # is literal
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
        
        // Skip empty lines and line comments (starts with #)
        guard !trimmed.isEmpty, !trimmed.hasPrefix("#") else { continue }
        
        // Parse KEY=VALUE format
        guard let equalsIndex = trimmed.firstIndex(of: "=") else { continue }
        
        let key = String(trimmed[..<equalsIndex])
            .trimmingCharacters(in: .whitespaces)
        
        // Extract raw value (everything after =)
        var value = String(trimmed[trimmed.index(after: equalsIndex)...])
            .trimmingCharacters(in: .whitespaces)
        
        // Strip inline comments (preceded by whitespace), respecting quotes
        value = stripInlineComments(from: value)
        
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

/// Strips inline comments from a value string.
/// Comments must be preceded by whitespace (space or tab) to be recognized.
/// Inside quoted values, # is treated as literal until the closing quote.
private func stripInlineComments(from value: String) -> String {
    var result = value
    
    // Check if value is quoted
    let isDoubleQuoted = result.hasPrefix("\"")
    let isSingleQuoted = result.hasPrefix("'")
    
    if isDoubleQuoted || isSingleQuoted {
        // Find the closing quote (not escaped)
        let quoteChar = isDoubleQuoted ? "\"" : "'"
        var index = result.index(after: result.startIndex)
        var foundClosingQuote = false
        
        while index < result.endIndex {
            let char = result[index]
            if String(char) == quoteChar {
                // Check if it's escaped (preceded by backslash)
                let prevIndex = result.index(before: index)
                if result[prevIndex] != "\\" {
                    foundClosingQuote = true
                    // Move past the closing quote
                    index = result.index(after: index)
                    break
                }
            }
            index = result.index(after: index)
        }
        
        // If we found a closing quote, strip comments only after it
        if foundClosingQuote && index < result.endIndex {
            let afterQuote = String(result[index...])
            if let commentStart = findCommentStart(in: afterQuote) {
                // Keep everything up to the comment start
                let endIndex = result.index(result.startIndex, offsetBy: result.distance(from: result.startIndex, to: index) + commentStart)
                result = String(result[..<endIndex])
            }
        }
        // If no closing quote found, treat entire value as literal (don't strip)
    } else {
        // Unquoted value: strip inline comments
        if let commentStart = findCommentStart(in: result) {
            result = String(result[..<result.index(result.startIndex, offsetBy: commentStart)])
                .trimmingCharacters(in: .whitespaces)
        }
    }
    
    return result
}

/// Finds the start index of an inline comment (preceded by whitespace).
/// Returns the index of the whitespace before the #, or nil if no comment found.
private func findCommentStart(in string: String) -> Int? {
    var index = 0
    let chars = Array(string)
    
    while index < chars.count {
        if chars[index] == "#" && index > 0 {
            // Check if preceded by whitespace
            let prevChar = chars[index - 1]
            if prevChar == " " || prevChar == "\t" {
                return index - 1 // Return index of the whitespace
            }
        }
        index += 1
    }
    
    return nil
}
```

4. The key changes:
   - Added `stripInlineComments(from:)` function that handles both quoted and unquoted values
   - Added `findCommentStart(in:)` helper that finds ` #` or `\t#` patterns
   - For quoted values: only strips comments after the closing quote
   - For unquoted values: strips from the first whitespace-before-# onward
   - Preserves backward compatibility with existing .env files

**Verification**: 
```bash
cd apps/recorder && swift build 2>&1 | grep -c "error:" | grep -q "^0$"
```

**Test Cases** (manual verification):
```bash
# Test 1: Inline comment with space
ESCRIBANO_VLM_BATCH_SIZE=1         # 1-4 frames
# Expected: value = "1"

# Test 2: No space before # (part of value)
ESCRIBANO_TEST=value#hash
# Expected: value = "value#hash"

# Test 3: Quoted value with # inside
ESCRIBANO_TEST2="value # not a comment"
# Expected: value = "value # not a comment" (after quote stripping)

# Test 4: Tab before #
ESCRIBANO_TEST3=value\t# comment
# Expected: value = "value"
```

**Rollback**: `git checkout -- apps/recorder/Sources/ConfigLoader.swift`

---

## Execution Plan

### Phase 1 — Single Work Unit
- WU-1: Strip Inline Comments from .env Values

## Recovery Strategy

- **Automatic**: Implementor rolls back and retries once on failure.
- **Global rollback**: `git checkout -- apps/recorder/Sources/ConfigLoader.swift`
- **Verification**: After implementation, run `swift build` to verify clean compilation.

## Success Criteria

1. `ESCRIBANO_VLM_BATCH_SIZE=1         # comment` parses as value `1`
2. `KEY=value#hash` parses as value `value#hash` (no space before #)
3. `KEY="value # hash"` parses as value `value # hash` (# inside quotes is literal)
4. No regression: existing .env files without comments continue to work
5. Swift build completes with zero errors
