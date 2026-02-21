/**
 * Escribano - VLM Service
 *
 * Orchestrates sequential VLM inference for frame descriptions.
 * Each frame is processed individually for accurate image-description mapping.
 */

import type { IntelligenceService } from '../0_types.js';
import { debugLog } from '../adapters/intelligence.ollama.adapter.js';
import type { SampledFrame } from './frame-sampling.js';

export interface VLMConfig {
  /** Vision model to use (default: qwen3-vl:4b) */
  model: string;
  /** Recording ID for debug output */
  recordingId?: string;
  /** Callback invoked after processing completes */
  onBatchComplete?: (
    results: Array<{
      index: number;
      timestamp: number;
      imagePath: string;
      activity: string;
      description: string;
      apps: string[];
      topics: string[];
    }>,
    batchIndex: number
  ) => void;
}

export interface FrameDescription {
  /** Global index in the sampled frames array */
  index: number;
  /** Timestamp in seconds from recording start */
  timestamp: number;
  /** VLM-suggested activity label (flexible, not constrained) */
  activity: string;
  /** Brief description of what's shown */
  description: string;
  /** Detected applications */
  apps: string[];
  /** Detected topics/projects */
  topics: string[];
  /** Path to the source image */
  imagePath: string;
}

const DEFAULT_CONFIG: VLMConfig = {
  model: process.env.ESCRIBANO_VLM_MODEL || 'qwen3-vl:4b',
};

/**
 * Process sampled frames through VLM sequentially (one image at a time).
 *
 * @param frames - Sampled frames from adaptiveSample()
 * @param intelligence - Intelligence service with describeImageBatch
 * @param config - Processing configuration
 * @returns Array of frame descriptions with VLM analysis
 */
export async function batchDescribeFrames(
  frames: SampledFrame[],
  intelligence: IntelligenceService,
  config: Partial<VLMConfig> = {}
): Promise<FrameDescription[]> {
  const cfg: VLMConfig = { ...DEFAULT_CONFIG, ...config };

  if (frames.length === 0) {
    console.log('[VLM] No frames to process');
    return [];
  }

  console.log(`[VLM] Processing ${frames.length} frames sequentially...`);
  console.log(`[VLM] Model: ${cfg.model}`);
  const startTime = Date.now();

  // Prepare input for intelligence service
  const images = frames.map((f) => ({
    imagePath: f.imagePath,
    timestamp: f.timestamp,
  }));

  // Call the sequential VLM API
  const results = await intelligence.describeImageBatch(images, {
    model: cfg.model,
    recordingId: cfg.recordingId,
    onBatchComplete: cfg.onBatchComplete,
  });

  debugLog(
    '[VLM] Results:',
    JSON.stringify(results.slice(0, 3), null, 2),
    '...'
  );

  // Log sample results with their paths
  console.log('[VLM] Results received:');
  results.slice(0, 3).forEach((r, i) => {
    const path = r.imagePath || 'NO_PATH';
    console.log(
      `  [${i}] ${path.split('/').pop()} - ${r.description?.slice(0, 50)}...`
    );
  });
  if (results.length > 3) {
    console.log(`  ... and ${results.length - 3} more`);
  }

  // Validate all results have imagePath
  const missingPaths = results.filter((r) => !r.imagePath);
  if (missingPaths.length > 0) {
    console.warn(
      `[VLM] WARNING: ${missingPaths.length} results missing imagePath!`
    );
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  const fps = ((frames.length / (Date.now() - startTime || 1)) * 1000).toFixed(
    1
  );
  console.log(
    `[VLM] Completed ${results.length}/${frames.length} frames in ${duration}s (${fps} fps)`
  );

  // Results should already have imagePath from the adapter
  return results as FrameDescription[];
}

/**
 * Normalize activity labels to canonical forms.
 * Allows VLM flexibility while maintaining consistency.
 */
export function normalizeActivity(rawActivity: string): string {
  const lower = rawActivity.toLowerCase().trim();

  const synonyms: Record<string, string> = {
    // Debugging
    debugging: 'debugging',
    'fixing bug': 'debugging',
    'investigating error': 'debugging',
    troubleshooting: 'debugging',
    'reading error': 'debugging',
    'stack trace': 'debugging',

    // Coding
    coding: 'coding',
    'writing code': 'coding',
    implementing: 'coding',
    developing: 'coding',
    programming: 'coding',

    // Reading
    reading: 'reading',
    'reading docs': 'reading',
    documentation: 'reading',
    'reading documentation': 'reading',

    // Research
    research: 'research',
    browsing: 'research',
    searching: 'research',
    'stack overflow': 'research',
    googling: 'research',

    // Meeting
    meeting: 'meeting',
    'video call': 'meeting',
    zoom: 'meeting',
    'google meet': 'meeting',
    'screen share': 'meeting',

    // Terminal
    terminal: 'terminal',
    'command line': 'terminal',
    cli: 'terminal',
    shell: 'terminal',

    // Code Review
    'code review': 'code_review',
    'reviewing pr': 'code_review',
    'pull request': 'code_review',
  };

  // Check exact match
  if (synonyms[lower]) {
    return synonyms[lower];
  }

  // Check partial match
  for (const [pattern, normalized] of Object.entries(synonyms)) {
    if (lower.includes(pattern)) {
      return normalized;
    }
  }

  // Return as-is if no match (allows new activities to emerge)
  return lower.replace(/\s+/g, '_');
}

/**
 * Get statistics about VLM processing results.
 */
export function getVLMStats(descriptions: FrameDescription[]): {
  totalFrames: number;
  uniqueActivities: string[];
  activityCounts: Record<string, number>;
  uniqueApps: string[];
  uniqueTopics: string[];
} {
  const activityCounts: Record<string, number> = {};
  const apps = new Set<string>();
  const topics = new Set<string>();

  for (const desc of descriptions) {
    const normalized = normalizeActivity(desc.activity);
    activityCounts[normalized] = (activityCounts[normalized] || 0) + 1;
    desc.apps.forEach((app) => {
      apps.add(app);
    });
    desc.topics.forEach((topic) => {
      topics.add(topic);
    });
  }

  return {
    totalFrames: descriptions.length,
    uniqueActivities: Object.keys(activityCounts),
    activityCounts,
    uniqueApps: Array.from(apps),
    uniqueTopics: Array.from(topics),
  };
}
