/**
 * Shared VLM output parser utilities.
 * Intended for adoption by adapter files in a future cleanup pass.
 * The parseInterleavedOutput logic mirrors intelligence.mlx.adapter.ts.
 */

/**
 * A single parsed frame from interleaved VLM output.
 */
export interface ParsedFrame {
  index: number;
  description: string;
  activity: string;
  apps: string[];
  topics: string[];
  raw_response?: string;
  timestamp?: number; // add this
  imagePath?: string; // add this
}

/**
 * Strip <think>...</think> tags from LLM output.
 * Handles standard pairs and Qwen's orphan </think> edge case.
 */
export function stripThinkingTags(text: string): string {
  // Strip complete <think>...</think> pairs (standard case)
  let result = text.replace(/<think>[\s\S]*?<\/think>/g, '');

  // Strip orphan closing tag + everything before it (Qwen3.5 actual behavior)
  // This handles: "Let me analyze...\n</think>\n# Actual answer"
  if (result.includes('</think>')) {
    const parts = result.split('</think>');
    result = parts[parts.length - 1]; // Take content after the last </think>
  }

  return result.trim();
}

/**
 * Parse interleaved multi-frame VLM output.
 * Handles the pipe-delimited format returned by MLX-VLM.
 *
 * @param rawText - Raw text output from the VLM model
 * @param expectedFrameCount - Number of frames expected in the output
 * @returns Array of parsed frames (length === expectedFrameCount)
 */
export function parseInterleavedOutput(
  rawText: string,
  expectedFrameCount: number,
  batch?: Array<{ index: number; timestamp?: number; imagePath?: string }>
): ParsedFrame[] {
  const results: ParsedFrame[] = [];

  for (let frameNum = 1; frameNum <= expectedFrameCount; frameNum++) {
    // Look for "Frame N: description: ..." pattern
    const pattern = new RegExp(
      `Frame ${frameNum}:\\s*description:\\s*(.+?)\\s*\\|\\s*activity:\\s*(.+?)\\s*\\|\\s*apps:\\s*(\\[.+?\\]|[^|]+)\\s*\\|\\s*topics:\\s*(.+?)(?=Frame \\d+:|$)`,
      'is'
    );
    const match = rawText.match(pattern);

    if (match) {
      const appsStr = match[3].replace(/^\[|\]$/g, '').trim();
      const topicsStr = match[4].replace(/^\[|\]$/g, '').trim();

      const batchEntry = batch?.[frameNum - 1];
      results.push({
        index: batchEntry?.index ?? frameNum - 1,
        timestamp: batchEntry?.timestamp,
        imagePath: batchEntry?.imagePath,
        description: match[1].trim(),
        activity: match[2].trim(),
        apps: appsStr
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        topics: topicsStr
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      });
    } else {
      const batchEntry = batch?.[frameNum - 1];
      results.push({
        index: batchEntry?.index ?? frameNum - 1,
        timestamp: batchEntry?.timestamp,
        imagePath: batchEntry?.imagePath,
        description: `Failed to parse Frame ${frameNum}`,
        activity: 'unknown',
        apps: [],
        topics: [],
        raw_response: rawText,
      });
    }
  }

  return results;
}
