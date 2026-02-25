/**
 * Escribano - Adaptive Frame Sampling Service
 *
 * Reduces frame count while preserving important moments.
 * Strategy: Base sampling (10s) + gap filling for large time jumps.
 */

export interface SamplingConfig {
  /** Base sampling interval in seconds (default: 10) */
  baseIntervalSeconds: number;
  /** Threshold for detecting gaps that need filling (default: 15) */
  gapThresholdSeconds: number;
  /** Interval for filling detected gaps (default: 3) */
  gapFillIntervalSeconds: number;
}

export interface SampledFrame {
  imagePath: string;
  timestamp: number;
  reason: 'base' | 'gap_fill' | 'scene_change';
}

export interface InputFrame {
  imagePath: string;
  timestamp: number;
}

const DEFAULT_CONFIG: SamplingConfig = {
  baseIntervalSeconds: Number(process.env.ESCRIBANO_SAMPLE_INTERVAL) || 10,
  gapThresholdSeconds: Number(process.env.ESCRIBANO_SAMPLE_GAP_THRESHOLD) || 15,
  gapFillIntervalSeconds: Number(process.env.ESCRIBANO_SAMPLE_GAP_FILL) || 3,
};

/**
 * Find the frame closest to a target timestamp.
 */
function findNearestFrame(
  frames: InputFrame[],
  targetTimestamp: number
): InputFrame | null {
  if (frames.length === 0) return null;

  let nearest = frames[0];
  let minDiff = Math.abs(frames[0].timestamp - targetTimestamp);

  for (const frame of frames) {
    const diff = Math.abs(frame.timestamp - targetTimestamp);
    if (diff < minDiff) {
      minDiff = diff;
      nearest = frame;
    }
  }

  return nearest;
}

/**
 * Adaptively sample frames from a recording.
 *
 * Strategy:
 * 1. Take frames at base interval (default: every 10 seconds)
 * 2. Detect gaps larger than threshold (default: 15 seconds)
 * 3. Fill gaps with denser sampling (default: every 3 seconds)
 *
 * @param allFrames - All extracted frames (typically at 2s intervals)
 * @param config - Sampling configuration
 * @returns Sampled frames with reason annotations
 */
export function adaptiveSample(
  allFrames: InputFrame[],
  config: Partial<SamplingConfig> = {}
): SampledFrame[] {
  const cfg: SamplingConfig = { ...DEFAULT_CONFIG, ...config };

  if (allFrames.length === 0) return [];

  // Sort frames by timestamp
  const sortedFrames = [...allFrames].sort((a, b) => a.timestamp - b.timestamp);

  // Step 1: Base sampling - take frames at regular intervals
  const baseSampled: SampledFrame[] = [];
  const sampledTimestamps = new Set<number>();
  let lastSampledTime = -Infinity;

  for (const frame of sortedFrames) {
    if (frame.timestamp - lastSampledTime >= cfg.baseIntervalSeconds) {
      baseSampled.push({
        imagePath: frame.imagePath,
        timestamp: frame.timestamp,
        reason: 'base',
      });
      sampledTimestamps.add(frame.timestamp);
      lastSampledTime = frame.timestamp;
    }
  }

  // Step 2: Detect and fill gaps
  const result: SampledFrame[] = [];

  for (let i = 0; i < baseSampled.length; i++) {
    result.push(baseSampled[i]);

    // Check for gap to next sample
    if (i < baseSampled.length - 1) {
      const currentTime = baseSampled[i].timestamp;
      const nextTime = baseSampled[i + 1].timestamp;
      const gap = nextTime - currentTime;

      if (gap > cfg.gapThresholdSeconds) {
        // Fill the gap with denser samples
        const gapStart = currentTime + cfg.gapFillIntervalSeconds;
        const gapEnd = nextTime - cfg.gapFillIntervalSeconds;

        for (let t = gapStart; t <= gapEnd; t += cfg.gapFillIntervalSeconds) {
          const nearestFrame = findNearestFrame(sortedFrames, t);
          if (nearestFrame && !sampledTimestamps.has(nearestFrame.timestamp)) {
            result.push({
              imagePath: nearestFrame.imagePath,
              timestamp: nearestFrame.timestamp,
              reason: 'gap_fill',
            });
            sampledTimestamps.add(nearestFrame.timestamp);
          }
        }
      }
    }
  }

  // Sort final result by timestamp
  return result.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Calculate adaptive base interval based on scene change density.
 *
 * When scene changes are dense, they already provide good timeline coverage,
 * so we increase the base interval to avoid excessive frames.
 *
 * Thresholds:
 * - < 20 scenes: 10s base (scenes too sparse, need dense base sampling)
 * - 20-50 scenes: 20s base (moderate coverage from scenes)
 * - > 50 scenes: 30s base (scenes provide excellent coverage)
 *
 * @param sceneCount - Number of detected scene changes
 * @param configBaseInterval - User-configured base interval (used as minimum)
 * @returns Adjusted base interval in seconds
 */
export function calculateAdaptiveBaseInterval(
  sceneCount: number,
  configBaseInterval: number
): number {
  if (sceneCount > 50) return Math.max(configBaseInterval, 30);
  if (sceneCount > 20) return Math.max(configBaseInterval, 20);
  return configBaseInterval;
}

/**
 * Adaptively sample frames with scene change awareness.
 *
 * Strategy:
 * 1. Always include frames nearest to scene change timestamps
 * 2. Between scene changes, sample at base interval
 * 3. Detect gaps larger than threshold and fill with denser sampling
 *
 * @param allFrames - All extracted frames (typically at 2s intervals)
 * @param sceneChanges - Timestamps of detected scene changes from ffmpeg
 * @param config - Sampling configuration
 * @returns Sampled frames with reason annotations
 */
export function adaptiveSampleWithScenes(
  allFrames: InputFrame[],
  sceneChanges: number[],
  config: Partial<SamplingConfig> = {}
): SampledFrame[] {
  const cfg: SamplingConfig = { ...DEFAULT_CONFIG, ...config };

  if (allFrames.length === 0) return [];

  // Adjust base interval based on scene density
  cfg.baseIntervalSeconds = calculateAdaptiveBaseInterval(
    sceneChanges.length,
    cfg.baseIntervalSeconds
  );

  // When scene density is high, also increase gap threshold to prevent
  // gap filling between closely-spaced scene changes
  if (sceneChanges.length > 50) {
    cfg.gapThresholdSeconds = Math.max(cfg.gapThresholdSeconds, 60);
    cfg.gapFillIntervalSeconds = Math.max(cfg.gapFillIntervalSeconds, 10);
  } else if (sceneChanges.length > 20) {
    cfg.gapThresholdSeconds = Math.max(cfg.gapThresholdSeconds, 40);
    cfg.gapFillIntervalSeconds = Math.max(cfg.gapFillIntervalSeconds, 5);
  }

  // Sort frames by timestamp
  const sortedFrames = [...allFrames].sort((a, b) => a.timestamp - b.timestamp);

  // Track which timestamps we've already sampled
  const sampledTimestamps = new Set<number>();
  const result: SampledFrame[] = [];

  // Step 1: Always include frames nearest to scene changes
  for (const changeTime of sceneChanges) {
    const nearest = findNearestFrame(sortedFrames, changeTime);
    if (nearest && !sampledTimestamps.has(nearest.timestamp)) {
      result.push({
        imagePath: nearest.imagePath,
        timestamp: nearest.timestamp,
        reason: 'scene_change',
      });
      sampledTimestamps.add(nearest.timestamp);
    }
  }

  // Sort scene change frames by timestamp
  result.sort((a, b) => a.timestamp - b.timestamp);

  // Step 2: Between scene changes, sample at base interval
  // Create segments between scene changes
  const sceneTimestamps = result.map((f) => f.timestamp);
  const segments: Array<{ start: number; end: number }> = [];

  if (sceneTimestamps.length === 0) {
    // No scene changes - sample entire video
    segments.push({
      start: sortedFrames[0].timestamp,
      end: sortedFrames[sortedFrames.length - 1].timestamp,
    });
  } else {
    // Create segments: before first scene, between scenes, after last scene
    segments.push({
      start: sortedFrames[0].timestamp,
      end: sceneTimestamps[0],
    });

    for (let i = 0; i < sceneTimestamps.length - 1; i++) {
      segments.push({
        start: sceneTimestamps[i],
        end: sceneTimestamps[i + 1],
      });
    }

    segments.push({
      start: sceneTimestamps[sceneTimestamps.length - 1],
      end: sortedFrames[sortedFrames.length - 1].timestamp,
    });
  }

  // Sample each segment at base interval
  for (const segment of segments) {
    let lastSampleTime = segment.start;

    for (const frame of sortedFrames) {
      if (frame.timestamp < segment.start || frame.timestamp > segment.end) {
        continue;
      }

      if (
        frame.timestamp - lastSampleTime >= cfg.baseIntervalSeconds &&
        !sampledTimestamps.has(frame.timestamp)
      ) {
        result.push({
          imagePath: frame.imagePath,
          timestamp: frame.timestamp,
          reason: 'base',
        });
        sampledTimestamps.add(frame.timestamp);
        lastSampleTime = frame.timestamp;
      }
    }
  }

  // Sort before gap filling
  result.sort((a, b) => a.timestamp - b.timestamp);

  // Step 3: Fill large gaps between any samples
  const withGapsFilled: SampledFrame[] = [];

  for (let i = 0; i < result.length; i++) {
    withGapsFilled.push(result[i]);

    if (i < result.length - 1) {
      const currentTime = result[i].timestamp;
      const nextTime = result[i + 1].timestamp;
      const gap = nextTime - currentTime;

      if (gap > cfg.gapThresholdSeconds) {
        // Fill the gap with denser samples
        const gapStart = currentTime + cfg.gapFillIntervalSeconds;
        const gapEnd = nextTime - cfg.gapFillIntervalSeconds;

        for (let t = gapStart; t <= gapEnd; t += cfg.gapFillIntervalSeconds) {
          const nearestFrame = findNearestFrame(sortedFrames, t);
          if (nearestFrame && !sampledTimestamps.has(nearestFrame.timestamp)) {
            withGapsFilled.push({
              imagePath: nearestFrame.imagePath,
              timestamp: nearestFrame.timestamp,
              reason: 'gap_fill',
            });
            sampledTimestamps.add(nearestFrame.timestamp);
          }
        }
      }
    }
  }

  // Sort final result by timestamp
  return withGapsFilled.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Get sampling statistics for logging.
 */
export function getSamplingStats(
  original: InputFrame[],
  sampled: SampledFrame[]
): {
  originalCount: number;
  sampledCount: number;
  reductionPercent: number;
  baseCount: number;
  gapFillCount: number;
  sceneChangeCount: number;
} {
  const baseCount = sampled.filter((f) => f.reason === 'base').length;
  const gapFillCount = sampled.filter((f) => f.reason === 'gap_fill').length;
  const sceneChangeCount = sampled.filter(
    (f) => f.reason === 'scene_change'
  ).length;

  return {
    originalCount: original.length,
    sampledCount: sampled.length,
    reductionPercent: Math.round(
      (1 - sampled.length / (original.length || 1)) * 100
    ),
    baseCount,
    gapFillCount,
    sceneChangeCount,
  };
}

/**
 * Calculate required frame timestamps WITHOUT extracting frames.
 * Used by the smart extraction pipeline to extract only needed frames.
 *
 * This is the inverse of adaptiveSampleWithScenes - instead of selecting
 * from existing frames, we calculate which timestamps we need.
 *
 * @param durationSeconds - Total video duration in seconds
 * @param sceneChanges - Timestamps of detected scene changes
 * @param config - Sampling configuration
 * @returns Sorted array of timestamps that need frames
 *
 * @example
 * // For a 60s video with 3 scene changes at 10s, 25s, 45s
 * // Default config: 10s base interval, 15s gap threshold, 3s gap fill
 * const timestamps = calculateRequiredTimestamps(60, [10, 25, 45]);
 * // Returns: [0, 10, 20, 25, 30, 40, 45, 50, 60] (9 frames)
 * // Instead of extracting 30 frames (every 2s), we only extract 9
 *
 * @example
 * // For a 132min (7920s) video with 50 scene changes
 * // Default config produces ~200-400 frames instead of ~3960
 * const timestamps = calculateRequiredTimestamps(7920, sceneChanges);
 */
export function calculateRequiredTimestamps(
  durationSeconds: number,
  sceneChanges: number[] = [],
  config: Partial<SamplingConfig> = {}
): number[] {
  const cfg: SamplingConfig = { ...DEFAULT_CONFIG, ...config };

  if (durationSeconds <= 0) return [];

  // Adjust for scene density (same logic as adaptiveSampleWithScenes)
  cfg.baseIntervalSeconds = calculateAdaptiveBaseInterval(
    sceneChanges.length,
    cfg.baseIntervalSeconds
  );

  // Adjust gap thresholds for high scene density
  if (sceneChanges.length > 50) {
    cfg.gapThresholdSeconds = Math.max(cfg.gapThresholdSeconds, 60);
    cfg.gapFillIntervalSeconds = Math.max(cfg.gapFillIntervalSeconds, 10);
  } else if (sceneChanges.length > 20) {
    cfg.gapThresholdSeconds = Math.max(cfg.gapThresholdSeconds, 40);
    cfg.gapFillIntervalSeconds = Math.max(cfg.gapFillIntervalSeconds, 5);
  }

  const timestamps = new Set<number>();

  // Step 1: Add scene change timestamps (rounded to nearest second)
  for (const t of sceneChanges) {
    const rounded = Math.round(t);
    if (rounded >= 0 && rounded <= durationSeconds) {
      timestamps.add(rounded);
    }
  }

  // Step 2: Add base interval samples throughout video
  for (let t = 0; t <= durationSeconds; t += cfg.baseIntervalSeconds) {
    timestamps.add(Math.round(t));
  }

  // Step 3: Fill large gaps between samples
  const sorted = [...timestamps].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = sorted[i + 1] - sorted[i];
    if (gap > cfg.gapThresholdSeconds) {
      for (
        let t = sorted[i] + cfg.gapFillIntervalSeconds;
        t < sorted[i + 1];
        t += cfg.gapFillIntervalSeconds
      ) {
        timestamps.add(Math.round(t));
      }
    }
  }

  return [...timestamps].sort((a, b) => a - b);
}
