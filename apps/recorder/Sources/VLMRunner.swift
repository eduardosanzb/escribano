import Foundation
@preconcurrency import MLXVLM
@preconcurrency import MLXLMCommon
// MARK: - VLMRunner
//
// Stateless batch inference wrapper around a pre-loaded MLX model container.
//
// "Pre-loaded" means: VLMAnalyzer calls VLMModelFactory.shared.loadContainer() ONCE at startup,
// stores the result, and passes it here for every batch. No model reload penalty per batch.
//
// The prompt format mirrors intelligence.mlx.adapter.ts exactly so output is consistent
// between the always-on recorder pipeline and the batch --file pipeline.
enum VLMRunner {
    // -------------------------------------------------------------------------
    // Single-frame prompt (used when batch size = 1)
    // Mirrors prompts/vlm-single.md — do NOT change without updating that file too
    // -------------------------------------------------------------------------
    static let singlePrompt = """
    Analyze this screenshot from a screen recording.

    Output ONE line in this EXACT format:
    description: [what user is doing + context/intent] | activity: [one word] | apps: [list] | topics: [list]

    Activity MUST be one of: debugging coding review meeting research reading terminal other

    Good descriptions capture WHAT the user is doing, WHAT they're working on, and WHY:
    - "Fixing TypeScript type error in the fetch handler after a failed API integration test" (not just "debugging error")
    - "Reading Qwen3-VL documentation to understand multimodal token format for the VLM adapter" (not just "reading docs")
    - "Searching Stack Overflow for React useEffect cleanup patterns to fix a memory leak" (not just "browsing")
    - "Reviewing PR #142 which adds batch processing to the MLX inference pipeline" (not just "reviewing PR")
    - "Running database migrations in terminal to add the new observations table schema" (not just "in terminal")
    - "Watching a YouTube tutorial on SQLite query optimization for the frame sampling service" (not just "watching video")

    Example:
    description: Fixing TypeScript type error in the fetch handler after a failed API integration test | activity: debugging | apps: [VS Code, Chrome] | topics: [TypeScript, API]

    Now analyze the screenshot:
    """
    // -------------------------------------------------------------------------
    // Batch prompt (used when batch size > 1, N substituted at runtime)
    // Mirrors prompts/vlm-batch.md — do NOT change without updating that file too
    // -------------------------------------------------------------------------
    static func batchPrompt(frameCount: Int) -> String {
        """
        /no_think
        Analyze these \(frameCount) screenshots from a screen recording.

        For each frame, output ONE line in this EXACT format:
        Frame 1: description: [what user is doing + context/intent] | activity: [one word] | apps: [list] | topics: [list]

        Activity MUST be one of: debugging coding review meeting research reading terminal other

        Good descriptions capture WHAT the user is doing, WHAT they're working on, and WHY:
        - "Fixing TypeScript type error in the fetch handler after a failed API integration test" (not just "debugging error")
        - "Reading Qwen3-VL documentation to understand multimodal token format for the VLM adapter" (not just "reading docs")
        - "Searching Stack Overflow for React useEffect cleanup patterns to fix a memory leak" (not just "browsing")
        - "Reviewing PR #142 which adds batch processing to the MLX inference pipeline" (not just "reviewing PR")
        - "Running database migrations in terminal to add the new observations table schema" (not just "in terminal")
        - "Watching a YouTube tutorial on SQLite query optimization for the frame sampling service" (not just "watching video")

        Example output:
        Frame 1: description: Fixing TypeScript type error in the fetch handler after a failed API integration test | activity: debugging | apps: [VS Code, Chrome] | topics: [TypeScript, API]
        Frame 2: description: Reading Qwen3-VL documentation to understand multimodal token format for the VLM adapter | activity: reading | apps: [Chrome] | topics: [Qwen3-VL, VLM]
        Frame 3: description: Running database migrations in terminal to add the new observations table schema | activity: terminal | apps: [iTerm, VS Code] | topics: [SQLite, migrations]

        Now analyze all \(frameCount) frames:
        """
    }
    // MARK: - Public API
    /// Run batch VLM inference on a pre-loaded model container.
    ///
    /// - Parameters:
    ///   - frames: DB frames to analyze; their `imagePath` fields are used as image inputs.
    ///   - container: Pre-loaded MLX model container (reused across batches — no reload cost).
    /// - Returns: Parsed FrameDescription per frame.
    ///   Count may be less than input if the VLM output was malformed for some frames.
    static func runBatch(frames: [DbFrame], container: MLXLMCommon.ModelContainer) async throws -> [FrameDescription] {
        guard !frames.isEmpty else { return [] }
        let imagePaths = frames.map { $0.imagePath }
        let userInput: UserInput
        if imagePaths.count == 1 {
            userInput = UserInput(chat: [
                .user(singlePrompt, images: [.url(URL(fileURLWithPath: imagePaths[0]))])
            ])
        } else {
            var contentParts: [[String: any Sendable]] = []
            for (i, _) in imagePaths.enumerated() {
                contentParts.append(["type": "text",  "text": "Frame \(i + 1):"])
                contentParts.append(["type": "image"])
            }
            contentParts.append(["type": "text", "text": batchPrompt(frameCount: imagePaths.count)])
            let messages: [[String: any Sendable]] = [[
                "role":    "user",
                "content": contentParts as [any Sendable]
            ]]
            let images = imagePaths.map { UserInput.Image.url(URL(fileURLWithPath: $0)) }
            print("[VLMRunner] Using batch prompt, for \(images.count) images.")
            userInput = UserInput(messages: messages, images: images)
        }
        let rawResponse = try await collectResponse(container: container, userInput: userInput)
        let descriptions = ResponseParser.parseInterleavedOutput(rawResponse)
        print("[VLMRunner] Parsed \(descriptions.count)/\(frames.count) frame descriptions")
        print("[VLMRunner][debug] head of parsed descriptions: \(descriptions.prefix(3))")
        return descriptions
    }
    // MARK: - Private
    /// Stream tokens from the model and join them into a single String.
    private static func collectResponse(
        container: MLXLMCommon.ModelContainer,
        userInput: UserInput
    ) async throws -> String {
        let fullResponse = try await container.perform { (context: MLXLMCommon.ModelContext) -> String in
            let prepared = try await context.processor.prepare(input: userInput)
            var tokens: [String] = []
            for try await token in try MLXLMCommon.generate(
                input: prepared,
                parameters: GenerateParameters(temperature: 0.0),
                context: context
            ) {
                if let chunk = token.chunk {
                    tokens.append(chunk)
                }
            }
            return tokens.joined()
        }
        return fullResponse
    }
}
