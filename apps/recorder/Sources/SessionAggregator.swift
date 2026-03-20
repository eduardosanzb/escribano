import Foundation

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

    // Configuration
    private let gapThreshold: Double   // seconds
    private let minObservations: Int
    private let pollInterval: Double   // seconds
    private let maxObsPerCycle: Int
    private let llmBatchSize: Int

    // Sentinel recording ID for recorder-generated TopicBlocks
    private let recorderRecordingId = "__recorder__"

    init(
        obsStore: any ObservationStore,
        tbStore: any TopicBlockStore,
        textService: any TextGenerationService
    ) {
        self.obsStore = obsStore
        self.tbStore = tbStore
        self.textService = textService

        self.gapThreshold = Double(
            ProcessInfo.processInfo.environment["ESCRIBANO_SESSION_GAP_THRESHOLD"] ?? ""
        ) ?? 1200.0  // 20 min default

        self.minObservations = Int(
            ProcessInfo.processInfo.environment["ESCRIBANO_TB_MIN_OBSERVATIONS"] ?? ""
        ) ?? 5

        self.pollInterval = Double(
            ProcessInfo.processInfo.environment["ESCRIBANO_TB_POLL_INTERVAL"] ?? ""
        ) ?? 120.0  // 2 min default

        self.maxObsPerCycle = Int(
            ProcessInfo.processInfo.environment["ESCRIBANO_TB_MAX_OBS_PER_CYCLE"] ?? ""
        ) ?? 300

        self.llmBatchSize = Int(
            ProcessInfo.processInfo.environment["ESCRIBANO_TB_LLM_BATCH_SIZE"] ?? ""
        ) ?? 50
    }

    /// Main aggregation loop. Runs until Task is cancelled.
    func aggregateLoop() async {
        log("[SessionAggregator] Starting. Gap=\(Int(gapThreshold))s MinObs=\(minObservations) Poll=\(Int(pollInterval))s MaxObs=\(maxObsPerCycle) LLMBatch=\(llmBatchSize)")

        while !Task.isCancelled {
            do {
                let observations = try await obsStore.fetchUnclaimed(limit: maxObsPerCycle)

                if observations.isEmpty {
                    try await Task.sleep(for: .seconds(pollInterval))
                    continue
                }

                log("[SessionAggregator] Found \(observations.count) unclaimed observations")

                let windows = splitByGap(observations)
                var totalTBs = 0

                for window in windows {
                    guard window.count >= minObservations else {
                        log("[SessionAggregator] Skipping window with \(window.count) obs (< \(minObservations) min)")
                        continue
                    }

                    do {
                        let created = try await processWindow(window)
                        totalTBs += created
                    } catch {
                        log("[SessionAggregator] Error processing window: \(error.localizedDescription)")
                        // Continue with next window — don't fail the whole cycle
                    }
                }

                if totalTBs > 0 {
                    log("[SessionAggregator] Cycle complete: created \(totalTBs) TopicBlock(s)")
                }

                try await Task.sleep(for: .seconds(pollInterval))

            } catch is CancellationError {
                break
            } catch {
                log("[SessionAggregator] Unexpected error: \(error.localizedDescription)")
                try? await Task.sleep(for: .seconds(pollInterval))
            }
        }

        log("[SessionAggregator] Loop exited.")
    }

    // MARK: - Gap-Aware Windowing

    /// Split observations into windows separated by gaps > threshold.
    /// Observations are already sorted by capturedAt ASC from fetchUnclaimed.
    private func splitByGap(_ observations: [UnclaimedObservation]) -> [[UnclaimedObservation]] {
        guard !observations.isEmpty else { return [] }

        var windows: [[UnclaimedObservation]] = []
        var currentWindow: [UnclaimedObservation] = [observations[0]]

        for i in 1..<observations.count {
            let gap = observations[i].capturedAt - observations[i - 1].capturedAt
            if gap > gapThreshold {
                windows.append(currentWindow)
                currentWindow = [observations[i]]
            } else {
                currentWindow.append(observations[i])
            }
        }
        windows.append(currentWindow)

        return windows
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

        for subBatch in subBatches {
            let prompt = buildGroupingPrompt(subBatch)
            let response: String
            do {
                response = try await textService.generateText(prompt: prompt, maxTokens: 2000)
            } catch {
                log("[SessionAggregator] text_infer failed for sub-batch: \(error.localizedDescription)")
                // Fallback: treat sub-batch as a single TB with dominant activity label
                let tb = createTopicBlock(from: subBatch, label: dominantActivity(subBatch))
                try await tbStore.save(tb)
                let claimed = try await obsStore.claimObservations(
                    ids: subBatch.map { $0.id }, tbId: tb.id
                )
                log("[SessionAggregator] Fallback TB \(tb.id): \(claimed)/\(subBatch.count) obs claimed")
                continue
            }
            let parsed = parseGroupingResponse(response, observations: subBatch)
            allGroups.append(contentsOf: parsed)
        }

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
            guard !groupObs.isEmpty else { continue }
            let tb = createTopicBlock(from: groupObs, label: group.label)
            try await tbStore.save(tb)
            let claimed = try await obsStore.claimObservations(
                ids: groupObs.map { $0.id }, tbId: tb.id
            )
            log("[SessionAggregator] TB \(tb.id) (\(group.label)): \(claimed)/\(groupObs.count) obs claimed")
            created += 1
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

    private func formatTime(_ unixTimestamp: Double) -> String {
        let date = Date(timeIntervalSince1970: unixTimestamp)
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: date)
    }
}
