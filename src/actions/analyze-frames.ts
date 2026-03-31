/**
 * Action: Analyze Pending Frames
 *
 * Continuous process (Batch Analyzer) that:
 * 1. Claims a batch of pending frames from the DB
 * 2. Runs VLM analysis (DescribeImages) via IntelligenceService
 * 3. Saves results as Observations linked to frames
 * 4. Marks frames as analyzed
 */

import { randomUUID } from 'node:crypto';
import type { IntelligenceService, Repositories } from '../0_types.js';

export interface AnalyzeFramesOptions {
  batchSize?: number;
  limit?: number;
  onProgress?: (current: number, total: number) => void;
}

/**
 * Run one pass of the frame analyzer
 */
export async function analyzeFrames(
  repositories: Repositories,
  intelligence: IntelligenceService,
  options: AnalyzeFramesOptions = {}
): Promise<{ processed: number; failed: number }> {
  const { batchSize = 10 /* limit = 50*/ } = options;
  const lockId = `analyzer-${randomUUID().slice(0, 8)}`;

  // 1. Cleanup stale locks from previous crashed runs
  const released = repositories.frames.releaseStaleLocks();
  if (released > 0) {
    console.log(`[analyzer] Released ${released} stale frame locks.`);
  }

  // 2. Claim batch
  const frames = repositories.frames.claimFrames(lockId, batchSize);
  if (frames.length === 0) {
    return { processed: 0, failed: 0 };
  }

  console.log(
    `[analyzer] Processing batch of ${frames.length} frames (lock: ${lockId})...`
  );

  // 3. Prepare for VLM
  const vlmImages = frames.map((f, i) => ({
    index: i,
    timestamp: f.timestamp,
    imagePath: f.image_path,
  }));

  let processed = 0;
  let vlmFailed = 0;
  let saveFailed = 0;
  const totalCount = vlmImages.length;

  // 4. Run VLM analysis per frame so a single failure doesn't abort the batch
  for (let i = 0; i < vlmImages.length; i++) {
    const image = vlmImages[i];
    const frame = frames[i];

    let results: Awaited<ReturnType<typeof intelligence.describeImages>>;
    try {
      results = await intelligence.describeImages([image]);
    } catch (err) {
      console.error(
        `[analyzer] VLM inference failed for frame ${i} (timestamp: ${image.timestamp}, path: ${image.imagePath}):`,
        err
      );
      repositories.frames.markFailed(frame.id, String(err));
      vlmFailed++;
      continue;
    }

    // After successful inference, report actual progress
    options.onProgress?.(i + 1, totalCount);

    // 5. Save observation and update frame
    const result = results[0];
    if (!result) {
      console.error(
        `[analyzer] No result returned for frame ${i} (timestamp: ${image.timestamp}, path: ${image.imagePath})`
      );
      repositories.frames.markFailed(frame.id, 'No VLM result returned');
      vlmFailed++;
      continue;
    }

    try {
      // Create observation
      repositories.observations.save({
        id: randomUUID(),
        recording_id: null,
        frame_id: frame.id,
        type: 'visual',
        timestamp: frame.timestamp,
        end_timestamp: null,
        image_path: frame.image_path,
        ocr_text: null,
        vlm_description: result.description,
        vlm_raw_response: result.raw_response ?? null,
        activity_type: result.activity,
        apps: result.apps.join(', '),
        topics: result.topics.join(', '),
        text: null,
        audio_source: null,
        audio_type: null,
        embedding: null,
      });

      // Mark frame as complete
      repositories.frames.markAnalyzed(frame.id);
      processed++;
    } catch (err) {
      console.error(
        `[analyzer] Failed to save observation for frame ${frame.id}:`,
        err
      );
      repositories.frames.markFailed(frame.id, String(err));
      saveFailed++;
    }
  }

  if (vlmFailed > 0) {
    console.warn(
      `[analyzer] ${vlmFailed} of ${totalCount} frames failed VLM inference`
    );
  }
  if (saveFailed > 0) {
    console.warn(
      `[analyzer] ${saveFailed} of ${totalCount} frames failed DB save`
    );
  }

  if (vlmFailed + saveFailed === totalCount && totalCount > 0) {
    throw new Error(
      `[analyzer] All ${totalCount} frames failed VLM inference — aborting batch`
    );
  }

  return { processed, failed: vlmFailed + saveFailed };
}
