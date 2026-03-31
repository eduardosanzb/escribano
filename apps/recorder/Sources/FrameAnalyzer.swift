import Foundation
// MARK: - FrameAnalyzerError
enum FrameAnalyzerError: Error, LocalizedError {
    case startFailed(String)
    var errorDescription: String? {
        switch self {
        case .startFailed(let m): return "Inference queue start failed: \(m)"
        }
    }
}
// MARK: - FrameAnalyzer
//
// Actor that drives the continuous VLM analysis loop.
//
// Bridge-unaware: submits work to InferenceQueue, which owns the worker
// lifecycle (health checks, restart, circuit breaker). If the queue's
// circuit breaker opens, submit() throws .bridgeDied and the loop exits.
actor FrameAnalyzer {
    private let frameStore: any FrameStore
    private let obsStore:   any ObservationStore
    private let queue:      InferenceQueue
    private let batchSize:    Int
    private let basePollInterval: Double = 10.0
    private var currentPollInterval: Double = 10.0
    private let maxPollInterval: Double = 120.0

    init(frameStore: any FrameStore, obsStore: any ObservationStore, queue: InferenceQueue) {
        self.frameStore  = frameStore
        self.obsStore    = obsStore
        self.queue       = queue
        self.batchSize   = Int(ProcessInfo.processInfo.environment["ESCRIBANO_ANALYZE_BATCH_SIZE"] ?? "") ?? 5
    }

    /// Reset the polling backoff to base interval. Called on system wake.
    func resetBackoff() {
        currentPollInterval = basePollInterval
    }

    /// Main analysis loop. Polls for unanalyzed frames, runs VLM, writes results.
    /// Runs until Task is cancelled or the inference queue's circuit breaker opens.
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
                    descriptions = try await queue.analyzeFrames(frames: frames)
                } catch PythonBridgeError.bridgeDied {
                    // Queue's circuit breaker is open — release frames and exit
                    try? frameStore.releaseFrames(ids: frames.map { $0.id })
                    log("[FrameAnalyzer] Inference queue circuit open — released \(frames.count) frames, stopping")
                    log("[FrameAnalyzer] Frames will accumulate; backpressure will eventually pause capture")
                    break
                } catch {
                    log("[FrameAnalyzer] VLM inference error: \(error.localizedDescription)")
                    for frame in frames {
                        do {
                            try frameStore.markFrameFailed(id: frame.id)
                        } catch {
                            log("[FrameAnalyzer] Failed to mark frame \(frame.id) as failed: \(error.localizedDescription)")
                        }
                    }
                    continue
                }
                let elapsed = String(format: "%.1f", Date().timeIntervalSince(t0))
                log("[FrameAnalyzer] Batch complete: \(descriptions.count)/\(frames.count) parsed in \(elapsed)s")
                guard descriptions.count == frames.count else {
                    log("[FrameAnalyzer] Partial parse (\(descriptions.count)/\(frames.count)) — marking all for retry")
                    for frame in frames {
                        do {
                            try frameStore.markFrameFailed(id: frame.id)
                        } catch {
                            log("[FrameAnalyzer] Failed to mark frame \(frame.id) as failed: \(error.localizedDescription)")
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
            } catch is CancellationError {
                break
            } catch {
                log("[FrameAnalyzer] Unexpected error: \(error.localizedDescription)")
                try? await Task.sleep(for: .seconds(currentPollInterval))
            }
        }
        log("[FrameAnalyzer] Loop exited.")
    }
}
