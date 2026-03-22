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
    private let frameStore: any FrameStore
    private let obsStore:   any ObservationStore
    private let vlmService: any VLMInferenceService
    private let queue:      WorkQueue
    private let batchSize:    Int
    private let pollInterval: Double
    init(frameStore: any FrameStore, obsStore: any ObservationStore, vlmService: any VLMInferenceService, queue: WorkQueue) {
        self.frameStore  = frameStore
        self.obsStore    = obsStore
        self.vlmService  = vlmService
        self.queue       = queue
        self.batchSize   = Int(ProcessInfo.processInfo.environment["ESCRIBANO_ANALYZE_BATCH_SIZE"] ?? "") ?? 5
        self.pollInterval = 10.0
    }
    /// Start the VLM backend. Blocks until the Python process is ready and the model is loaded.
    func start() async throws {
        print("[FrameAnalyzer] Starting VLM service...")
        do {
            try await vlmService.start()
        } catch {
            throw FrameAnalyzerError.startFailed(error.localizedDescription)
        }
        print("[FrameAnalyzer] VLM service ready. Batch size: \(batchSize)")
    }
    /// Main analysis loop. Polls for unanalyzed frames, runs VLM, writes results.
    /// Runs until Task is cancelled (SIGTERM triggers cancellation in main.swift).
    func analyzeLoop() async {
        print("[FrameAnalyzer] Starting analysis loop. Poll interval: \(pollInterval)s")
        while !Task.isCancelled {
            do {
                let frames = try frameStore.claimFrames(batchSize: batchSize)
                if frames.isEmpty {
                    try await Task.sleep(for: .seconds(pollInterval))
                    continue
                }
                print("[FrameAnalyzer] Analyzing \(frames.count) frames...")
                let t0 = Date()
                let descriptions: [FrameDescription]
                do {
                    descriptions = try await queue.submit(priority: .realtime) { [vlmService] in
                        try await vlmService.runBatch(frames: frames)
                    }
                } catch {
                    print("[FrameAnalyzer] VLM inference error: \(error.localizedDescription)")
                    for frame in frames {
                        try? frameStore.markFrameFailed(id: frame.id)
                    }
                    continue
                }
                let elapsed = String(format: "%.1f", Date().timeIntervalSince(t0))
                print("[FrameAnalyzer] Batch complete: \(descriptions.count)/\(frames.count) parsed in \(elapsed)s")
                // Only save when all frames were parsed — a partial result means the
                // parser may have silently dropped lines and we can't reliably pair
                // descriptions to frames by position. Retry the whole batch instead.
                guard descriptions.count == frames.count else {
                    print("[FrameAnalyzer] Partial parse (\(descriptions.count)/\(frames.count)) — marking all for retry")
                    for frame in frames {
                        try? frameStore.markFrameFailed(id: frame.id)
                    }
                    continue
                }
                do {
                    try await obsStore.saveObservations(from: frames, descriptions: descriptions)
                } catch {
                    print("[FrameAnalyzer] DB write error: \(error.localizedDescription)")
                    continue
                }
                do {
                    try frameStore.markFramesAnalyzed(ids: frames.map { $0.id })
                } catch {
                    print("[FrameAnalyzer] Failed to mark frames analyzed: \(error.localizedDescription)")
                }
            } catch is CancellationError {
                break
            } catch {
                print("[FrameAnalyzer] Unexpected error: \(error.localizedDescription)")
                try? await Task.sleep(for: .seconds(pollInterval))
            }
        }
        print("[FrameAnalyzer] Loop exited.")
        await vlmService.stop()
    }
}
