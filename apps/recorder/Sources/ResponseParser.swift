import Foundation
// MARK: - ResponseParser
//
// Stateless parser for VLM batch output.
// Intentionally decoupled from VLMRunner so it can be understood and tested independently.
//
// Expected input format (one line per frame):
//   Frame 1: description: Fixing TypeScript error | activity: debugging | apps: [VS Code] | topics: [TypeScript]
//   Frame 2: description: Reading docs in Chrome | activity: reading | apps: [Chrome] | topics: [Qwen3-VL]
//
// The VLM may also prepend <think>...</think> chain-of-thought blocks — these are stripped first.
enum ResponseParser {
    // MARK: - Public API
    /// Parse the full raw VLM response into an array of FrameDescription values.
    /// Lines not matching the "Frame N:" format are silently dropped (VLM hallucinations).
    static func parseInterleavedOutput(_ response: String) -> [FrameDescription] {
        let cleaned = stripThinkingTags(response)
        return cleaned
            .split(separator: "\n", omittingEmptySubsequences: true)
            .compactMap { line in
                let lineStr = String(line).trimmingCharacters(in: .whitespaces)
                guard lineStr.hasPrefix("Frame ") else { return nil }
                return parseSingleFrame(lineStr)
            }
    }
    // MARK: - Internal parsing
    /// Parse one "Frame N: description: X | activity: Y | apps: [...] | topics: [...]" line.
    /// Returns nil if the line doesn't match the expected format.
    static func parseSingleFrame(_ line: String) -> FrameDescription? {
        guard let descRange  = line.range(of: "description: ") else { return nil }
        let afterDesc        = String(line[descRange.upperBound...])
        guard let actSep     = afterDesc.range(of: " | activity") else { return nil }
        let description      = String(afterDesc[..<actSep.lowerBound]).trimmingCharacters(in: .whitespaces)
        guard let actRange   = afterDesc.range(of: "activity: ") else { return nil }
        let afterAct         = String(afterDesc[actRange.upperBound...])
        let activityRaw: String
        if let appsSep = afterAct.range(of: " | apps") {
            activityRaw = String(afterAct[..<appsSep.lowerBound])
        } else {
            activityRaw = afterAct
        }
        let activity = normalizeActivity(activityRaw.trimmingCharacters(in: .whitespaces))
        var apps: [String] = []
        if let appsRange = afterDesc.range(of: "apps: ") {
            let afterApps = String(afterDesc[appsRange.upperBound...])
            let appsStr: String
            if let topicsSep = afterApps.range(of: " | topics") {
                appsStr = String(afterApps[..<topicsSep.lowerBound])
            } else {
                appsStr = afterApps
            }
            apps = parseList(appsStr.trimmingCharacters(in: .whitespaces))
        }
        var topics: [String] = []
        if let topicsRange = afterDesc.range(of: "topics: ") {
            let topicsStr = String(afterDesc[topicsRange.upperBound...]).trimmingCharacters(in: .whitespaces)
            topics = parseList(topicsStr)
        }
        return FrameDescription(description: description, activity: activity, apps: apps, topics: topics, vlmStats: nil)
    }
    // MARK: - Helpers
    /// Map VLM-generated activity words to canonical values.
    /// The VLM might say "debug" or "coding" — we normalize to "debugging", "coding", etc.
    static func normalizeActivity(_ raw: String) -> String {
        let lowered = raw.lowercased().trimmingCharacters(in: .whitespaces)
        let canonical = ["debugging", "coding", "review", "meeting", "research", "reading", "terminal", "other"]
        if canonical.contains(lowered) { return lowered }
        let aliases: [(substring: String, canonical: String)] = [
            ("debugging",   "debugging"), ("debug",      "debugging"),
            ("coding",      "coding"),    ("code",       "coding"),
            ("implement",   "coding"),    ("programm",   "coding"),
            ("review",      "review"),
            ("meeting",     "meeting"),   ("zoom",       "meeting"), ("call", "meeting"),
            ("research",    "research"),  ("browsing",   "research"), ("searching", "research"),
            ("reading",     "reading"),
            ("terminal",    "terminal"),  ("cli",        "terminal"), ("bash", "terminal"),
        ]
        for (sub, canonical) in aliases {
            if lowered.contains(sub) { return canonical }
        }
        return "other"
    }
    /// Remove <think>...</think> blocks that Qwen3 models sometimes prepend.
    static func stripThinkingTags(_ text: String) -> String {
        var result = text
        while let start = result.range(of: "<think>"),
              let end   = result.range(of: "</think>"),
              start.lowerBound <= end.lowerBound {
            result.removeSubrange(start.lowerBound..<end.upperBound)
        }
        return result
    }
    /// Convert "[app1, app2]" or "app1, app2" into ["app1", "app2"].
    static func parseList(_ str: String) -> [String] {
        let trimmed = str.trimmingCharacters(in: CharacterSet(charactersIn: "[] "))
        guard !trimmed.isEmpty else { return [] }
        return trimmed
            .split(separator: ",")
            .map { String($0).trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }
}
