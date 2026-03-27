import Foundation

// Debug flag for SessionAggregator verbose logging (includes LLM responses)
private let debugSA = ProcessInfo.processInfo.environment["ESCRIBANO_DEBUG_SA"] == "1"

// MARK: - SessionAggregatorError

enum SessionAggregatorError: Error, LocalizedError {
    case textGenerationFailed(String)
    case noGroupsParsed

    var errorDescription: String? {
        switch self {
        case .textGenerationFailed(let m): return "Text generation failed: \(m)"
        case .noGroupsParsed:              return "No groups parsed from LLM response"
        }
    }
}

// MARK: - SessionAggregator

/// Actor that periodically groups unclaimed observations into TopicBlocks.
///
/// Follows the same pattern as FrameAnalyzer:
///   - Injected dependencies via init (port interfaces)
///   - Long-running loop with Task.isCancelled checks
///   - CancellationError breaks the loop
///
/// The LLM grouping uses the VLM bridge's text_infer method (same model,
/// same socket, zero extra RAM). This was validated in the VLM-as-LLM POC.
actor SessionAggregator {

    private let obsStore: any ObservationStore
    private let tbStore: any TopicBlockStore
    private let textService: any TextGenerationService
    private let queue: WorkQueue

    // Configuration
    private let minObservations: Int
    private let pollInterval: Double   // seconds
    private let maxObsPerCycle: Int
    private let llmBatchSize: Int

    // Sentinel recording ID for recorder-generated TopicBlocks
    private let recorderRecordingId = "__recorder__"

    init(
        obsStore: any ObservationStore,
        tbStore: any TopicBlockStore,
        textService: any TextGenerationService,
        queue: WorkQueue
    ) {
        self.obsStore = obsStore
        self.tbStore = tbStore
        self.textService = textService
        self.queue = queue

        let rawMinObs = Int(ProcessInfo.processInfo.environment["ESCRIBANO_TB_MIN_OBSERVATIONS"] ?? "") ?? 3
        self.minObservations = max(1, rawMinObs)
        if self.minObservations != rawMinObs {
            log("[SessionAggregator] WARN: ESCRIBANO_TB_MIN_OBSERVATIONS clamped from \(rawMinObs) to \(self.minObservations)")
        }

        let rawPollInterval = Double(ProcessInfo.processInfo.environment["ESCRIBANO_TB_POLL_INTERVAL"] ?? "") ?? 120.0
        self.pollInterval = max(1.0, rawPollInterval)
        if self.pollInterval != rawPollInterval {
            log("[SessionAggregator] WARN: ESCRIBANO_TB_POLL_INTERVAL clamped from \(rawPollInterval) to \(self.pollInterval)")
        }

        let rawMaxObs = Int(ProcessInfo.processInfo.environment["ESCRIBANO_TB_MAX_OBS_PER_CYCLE"] ?? "") ?? 300
        self.maxObsPerCycle = max(1, rawMaxObs)
        if self.maxObsPerCycle != rawMaxObs {
            log("[SessionAggregator] WARN: ESCRIBANO_TB_MAX_OBS_PER_CYCLE clamped from \(rawMaxObs) to \(self.maxObsPerCycle)")
        }

        let rawLlmBatch = Int(ProcessInfo.processInfo.environment["ESCRIBANO_TB_LLM_BATCH_SIZE"] ?? "") ?? 50
        self.llmBatchSize = max(1, rawLlmBatch)
        if self.llmBatchSize != rawLlmBatch {
            log("[SessionAggregator] WARN: ESCRIBANO_TB_LLM_BATCH_SIZE clamped from \(rawLlmBatch) to \(self.llmBatchSize)")
        }
    }

    /// Main aggregation loop. Runs until Task is cancelled.
    func aggregateLoop() async {
        log("[SessionAggregator] Starting. MinObs=\(minObservations) IdlePoll=\(Int(pollInterval))s MaxObs=\(maxObsPerCycle) LLMBatch=\(llmBatchSize)")
        
        // Wait for the Python bridge to become ready before processing any observations.
        // The bridge is started by FrameAnalyzer and takes 30-120s to load the VLM model.
        // Without this gate, text_infer calls fail with .notStarted and the fallback path
        // creates poorly-grouped TopicBlocks that permanently claim observations.
        var readyAttempts = 0
        while !Task.isCancelled {
            readyAttempts += 1
            do {
                _ = try await queue.submit(priority: .normal) { [textService] in
                    try await textService.generateText(prompt: "ping", maxTokens: 1)
                }
                break // Success — bridge is ready
            } catch {
                if case PythonBridgeError.notStarted = error {
                    if readyAttempts % 6 == 0 {
                        log("[SessionAggregator] Waiting for text service... (\(readyAttempts * 5)s elapsed)")
                    }
                    try? await Task.sleep(for: .seconds(5))
                } else {
                    // Bridge IS running but returned some other error — treat as ready
                    break
                }
            }
        }

        guard !Task.isCancelled else {
            log("[SessionAggregator] Cancelled while waiting for text service.")
            return
        }

        log("[SessionAggregator] Text service ready, beginning aggregation")

        while !Task.isCancelled {
            do {
                let observations = try await obsStore.fetchUnclaimed(limit: maxObsPerCycle)

                if observations.isEmpty {
                    try await Task.sleep(for: .seconds(pollInterval))
                    continue
                }

                if observations.count < minObservations {
                    log("[SessionAggregator] Found \(observations.count) unclaimed (< \(minObservations) min) — waiting")
                    try await Task.sleep(for: .seconds(pollInterval))
                    continue
                }

                log("[SessionAggregator] Found \(observations.count) unclaimed observations — processing")
                do {
                    let created = try await processWindow(observations)
                    if created > 0 {
                        log("[SessionAggregator] Cycle complete: created \(created) TopicBlock(s)")
                    } else {
                        log("[SessionAggregator] No TBs created — waiting for more observations")
                        try await Task.sleep(for: .seconds(pollInterval))
                    }
                } catch {
                    log("[SessionAggregator] Error processing observations: \(error.localizedDescription)")
                    try await Task.sleep(for: .seconds(pollInterval))
                }

            } catch is CancellationError {
                break
            } catch {
                log("[SessionAggregator] Unexpected error: \(error.localizedDescription)")
                try? await Task.sleep(for: .seconds(pollInterval))
            }
        }

        log("[SessionAggregator] Loop exited.")
    }

    // MARK: - Window Processing

    /// Process a single time window: group observations via LLM, create TopicBlocks.
    /// Large windows are split into sub-batches of llmBatchSize to keep prompts small.
    /// Returns the number of TopicBlocks created.
    private func processWindow(_ window: [UnclaimedObservation]) async throws -> Int {
        // Split the window into sub-batches to keep each text_infer prompt small.
        let subBatches = stride(from: 0, to: window.count, by: llmBatchSize).map { start in
            Array(window[start..<min(start + llmBatchSize, window.count)])
        }

        var allGroups: [ParsedGroup] = []

        for (subBatchIdx, subBatch) in subBatches.enumerated() {
            log("[SessionAggregator] Sub-batch \(subBatchIdx + 1)/\(subBatches.count): \(subBatch.count) obs, submitting text_infer...")
            let prompt = buildGroupingPrompt(subBatch)
            let response: String
            do {
                response = try await queue.submit(priority: .normal) { [textService] in
                    try await textService.generateText(prompt: prompt, maxTokens: 4000)
                }
            } catch {
                // Any LLM/bridge error: abort this cycle and retry later.
                // Creating fallback TBs would permanently consume observations with garbage grouping.
                log("[SessionAggregator] text_infer failed for sub-batch: \(error.localizedDescription) — aborting cycle to retry later")
                throw error
            }
            if debugSA {
                log("[SessionAggregator] text_infer complete: \(response.count) chars. Preview: \(response.prefix(120).replacingOccurrences(of: "\n", with: " "))")
            } else {
                log("[SessionAggregator] text_infer complete: \(response.count) chars")
            }
            let parsed = parseGroupingResponse(response, observations: subBatch)
            if parsed.isEmpty {
                if debugSA {
                    log("[SessionAggregator] WARN: 0 groups parsed from text_infer response. Raw (first 500 chars): \(response.prefix(500).replacingOccurrences(of: "\n", with: "\\n"))")
                } else {
                    log("[SessionAggregator] WARN: 0 groups parsed from text_infer response (set ESCRIBANO_DEBUG_SA=1 to see raw response)")
                }
            } else {
                log("[SessionAggregator] Parsed \(parsed.count) group(s) from sub-batch \(subBatchIdx + 1)")
            }
            allGroups.append(contentsOf: parsed)
        }

        log("[SessionAggregator] Sub-batch loop done: \(allGroups.count) group(s) from \(subBatches.count) batch(es)")

        if allGroups.isEmpty {
            // All sub-batches failed parsing — treat whole window as one TB
            log("[SessionAggregator] No groups parsed across all sub-batches — creating single TB")
            let tb = createTopicBlock(from: window, label: dominantActivity(window))
            try await tbStore.save(tb)
            let claimed = try await obsStore.claimObservations(
                ids: window.map { $0.id }, tbId: tb.id
            )
            log("[SessionAggregator] Fallback TB \(tb.id): \(claimed)/\(window.count) obs claimed")
            return 1
        }

        var created = 0
        for group in allGroups {
            let groupObs = group.observationIds.compactMap { targetId in
                window.first { $0.id == targetId }
            }
            log("[SessionAggregator] Group '\(group.label)': \(group.observationIds.count) IDs → \(groupObs.count) matched in window")
            guard !groupObs.isEmpty else { continue }
            
            // Create and save TopicBlock FIRST (satisfies FK constraint), then claim observations
            let tb = createTopicBlock(from: groupObs, label: group.label)
            do {
                try await tbStore.save(tb)
                log("[SessionAggregator] Saved TB \(tb.id) for group '\(group.label)'")
            } catch {
                log("[SessionAggregator] FAILED to save TB \(tb.id): \(error.localizedDescription)")
                continue
            }
            
            // Now claim observations (FK constraint satisfied since TB exists)
            let claimed = try await obsStore.claimObservations(
                ids: groupObs.map { $0.id }, tbId: tb.id
            )
            
            if claimed > 0 {
                created += 1
                log("[SessionAggregator] TB \(tb.id) (\(group.label)): \(claimed)/\(groupObs.count) obs claimed")
            } else {
                log("[SessionAggregator] Group '\(group.label)': 0 observations claimed (may have been claimed by another process)")
            }
        }

        // Claim any observations the LLM did not assign to any group (previously lost).
        let claimedIds = Set(allGroups.flatMap { $0.observationIds })
        let unclaimed = window.filter { !claimedIds.contains($0.id) }
        if !unclaimed.isEmpty {
            log("[SessionAggregator] \(unclaimed.count) obs not assigned to any group — creating catch-all TB")
            let tb = createTopicBlock(from: unclaimed, label: dominantActivity(unclaimed))
            try await tbStore.save(tb)
            let claimed = try await obsStore.claimObservations(
                ids: unclaimed.map { $0.id }, tbId: tb.id
            )
            log("[SessionAggregator] Catch-all TB \(tb.id): \(claimed)/\(unclaimed.count) obs claimed")
            created += 1
        }

        return created
    }

    // MARK: - TopicBlock Construction

    private func createTopicBlock(from observations: [UnclaimedObservation], label: String) -> TopicBlockInsert {
        let id = "tb-\(UUID().uuidString)"
        let fromTs = observations.map { $0.capturedAt }.min() ?? 0
        let toTs = observations.map { $0.capturedAt }.max() ?? 0
        let duration = toTs - fromTs

        // Aggregate apps and topics
        var appsSet = Set<String>()
        var topicsSet = Set<String>()
        var activityCounts: [String: Int] = [:]

        for obs in observations {
            for app in obs.apps { appsSet.insert(app) }
            for topic in obs.topics { topicsSet.insert(topic) }
            activityCounts[obs.activityType, default: 0] += 1
        }

        let dominantActivity = activityCounts.max(by: { $0.value < $1.value })?.key ?? "other"

        // Build key_description from VLM descriptions (first 5 + last if many)
        let descSample: [String]
        if observations.count <= 6 {
            descSample = observations.map { $0.vlmDescription }
        } else {
            descSample = Array(observations.prefix(5).map { $0.vlmDescription })
                + [observations.last!.vlmDescription]
        }
        let keyDescription = descSample.joined(separator: "; ")

        let classification: [String: Any] = [
            "activity_type": dominantActivity,
            "key_description": keyDescription,
            "start_time": fromTs,
            "end_time": toTs,
            "duration": duration,
            "apps": Array(appsSet),
            "topics": Array(topicsSet),
            "transcript_count": 0,
            "has_transcript": false,
            "combined_transcript": "",
            "label": label,
        ]

        let classificationJson: String
        if let data = try? JSONSerialization.data(withJSONObject: classification),
           let str = String(data: data, encoding: .utf8) {
            classificationJson = str
        } else {
            classificationJson = "{}"
        }

        return TopicBlockInsert(
            id: id,
            recordingId: recorderRecordingId,
            contextIds: "[]",
            classification: classificationJson,
            duration: duration,
            fromTs: fromTs,
            toTs: toTs,
            observationCount: observations.count
        )
    }

    // MARK: - LLM Grouping Prompt

    private func buildGroupingPrompt(_ observations: [UnclaimedObservation]) -> String {
        let fromTs = observations.first?.capturedAt ?? 0
        let toTs = observations.last?.capturedAt ?? 0

        // Build observation descriptions for the prompt
        var blockDescriptions = ""
        for (i, obs) in observations.enumerated() {
            let timeStr = formatTime(obs.capturedAt)
            blockDescriptions += """
            OBS \(i + 1):
            Time: \(timeStr)
            Activity: \(obs.activityType)
            Description: \(obs.vlmDescription)
            Apps: \(obs.apps.joined(separator: ", "))
            Topics: \(obs.topics.joined(separator: ", "))
            ID: \(obs.id)

            """
        }

        let exampleIds: String
        if observations.count >= 2 {
            exampleIds = "\"\(observations[0].id)\", \"\(observations[1].id)\""
        } else {
            exampleIds = "\"\(observations[0].id)\""
        }

        return """
        /no_think
        You are analyzing \(observations.count) screen observations from a continuous work recording spanning \(formatTime(fromTs)) to \(formatTime(toTs)).

        Your task is to group these observations into 1-6 coherent work segments. Each segment represents a distinct thread of work.

        GROUPING RULES:
        1. Group observations that belong to the same work thread, even if not consecutive
        2. Personal activities (WhatsApp, Instagram, social media) should be grouped into a "Personal" segment
        3. Deep work on the same project/codebase should be grouped together
        4. If all observations are about the same project, one group is correct — do not invent artificial splits

        OBSERVATIONS TO GROUP:
        \(blockDescriptions)

        For each group, output ONE line in this EXACT format:
        Group 1: label: [Descriptive segment name] | obsIds: [\(exampleIds)]

        CRITICAL REQUIREMENTS:
        - Each group MUST have "label" and "obsIds"
        - Observation IDs are the IDs shown above (copy them exactly)
        - Include ALL \(observations.count) observation IDs across all groups
        - Create 1-6 groups
        - Output ONLY the group lines — no explanation, no preamble
        """
    }

    // MARK: - Response Parsing

    private struct ParsedGroup {
        let label: String
        let observationIds: [String]
    }

    private func parseGroupingResponse(_ response: String, observations: [UnclaimedObservation]) -> [ParsedGroup] {
        let validIds = Set(observations.map { $0.id })
        var groups: [ParsedGroup] = []

        // Strip thinking tags (Qwen3 may add <think>...</think>)
        var cleaned = response
        while let start = cleaned.range(of: "<think>"),
              let end = cleaned.range(of: "</think>"),
              start.lowerBound <= end.lowerBound {
            cleaned.removeSubrange(start.lowerBound..<end.upperBound)
        }
        // Handle orphan </think>
        if let orphan = cleaned.range(of: "</think>") {
            cleaned = String(cleaned[orphan.upperBound...])
        }

        let lines = cleaned.split(separator: "\n", omittingEmptySubsequences: true)

        // Match: Group N: label: ... | obsIds: [id1, id2, ...]
        for line in lines {
            let lineStr = String(line).trimmingCharacters(in: .whitespaces)
            guard lineStr.lowercased().hasPrefix("group ") else { continue }

            // Extract label
            guard let labelStart = lineStr.range(of: "label: "),
                  let separator = lineStr.range(of: " | obsIds:") else { continue }
            let label = String(lineStr[labelStart.upperBound..<separator.lowerBound])
                .trimmingCharacters(in: .whitespaces)

            // Extract obsIds
            guard let idsStart = lineStr.range(of: "obsIds: ["),
                  let idsEnd = lineStr.range(of: "]", range: idsStart.upperBound..<lineStr.endIndex) else { continue }
            let idsStr = String(lineStr[idsStart.upperBound..<idsEnd.lowerBound])

            let ids = idsStr.split(separator: ",")
                .map { String($0).trimmingCharacters(in: CharacterSet(charactersIn: " \"'")) }
                .filter { validIds.contains($0) }

            if !ids.isEmpty && !label.isEmpty {
                groups.append(ParsedGroup(label: label, observationIds: ids))
            }
        }

        return groups
    }

    // MARK: - Helpers

    private func dominantActivity(_ observations: [UnclaimedObservation]) -> String {
        var counts: [String: Int] = [:]
        for obs in observations {
            counts[obs.activityType, default: 0] += 1
        }
        return counts.max(by: { $0.value < $1.value })?.key ?? "Work Session"
    }

    private static let timeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        return f
    }()

    private func formatTime(_ unixTimestamp: Double) -> String {
        let date = Date(timeIntervalSince1970: unixTimestamp)
        return Self.timeFormatter.string(from: date)
    }
}
