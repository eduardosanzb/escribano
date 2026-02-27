/**
 * Escribano - VLM Service
 *
 * Orchestrates sequential VLM inference for frame descriptions.
 * Each frame is processed individually for accurate image-description mapping.
 */

import type { IntelligenceService } from '../0_types.js';
import type { InputFrame } from './frame-sampling.js';

export interface VLMConfig {
  /** Vision model to use (default: qwen3-vl:4b) */
  model: string;
  /** Recording ID for debug output */
  recordingId?: string;
  /** Callback invoked after each image is processed */
  onImageProcessed?: (
    result: FrameDescription,
    progress: { current: number; total: number }
  ) => void;
}

export interface FrameDescription {
  index: number;
  timestamp: number;
  activity: string;
  description: string;
  apps: string[];
  topics: string[];
  imagePath: string;
  raw_response?: string;
}

const DEFAULT_CONFIG: VLMConfig = {
  model: process.env.ESCRIBANO_VLM_MODEL || 'qwen3-vl:4b',
};

/**
 * Process sampled frames through VLM sequentially (one image at a time).
 *
 * @param frames - Sampled frames from adaptiveSample()
 * @param intelligence - Intelligence service with describeImages
 * @param config - Processing configuration
 * @returns Array of frame descriptions with VLM analysis
 */
export async function describeFrames(
  frames: InputFrame[],
  intelligence: IntelligenceService,
  config: Partial<VLMConfig> = {}
): Promise<FrameDescription[]> {
  const cfg: VLMConfig = { ...DEFAULT_CONFIG, ...config };

  if (frames.length === 0) {
    console.log('[VLM] No frames to process');
    return [];
  }

  const total = frames.length;
  console.log(`[VLM] Processing ${total} frames sequentially...`);
  console.log(`[VLM] Model: ${cfg.model}`);

  // Prepare input for intelligence service
  const images = frames.map((f) => ({
    imagePath: f.imagePath,
    timestamp: f.timestamp,
  }));

  // Call the sequential VLM API with per-image callback
  const results = await intelligence.describeImages(images, {
    model: cfg.model,
    recordingId: cfg.recordingId,
    onImageProcessed: cfg.onImageProcessed,
  });

  console.log(`\n[VLM] Completed ${results.length}/${total} frames`);

  return results as FrameDescription[];
}

/** @deprecated Use describeFrames instead */
export const batchDescribeFrames = describeFrames;

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
    watching: 'research',
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
    review: 'review',
    reviewing: 'review',
    'code review': 'review',
    'reviewing pr': 'review',
    'pull request': 'review',
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
