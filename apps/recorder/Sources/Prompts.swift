import Foundation
// MARK: - Prompts
//
// Single source of truth for all VLM prompt text.
//
// Why always batch format even for 1 frame?
//   The single-frame prompt produced "description: ... | activity: ..."
//   which the ResponseParser couldn't parse (it requires "Frame N:" prefix).
//   Using batch format for all inputs means the parser always works — no
//   special-case branch needed anywhere.
enum Prompts {
    /// Build the VLM prompt for `frameCount` frames.
    /// Always returns batch-format text with "Frame N:" prefix instructions,
    /// even when frameCount == 1, so ResponseParser always finds "Frame " lines.
    static func vlmBatch(frameCount: Int) -> String {
        """
        /no_think
        Analyze these \(frameCount) screenshots from a screen recording.
        For each frame, output ONE line in this EXACT format:
        Frame 1: description: [what user is doing + context/intent] | activity: [one word] | apps: [list] | topics: [list]
        Activity MUST be one of: debugging coding review meeting research reading terminal other
        Good descriptions capture WHAT the user is doing, WHAT they're working on, and WHY:
        - "Fixing TypeScript type error in the fetch handler after a failed API integration test"
        - "Reading Qwen3-VL documentation to understand multimodal token format for the VLM adapter"
        - "Searching Stack Overflow for React useEffect cleanup patterns to fix a memory leak"
        - "Reviewing PR #142 which adds batch processing to the MLX inference pipeline"
        - "Running database migrations in terminal to add the new observations table schema"
        Example output for \(frameCount) frame(s):
        Frame 1: description: Fixing TypeScript type error in the fetch handler | activity: debugging | apps: [VS Code, Chrome] | topics: [TypeScript, API]
        Now analyze all \(frameCount) frame(s):
        """
    }
}
