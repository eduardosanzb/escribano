import Foundation
@preconcurrency import MLXLLM
@preconcurrency import MLXLMCommon

enum LLMRunner {

    // -------------------------------------------------------------------------
    // Default test prompt — verbatim base from prompts/subject-grouping.md
    // Template vars filled in with a representative example so the POC
    // runs self-contained without needing real DB data.
    // Edit to experiment with different instructions.
    // -------------------------------------------------------------------------
    static let defaultPrompt = """
    You are analyzing a work session that has been divided into 4 segments (TopicBlocks).

    Your task is to group these segments into 1-6 coherent SUBJECTS. A subject represents a distinct thread of work (e.g., "Escribano pipeline optimization", "Personal time", "Email and admin", "Research on competitors").

    GROUPING RULES:
    1. Group segments that belong to the same work thread, even if they're not consecutive in time
    2. Personal activities (WhatsApp, Instagram, social media, personal calls) should be grouped into a "Personal" subject
    3. Email/calendar/admin is only its own group when email IS the primary activity — not just because an email app was open in the background
    4. Deep work on the same project/codebase should be grouped together
    5. Research sessions should be grouped separately from coding sessions unless clearly related

    RULE PRIORITY (when in doubt):
    - Classify by primary ACTIVITY TYPE and project context, not by which apps happened to be open
    - If all segments are about the same project, one group is correct — do not invent artificial splits

    SEGMENTS TO GROUP:
    BLOCK abc-001 [0:00–0:45] coding 45m | VS Code, iTerm | Escribano, Swift, ScreenCaptureKit
    Summary: Implementing SCStream capture loop in Swift, writing PHash deduplication logic, testing frame output to disk.

    BLOCK abc-002 [0:45–1:10] terminal 25m | iTerm | Swift, Xcode, build
    Summary: Running swift build, fixing compiler errors, checking binary output in .build/release/.

    BLOCK abc-003 [1:10–1:30] research 20m | Chrome, Safari | MLX, Swift, machine learning
    Summary: Reading mlx-swift-lm README, checking Swift Package Index for version compatibility.

    BLOCK abc-004 [1:30–1:45] other 15m | WhatsApp, Instagram
    Summary: Checking personal messages and social media.

    For each group, output ONE line in this EXACT format:
    Group 1: label: [Descriptive subject name] | blockIds: [uuid1, uuid2, uuid3]

    CRITICAL REQUIREMENTS:
    - Each group MUST have "label" and "blockIds"
    - Include ALL 4 block IDs across all groups (every block must be assigned exactly once)
    - Create 1-6 groups (one group is fine if all work is the same project)
    - Use clear, descriptive labels for each subject
    - Output ONLY the group lines — no explanation, no preamble, no markdown
    """

    static func run(prompt: String, modelDir: String) async throws {
        let resolvedPrompt = prompt == "default" ? defaultPrompt : prompt
        print("[LLM] Loading from: \(modelDir)")
        let t0 = Date()

        let config = ModelConfiguration(directory: URL(fileURLWithPath: modelDir))
        let container = try await LLMModelFactory.shared.loadContainer(configuration: config) { progress in
            print("[LLM] Loading... \(Int(progress.fractionCompleted * 100))%", terminator: "\r")
            fflush(stdout)
        }
        print("[LLM] Model loaded in \(String(format: "%.1f", Date().timeIntervalSince(t0)))s")

        let userInput = UserInput(chat: [
            .user(resolvedPrompt)
        ])

        print("[LLM] Prompt length: \(resolvedPrompt.count) chars")
        print("[LLM] Generating...\n")
        print("=== RAW RESPONSE ===")

        let tGen = Date()

        try await container.perform { (context: MLXLMCommon.ModelContext) -> Void in
            let prepared = try await context.processor.prepare(input: userInput)
            
            // Use the new async stream-based generate API
            var localTokenCount = 0
            for try await text in try MLXLMCommon.generate(
                input: prepared,
                parameters: GenerateParameters(temperature: 0.6),
                context: context
            ) {
                print(text, terminator: "")
                fflush(stdout)
                // Count tokens by decoding the accumulated output
                localTokenCount += 1
            }
        }

        let elapsed = Date().timeIntervalSince(tGen)
        print("\n=== END ===")
        print("[LLM] Generated in \(String(format: "%.1f", elapsed))s")
    }
}
