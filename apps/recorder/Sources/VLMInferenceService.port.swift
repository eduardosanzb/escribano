import Foundation
// MARK: - VLMInferenceService (Port)
//
// Port interface for VLM inference.
//
// "Port" = a protocol that defines what the business logic (FrameAnalyzer) needs.
// "Adapter" = a concrete type that implements the protocol for a specific backend.
//
// Think of it like a power outlet (port) vs. a plug (adapter):
//   - The outlet shape is fixed — that's this protocol.
//   - You can have a US plug, a UK plug, etc. — those are adapters.
//   - The lamp (FrameAnalyzer) just plugs in — it doesn't care which country it's in.
//
// Current adapter: PythonBridgeVLMAdapter — calls mlx_bridge.py via Unix socket.
// Future adapters could be: a pure-Swift CoreML adapter, a cloud API adapter, etc.
//
// Why "AnyObject, Sendable"?
//   Same reason as ObservationStore: FrameAnalyzer is an actor, and Swift 6 requires
//   anything stored in an actor to be Sendable. "AnyObject" restricts to classes/actors,
//   which have reference semantics Swift can reason about across isolation boundaries.
protocol VLMInferenceService: AnyObject, Sendable {
    /// Start the inference backend (spawn process, connect socket, load model).
    /// Called once at startup. Idempotent — safe to call multiple times.
    func start() async throws
    /// Run VLM inference on a batch of frames.
    /// - Parameter frames: DB rows; `.imagePath` fields are read as JPEG inputs.
    /// - Returns: One `FrameDescription` per frame. Count MAY be less than input
    ///   if the VLM output was malformed (parser couldn't extract a frame).
    func runBatch(frames: [DbFrame]) async throws -> [FrameDescription]
    /// Gracefully shut down the inference backend.
    /// Called on SIGTERM / app shutdown.
    func stop() async
    /// Synchronously terminate the underlying process.
    /// For use in applicationWillTerminate where async context is unavailable.
    nonisolated func terminateSync()
}
