/**
 * Escribano - Activity Segmentation Service
 *
 * Groups consecutive VLM observations by activity continuity.
 * Replaces embedding-based clustering with VLM-driven segmentation.
 */

import type { DbObservation } from '../db/types.js';

export interface Segment {
  /** Unique segment ID */
  id: string;
  /** Recording this segment belongs to */
  recordingId: string;
  /** Activity type for this segment */
  activityType: string;
  /** Start timestamp in seconds */
  startTime: number;
  /** End timestamp in seconds */
  endTime: number;
  /** Duration in seconds */
  duration: number;
  /** Observation IDs in this segment */
  observationIds: string[];
  /** VLM description from the key observation (first in segment) */
  keyDescription: string;
  /** Detected apps/topics (extracted from all observations) */
  apps: string[];
  topics: string[];
}

export interface SegmentationConfig {
  /** Minimum segment duration in seconds (default: 30) */
  minSegmentDuration: number;
  /** Gap tolerance in seconds for activity continuity (default: 5) */
  gapTolerance: number;
}

const DEFAULT_CONFIG: SegmentationConfig = {
  minSegmentDuration: 30,
  gapTolerance: 5,
};

/**
 * Extract activity type from VLM description.
 * Uses prioritized activity detection with precise pattern matching.
 */
function extractActivityType(vlmDescription: string | null): string {
  if (!vlmDescription) return 'other';

  // Normalize the activity string
  const normalized = vlmDescription.toLowerCase().trim();

  // Check for known activity patterns (order matters - more specific first)
  const activityPatterns: Record<string, string[]> = {
    // Debugging - very specific technical terms
    debugging: [
      'debugging',
      'troubleshooting',
      'investigating error',
      'reading error',
      'stack trace',
      'exception thrown',
      'error message',
      'fixing bug',
    ],
    // Coding/Development
    coding: [
      'writing code',
      'implementing',
      'developing',
      'programming',
      'refactoring',
      'coding',
    ],
    // Code Review - specific workflow
    review: ['reviewing pr', 'pull request', 'code review', 'reviewing code'],
    // Meeting/Collaboration
    meeting: [
      'in zoom',
      'in google meet',
      'in slack huddle',
      'video call',
      'screen sharing',
      'team meeting',
    ],
    // Research/Information gathering
    research: [
      'browsing',
      'stack overflow',
      'googling',
      'researching',
      'searching for',
    ],
    // Reading documentation
    reading: [
      'reading documentation',
      'reading docs',
      'reading manual',
      'reading guide',
    ],
    // Terminal/CLI operations (only if explicitly mentioned)
    terminal: [
      'in terminal',
      'in iterm',
      'command line',
      'running git',
      'running npm',
    ],
  };

  // Check each activity type in order (most specific patterns first)
  for (const [activityType, patterns] of Object.entries(activityPatterns)) {
    for (const pattern of patterns) {
      if (normalized.includes(pattern)) {
        return activityType;
      }
    }
  }

  // Check for single-word activities that appear at the start
  const firstWord = normalized.split(/[\s,.]+/)[0];
  const startPatterns: Record<string, string[]> = {
    debugging: ['debug', 'fix'],
    coding: ['writing', 'implementing', 'developing'],
    reading: ['reading'],
    research: ['researching', 'browsing'],
  };

  for (const [activityType, patterns] of Object.entries(startPatterns)) {
    if (patterns.includes(firstWord)) {
      return activityType;
    }
  }

  return 'other';
}

/**
 * Parse VLM description to extract apps and topics.
 * Expects format like: "Debugging Python error in VSCode, working on escribano project"
 */
function extractContext(vlmDescription: string | null): {
  apps: string[];
  topics: string[];
} {
  if (!vlmDescription) return { apps: [], topics: [] };

  const apps: string[] = [];
  const topics: string[] = [];

  const text = vlmDescription.toLowerCase();

  // Common app patterns
  const appPatterns = [
    /in (vscode|vs code|visual studio code)/i,
    /in (terminal|iterm|alacritty|warp)/i,
    /in (chrome|safari|firefox|browser)/i,
    /in (slack|discord|teams|zoom)/i,
    /in (github|gitlab|bitbucket)/i,
    /in (intellij|webstorm|pycharm)/i,
    /using (vscode|terminal|chrome|slack)/i,
  ];

  for (const pattern of appPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      apps.push(match[1].toLowerCase().replace(' ', '_'));
    }
  }

  // Extract potential project names (capitalized words after "working on" or "in")
  const topicPatterns = [
    /working on (?:the )?(\w+)/i,
    /(?:in|for) (?:the )?(\w+) project/i,
    /(?:implementing|fixing|debugging) (\w+)/i,
  ];

  for (const pattern of topicPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      topics.push(match[1].toLowerCase());
    }
  }

  return { apps: [...new Set(apps)], topics: [...new Set(topics)] };
}

/**
 * Group consecutive observations by activity type.
 *
 * @param observations - Visual observations with VLM descriptions, sorted by timestamp
 * @param config - Segmentation configuration
 * @returns Array of segments grouped by activity continuity
 */
export function segmentByActivity(
  observations: DbObservation[],
  config: Partial<SegmentationConfig> = {}
): Segment[] {
  const cfg: SegmentationConfig = { ...DEFAULT_CONFIG, ...config };

  // Filter to visual observations only, sorted by timestamp
  const visualObs = observations
    .filter((o) => o.type === 'visual' && o.vlm_description)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (visualObs.length === 0) {
    return [];
  }

  // Group consecutive observations by activity type
  const rawSegments: Array<{
    activityType: string;
    startTime: number;
    endTime: number;
    observations: DbObservation[];
  }> = [];

  let currentSegment: (typeof rawSegments)[0] | null = null;

  for (const obs of visualObs) {
    const activityType = extractActivityType(obs.vlm_description);

    if (!currentSegment || currentSegment.activityType !== activityType) {
      // Start new segment
      if (currentSegment) {
        rawSegments.push(currentSegment);
      }
      currentSegment = {
        activityType,
        startTime: obs.timestamp,
        endTime: obs.end_timestamp ?? obs.timestamp,
        observations: [obs],
      };
    } else {
      // Continue current segment
      currentSegment.endTime = obs.end_timestamp ?? obs.timestamp;
      currentSegment.observations.push(obs);
    }
  }

  // Don't forget the last segment
  if (currentSegment) {
    rawSegments.push(currentSegment);
  }

  // Merge short segments into their longest neighbor
  const mergedSegments = mergeShortSegments(
    rawSegments,
    cfg.minSegmentDuration
  );

  // Convert to final Segment format
  return mergedSegments.map((seg, index) => {
    const context = extractContext(
      seg.observations[0]?.vlm_description || null
    );
    return {
      id: `seg-${index}`,
      recordingId: seg.observations[0]?.recording_id || '',
      activityType: seg.activityType,
      startTime: seg.startTime,
      endTime: seg.endTime,
      duration: seg.endTime - seg.startTime,
      observationIds: seg.observations.map((o) => o.id),
      keyDescription: seg.observations[0]?.vlm_description || '',
      apps: context.apps,
      topics: context.topics,
    };
  });
}

/**
 * Merge segments shorter than minDuration into their longest neighbor.
 *
 * Strategy:
 * 1. For each short segment, find the longer of (previous, next) neighbor
 * 2. Merge into that neighbor (concatenate observations, extend time range)
 * 3. If no neighbors exist (only segment), keep it as-is
 */
function mergeShortSegments(
  segments: Array<{
    activityType: string;
    startTime: number;
    endTime: number;
    observations: DbObservation[];
  }>,
  minDuration: number
): typeof segments {
  if (segments.length <= 1) {
    return segments;
  }

  const result = [...segments];
  let i = 0;

  while (i < result.length) {
    const seg = result[i];
    const duration = seg.endTime - seg.startTime;

    if (duration >= minDuration) {
      // Segment is long enough, keep it
      i++;
      continue;
    }

    // Find neighbors
    const prev = i > 0 ? result[i - 1] : null;
    const next = i < result.length - 1 ? result[i + 1] : null;

    if (!prev && !next) {
      // Only segment, keep it
      i++;
      continue;
    }

    // Choose longer neighbor
    const prevDuration = prev ? prev.endTime - prev.startTime : 0;
    const nextDuration = next ? next.endTime - next.startTime : 0;
    const targetIndex = prevDuration >= nextDuration ? i - 1 : i + 1;
    const target = result[targetIndex];

    // Merge into target
    target.observations = target.observations.concat(seg.observations);
    target.startTime = Math.min(target.startTime, seg.startTime);
    target.endTime = Math.max(target.endTime, seg.endTime);

    // Remove short segment
    result.splice(i, 1);

    // If we merged into previous, stay at same index (since we removed current)
    // If we merged into next, stay at same index
    // No need to adjust i since we removed the current element
  }

  return result;
}

/**
 * Get statistics about segments.
 */
export function getSegmentStats(segments: Segment[]): {
  totalSegments: number;
  totalDuration: number;
  activityTypeCounts: Record<string, number>;
  avgSegmentDuration: number;
} {
  const activityTypeCounts: Record<string, number> = {};
  let totalDuration = 0;

  for (const seg of segments) {
    activityTypeCounts[seg.activityType] =
      (activityTypeCounts[seg.activityType] || 0) + 1;
    totalDuration += seg.duration;
  }

  return {
    totalSegments: segments.length,
    totalDuration,
    activityTypeCounts,
    avgSegmentDuration:
      segments.length > 0 ? totalDuration / segments.length : 0,
  };
}
