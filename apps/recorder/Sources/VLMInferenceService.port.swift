import Foundation
// MARK: - InferenceWorker (Port)
//
// Unified port for VLM frame inference + text generation.
//
// Previously split across VLMInferenceService and TextGenerationService,
// merged because the same physical backend (Python bridge) handles both.
// The InferenceQueue owns worker lifecycle (start/stop/restart).
// Callers (FrameAnalyzer, SessionAggregator) never see this protocol —
// they only interact with InferenceQueue.
//
// Design: dumb process wrapper. isReady/start()/stop()/ping() for lifecycle,
// analyzeFrames()/generateText() for inference. No restart logic, no state machine.
protocol InferenceWorker: AnyObject, Sendable {
    /// Whether the worker is ready to accept inference requests.
    var isReady: Bool { get async }
    /// Start the inference backend (spawn process, connect socket, load model).
    /// Called by InferenceQueue. Idempotent — safe to call when already started.
    func start() async throws
    /// Gracefully shut down the inference backend.
    /// Called by InferenceQueue on restart or shutdown.
    func stop() async
    /// Zero-cost health check. Returns true if the backend is responsive.
    /// Used by InferenceQueue to verify worker health before dispatching jobs.
    func ping() async throws -> Bool
    /// Synchronously terminate the underlying process.
    /// For use in applicationWillTerminate where async context is unavailable.
    nonisolated func terminateSync()
    /// Run VLM inference on a batch of frames.
    func analyzeFrames(frames: [DbFrame]) async throws -> [FrameDescription]
    /// Generate text from a prompt using the loaded model.
    func generateText(prompt: String, maxTokens: Int) async throws -> String
}
