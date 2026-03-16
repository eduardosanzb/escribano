import Foundation
@preconcurrency import MLXVLM
@preconcurrency import MLXLMCommon

enum VLMRunner {

    // -------------------------------------------------------------------------
    // Single-image prompt — verbatim copy of prompts/vlm-single.md
    // Edit to experiment with different instructions
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
    // Batch prompt — verbatim copy of prompts/vlm-batch.md
    // Frame count is substituted at runtime
    // -------------------------------------------------------------------------
    static func batchPrompt(frameCount: Int) -> String {
        """
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

    static func run(imagePaths: [String], modelDir: String) async throws {
        print("[VLM] Loading from: \(modelDir)")
        let t0 = Date()

        let config = ModelConfiguration(directory: URL(fileURLWithPath: modelDir))
        let container = try await VLMModelFactory.shared.loadContainer(configuration: config) { progress in
            print("[VLM] Loading... \(Int(progress.fractionCompleted * 100))%", terminator: "\r")
            fflush(stdout)
        }
        print("[VLM] Model loaded in \(String(format: "%.1f", Date().timeIntervalSince(t0)))s")
        print("[VLM] Mode: \(imagePaths.count == 1 ? "single" : "batch (\(imagePaths.count) frames)")")
        print()

        let userInput: UserInput

        if imagePaths.count == 1 {
            // --- single image: simple Chat.Message ---
            userInput = UserInput(chat: [
                .user(singlePrompt, images: [.url(URL(fileURLWithPath: imagePaths[0]))])
            ])
        } else {
            // --- multiple images: interleaved raw messages format ---
            // Mirrors exactly what intelligence.mlx.adapter.ts builds for batch inference
            var contentParts: [[String: any Sendable]] = []
            for (i, _) in imagePaths.enumerated() {
                contentParts.append(["type": "text", "text": "Frame \(i + 1):"])
                contentParts.append(["type": "image"])
            }
            contentParts.append(["type": "text", "text": batchPrompt(frameCount: imagePaths.count)])

            let messages: [[String: any Sendable]] = [[
                "role": "user",
                "content": contentParts as [any Sendable]
            ]]
            let images = imagePaths.map { UserInput.Image.url(URL(fileURLWithPath: $0)) }
            userInput = UserInput(messages: messages, images: images)
          print(userInput)
        }

        print("=== RAW RESPONSE ===")
        let tGen = Date()

        try await container.perform { (context: MLXLMCommon.ModelContext) -> Void in
            let prepared = try await context.processor.prepare(input: userInput)
            
            // Use the new async stream-based generate API
            var localTokenCount = 0
            for try await text in try MLXLMCommon.generate(
                input: prepared,
                parameters: GenerateParameters(temperature: 0.0),
                context: context
            ) {
                localTokenCount += 1
                print(text, terminator: "")
                fflush(stdout)
                // Count tokens by decoding the accumulated output
                localTokenCount += 1
            }
        }

        let elapsed = Date().timeIntervalSince(tGen)
        print("\n=== END ===")
        print("[VLM] Generated in \(String(format: "%.1f", elapsed))s")
    }

    static func runBatch(imagePaths: [String], modelDir: String) async throws -> [String] {
        guard imagePaths.count > 0 else { return [] }
        
        let config = ModelConfiguration(directory: URL(fileURLWithPath: modelDir))
        let container = try await VLMModelFactory.shared.loadContainer(configuration: config) { _ in }
        
        // Build interleaved message format
        var contentParts: [[String: any Sendable]] = []
        for (i, _) in imagePaths.enumerated() {
            contentParts.append(["type": "text", "text": "Frame \(i + 1):"])
            contentParts.append(["type": "image"])
        }
        contentParts.append(["type": "text", "text": batchPrompt(frameCount: imagePaths.count)])

        let messages: [[String: any Sendable]] = [[
            "role": "user",
            "content": contentParts as [any Sendable]
        ]]
        let images = imagePaths.map { UserInput.Image.url(URL(fileURLWithPath: $0)) }
        let userInput = UserInput(messages: messages, images: images)

        print("[VLM] Running batch inference on \(imagePaths.count) frames...")
        let tGen = Date()
        
        let fullResponse = try await collectBatchResponse(container: container, userInput: userInput)
        let elapsed = Date().timeIntervalSince(tGen)
        print("[VLM] Batch: \(imagePaths.count) frames in \(String(format: "%.1f", elapsed))s\n")
        
        // Parse descriptions from response
        // Expected format: "Frame N: description: X | activity: Y | apps: Z | topics: W"
        let lines = fullResponse.split(separator: "\n", omittingEmptySubsequences: true)
        var descriptions: [String] = []
        
        for line in lines {
            let lineStr = String(line).trimmingCharacters(in: .whitespaces)
            if lineStr.hasPrefix("Frame ") {
                // Extract description between "description: " and " | activity"
                if let descStart = lineStr.range(of: "description: ") {
                    let afterDesc = lineStr[descStart.upperBound...]
                    if let descEnd = afterDesc.range(of: " | activity") {
                        let description = String(afterDesc[..<descEnd.lowerBound]).trimmingCharacters(in: .whitespaces)
                        descriptions.append(description)
                    }
                }
            }
        }
        
        return descriptions
    }
    
    private static func collectBatchResponse(container: MLXLMCommon.ModelContainer, userInput: UserInput) async throws -> String {
        let fullResponse = try await container.perform { (context: MLXLMCommon.ModelContext) -> String in
            let prepared = try await context.processor.prepare(input: userInput)
            
            var responses: [String] = []
            var localTokenCount = 0
            for try await text in try MLXLMCommon.generate(
                input: prepared,
                parameters: GenerateParameters(temperature: 0.0),
                context: context
            ) {
                if let str = text as? String {
                    responses.append(str)
                } else {
                    responses.append(String(describing: text))
                }
                print(text, terminator: "")
                fflush(stdout)
                localTokenCount += 1
            }
            return responses.joined()
        }
        return fullResponse
    }
}
