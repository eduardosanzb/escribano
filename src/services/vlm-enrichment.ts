/**
 * Escribano - VLM Enrichment Service
 * @deprecated V2 pipeline - uses old clustering approach. Use V3 pipeline instead.
 *
 * Selects representative frames from clusters and describes them with a vision model.
 */

import type { DbObservation, IntelligenceService } from '../0_types.js';

export interface VLMConfig {
  /** Maximum frames to describe per cluster */
  maxFramesPerCluster: number;
  /** Minimum OCR length to consider "sufficient" (skip VLM if enough OCR) */
  minOcrLength: number;
  /** Vision model to use */
  visionModel: string;
}

const DEFAULT_CONFIG: VLMConfig = {
  maxFramesPerCluster: 5,
  minOcrLength: 100,
  visionModel: 'qwen3-vl-8b',
};

export interface FrameSelection {
  observation: DbObservation;
  reason: 'boundary' | 'low_ocr' | 'interval';
}

/**
 * Select representative frames for VLM description.
 *
 * Strategy:
 * 1. Always include first and last frame (boundaries)
 * 2. Include frames with low OCR quality (< minOcrLength chars)
 * 3. Sample at regular intervals based on cluster duration
 * 4. Cap at maxFramesPerCluster
 */
export function selectFramesForVLM(
  observations: DbObservation[],
  config: Partial<VLMConfig> = {}
): FrameSelection[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (observations.length === 0) return [];

  const visualObs = observations
    .filter((o) => o.type === 'visual' && o.image_path)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (visualObs.length === 0) return [];

  const selected: FrameSelection[] = [];
  const selectedIds = new Set<string>();

  const addFrame = (obs: DbObservation, reason: FrameSelection['reason']) => {
    if (!selectedIds.has(obs.id)) {
      selectedIds.add(obs.id);
      selected.push({ observation: obs, reason });
    }
  };

  // 1. Boundaries
  addFrame(visualObs[0], 'boundary');
  if (visualObs.length > 1) {
    addFrame(visualObs[visualObs.length - 1], 'boundary');
  }

  // 2. Low OCR quality frames
  const lowOcrFrames = visualObs.filter(
    (o) =>
      (o.ocr_text?.length ?? 0) < cfg.minOcrLength && !selectedIds.has(o.id)
  );
  for (const frame of lowOcrFrames.slice(0, 3)) {
    addFrame(frame, 'low_ocr');
  }

  // 3. Interval sampling (if still below max)
  if (selected.length < cfg.maxFramesPerCluster && visualObs.length > 2) {
    const duration =
      visualObs[visualObs.length - 1].timestamp - visualObs[0].timestamp;
    const intervalSeconds =
      duration / (cfg.maxFramesPerCluster - selected.length + 1);

    let nextTarget = visualObs[0].timestamp + intervalSeconds;
    for (const obs of visualObs) {
      if (selected.length >= cfg.maxFramesPerCluster) break;
      if (obs.timestamp >= nextTarget && !selectedIds.has(obs.id)) {
        addFrame(obs, 'interval');
        nextTarget += intervalSeconds;
      }
    }
  }

  return selected.slice(0, cfg.maxFramesPerCluster);
}

/**
 * Describe selected frames using VLM.
 */
export async function describeFrames(
  frames: FrameSelection[],
  intelligence: IntelligenceService
): Promise<Map<string, string>> {
  const results = new Map<string, string>();

  if (frames.length === 0) return results;

  const images = frames.map((f) => ({
    imagePath: f.observation.image_path!,
    clusterId: 0, // Not used in our case
    timestamp: f.observation.timestamp,
  }));

  const descriptions = await intelligence.describeImages(images);

  for (const [index, frame] of frames.entries()) {
    const desc = descriptions[index];
    if (desc?.description) {
      results.set(frame.observation.id, desc.description);
    }
  }

  return results;
}
