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
    private let basePollInterval: Double = 10.0
    private var currentPollInterval: Double = 10.0
    private let maxPollInterval: Double = 120.0
    private var bridgeFailureCount: Int = 0
    private let maxBridgeFailures: Int = 5
    init(frameStore: any FrameStore, obsStore: any ObservationStore, vlmService: any VLMInferenceService, queue: WorkQueue) {
        self.frameStore  = frameStore
        self.obsStore    = obsStore
        self.vlmService  = vlmService
        self.queue       = queue
        self.batchSize   = Int(ProcessInfo.processInfo.environment["ESCRIBANO_ANALYZE_BATCH_SIZE"] ?? "") ?? 5
    }
    /// Reset the polling backoff to base interval. Called when the system wakes
    /// from sleep or when the bridge recovers, since new frames are likely incoming.
    func resetBackoff() {
        currentPollInterval = basePollInterval
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
        log("[FrameAnalyzer] Starting analysis loop. Base poll: \(basePollInterval)s, batch: \(batchSize)")
        while !Task.isCancelled {
            do {
                let frames = try frameStore.claimFrames(batchSize: batchSize)
                if frames.isEmpty {
                    // Exponential backoff when idle
                    try await Task.sleep(for: .seconds(currentPollInterval))
                    currentPollInterval = min(currentPollInterval * 2, maxPollInterval)
                    continue
                }
                // Work available — reset backoff
                currentPollInterval = basePollInterval
                
                log("[FrameAnalyzer] Analyzing \(frames.count) frames...")
                let t0 = Date()
                let descriptions: [FrameDescription]
                do {
                    descriptions = try await queue.submit(priority: .realtime) { [vlmService] in
                        try await vlmService.runBatch(frames: frames)
                    }
                } catch PythonBridgeError.bridgeDied {
                    // Bridge crashed — release frames back to pool (don't waste retry budget)
                    try? frameStore.releaseFrames(ids: frames.map { $0.id })
                    log("[FrameAnalyzer] Bridge died — released \(frames.count) frames, attempting restart...")
                    
                    bridgeFailureCount += 1
                    if bridgeFailureCount > maxBridgeFailures {
                        log("[FrameAnalyzer] FATAL: Bridge failed \(bridgeFailureCount) times — stopping analysis loop")
                        log("[FrameAnalyzer] Frames will accumulate; backpressure will eventually pause capture")
                        break
                    }
                    
                    do {
                        try await vlmService.restart()
                        bridgeFailureCount = 0
                        log("[FrameAnalyzer] Bridge restarted successfully — resuming analysis")
                    } catch {
                        log("[FrameAnalyzer] Bridge restart failed: \(error.localizedDescription)")
                        // Sleep before next attempt — let the system recover
                        try? await Task.sleep(for: .seconds(min(Double(bridgeFailureCount) * 10.0, 60.0)))
                    }
                    continue
                } catch {
                    log("[FrameAnalyzer] VLM inference error: \(error.localizedDescription)")
                    for frame in frames {
                        do {
                            try frameStore.markFrameFailed(id: frame.id)
                        } catch {
                            print("[FrameAnalyzer] Failed to mark frame \(frame.id) as failed: \(error.localizedDescription)")
                        }
                    }
                    continue
                }
                let elapsed = String(format: "%.1f", Date().timeIntervalSince(t0))
                log("[FrameAnalyzer] Batch complete: \(descriptions.count)/\(frames.count) parsed in \(elapsed)s")
                // Only save when all frames were parsed — a partial result means the
                // parser may have silently dropped lines and we can't reliably pair
                // descriptions to frames by position. Retry the whole batch instead.
                guard descriptions.count == frames.count else {
                    log("[FrameAnalyzer] Partial parse (\(descriptions.count)/\(frames.count)) — marking all for retry")
                    for frame in frames {
                        do {
                            try frameStore.markFrameFailed(id: frame.id)
                        } catch {
                            print("[FrameAnalyzer] Failed to mark frame \(frame.id) as failed: \(error.localizedDescription)")
                        }
                    }
                    continue
                }
                do {
                    try await obsStore.saveObservations(from: frames, descriptions: descriptions)
                } catch {
                    log("[FrameAnalyzer] DB write error: \(error.localizedDescription)")
                    continue
                }
                do {
                    try frameStore.markFramesAnalyzed(ids: frames.map { $0.id })
                } catch {
                    log("[FrameAnalyzer] Failed to mark frames analyzed: \(error.localizedDescription)")
                }
                // Successful batch — reset bridge failure counter
                bridgeFailureCount = 0
            } catch is CancellationError {
                break
            } catch {
                log("[FrameAnalyzer] Unexpected error: \(error.localizedDescription)")
                try? await Task.sleep(for: .seconds(currentPollInterval))
            }
        }
        log("[FrameAnalyzer] Loop exited.")
        await vlmService.stop()
    }
}
