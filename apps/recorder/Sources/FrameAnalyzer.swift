import Foundation
// MARK: - FrameAnalyzerError
enum FrameAnalyzerError: Error, LocalizedError {
    case serviceNotStarted
    case startFailed(String)
    var errorDescription: String? {
        switch self {
        case .serviceNotStarted:         return "VLM service not started — call start() first"
        case .startFailed(let m):        return "VLM service start failed: \(m)"
        }
    }
}
// MARK: - FrameAnalyzer
//
// Actor that owns the VLM service and drives the continuous analysis loop.
//
// What changed from VLMAnalyzer:
//   - Removed mlx-swift-lm imports (MLXVLM, MLXLMCommon)
//   - Replaced ModelContainer with a VLMInferenceService reference
//   - loadModel() → service.start()
//   - VLMRunner.runBatch() → service.runBatch()
//
// Everything else (poll loop, error handling, DB writes) is identical.
actor FrameAnalyzer {
    private let obsStore:   any ObservationStore
    private let vlmService: any VLMInferenceService
    private let batchSize:    Int
    private let pollInterval: Double
    init(obsStore: any ObservationStore, vlmService: any VLMInferenceService) {
        self.obsStore    = obsStore
        self.vlmService  = vlmService
        self.batchSize   = Int(ProcessInfo.processInfo.environment["ESCRIBANO_ANALYZE_BATCH_SIZE"] ?? "") ?? 5
        self.pollInterval = 10.0
    }
    /// Start the VLM backend. Blocks until the Python process is ready and the model is loaded.
    func start() async throws {
        log("[FrameAnalyzer] Starting VLM service...")
        do {
            try await vlmService.start()
        } catch {
            throw FrameAnalyzerError.startFailed(error.localizedDescription)
        }
        log("[FrameAnalyzer] VLM service ready. Batch size: \(batchSize)")
    }
    /// Main analysis loop. Polls for unanalyzed frames, runs VLM, writes results.
    /// Runs until Task is cancelled (SIGTERM triggers cancellation in main.swift).
    func analyzeLoop() async {
        log("[FrameAnalyzer] Starting analysis loop. Poll interval: \(pollInterval)s")
        while !Task.isCancelled {
            do {
                let frames = try await obsStore.claimFrames(batchSize: batchSize)
                if frames.isEmpty {
                    try await Task.sleep(for: .seconds(pollInterval))
                    continue
                }
                log("[FrameAnalyzer] Analyzing \(frames.count) frames...")
                let t0 = Date()
                let descriptions: [FrameDescription]
                do {
                    descriptions = try await vlmService.runBatch(frames: frames)
                } catch {
                    log("[FrameAnalyzer] VLM inference error: \(error.localizedDescription)")
                    for frame in frames {
                        try? await obsStore.markFrameFailed(id: frame.id)
                    }
                    try? await Task.sleep(for: .seconds(pollInterval))
                    continue
                }
                let elapsed = String(format: "%.1f", Date().timeIntervalSince(t0))
                log("[FrameAnalyzer] Batch complete: \(descriptions.count)/\(frames.count) parsed in \(elapsed)s")
                do {
                    try await obsStore.saveObservations(from: frames, descriptions: descriptions)
                } catch {
                    print("[FrameAnalyzer] DB write error: \(error.localizedDescription)")
                    try? await Task.sleep(for: .seconds(pollInterval))
                    continue
                }
                let analyzedCount = min(frames.count, descriptions.count)
                let analyzedIds   = frames.prefix(analyzedCount).map { $0.id }
                do {
                    try await obsStore.markFramesAnalyzed(ids: analyzedIds)
                } catch {
                    log("[FrameAnalyzer] Failed to mark frames analyzed: \(error.localizedDescription)")
                }
                if descriptions.count < frames.count {
                    let failedFrames = Array(frames.dropFirst(analyzedCount))
                    log("[FrameAnalyzer] \(failedFrames.count) frames unparsed — marking for retry")
                    for frame in failedFrames {
                        try? await obsStore.markFrameFailed(id: frame.id)
                    }
                }
            } catch is CancellationError {
                break
            } catch {
                log("[FrameAnalyzer] Unexpected error: \(error.localizedDescription)")
                try? await Task.sleep(for: .seconds(pollInterval))
            }
        }
        log("[FrameAnalyzer] Loop exited.")
        await vlmService.stop()
    }
}
