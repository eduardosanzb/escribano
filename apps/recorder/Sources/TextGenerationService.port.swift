import Foundation

// MARK: - TextGenerationService (Port)
//
// Port interface for text-only generation using the loaded VLM model.
//
// The key insight from the VLM-as-LLM POC: Qwen3-VL handles text-only
// prompts natively. We don't need a separate LLM model — the already-loaded
// VLM can generate text for semantic grouping of observations.
//
// Current adapter: PythonBridgeVLMAdapter — calls mlx_bridge.py text_infer
// over the same Unix socket used for VLM inference.
//
// Why separate from VLMInferenceService?
//   VLMInferenceService deals with frames (DbFrame[], FrameDescription[]).
//   TextGenerationService deals with raw text (String → String).
//   Different concerns, different consumers (FrameAnalyzer vs SessionAggregator).
//   Same underlying adapter can implement both.

protocol TextGenerationService: AnyObject, Sendable {
    /// Generate text from a prompt using the loaded model.
    /// - Parameters:
    ///   - prompt: The text prompt to send
    ///   - maxTokens: Maximum tokens to generate (default: 2000)
    /// - Returns: The generated text response
    func generateText(prompt: String, maxTokens: Int) async throws -> String
    /// Attempt to restart the text generation backend after a crash.
    func restart() async throws
}
