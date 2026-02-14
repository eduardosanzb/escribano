/**
 * Escribano - V3 Recording Processor (VLM-First Pipeline)
 *
 * This pipeline replaces the V2 OCR→Embedding→Clustering approach with
 * a VLM-first approach where visual understanding drives segmentation.
 *
 * See ADR-005 for architectural rationale.
 */

import os from 'node:os';
import path from 'node:path';
import type {
  DbObservationInsert,
  IntelligenceService,
  Repositories,
  TranscriptionService,
  VideoService,
} from '../0_types.js';
import type { AudioPreprocessor } from '../adapters/audio.silero.adapter.js';
import { generateId } from '../db/helpers.js';
import {
  advanceStep,
  completeProcessing,
  failProcessing,
  type ProcessingStep,
  type Recording,
  startProcessing,
} from '../domain/recording.js';
import { log, step } from '../pipeline/context.js';
import {
  adaptiveSample,
  adaptiveSampleWithScenes,
  calculateAdaptiveBaseInterval,
  getSamplingStats,
  type InputFrame,
} from '../services/frame-sampling.js';
import { batchDescribeFrames } from '../services/vlm-batch.js';

export interface ProcessRecordingV3Options {
  /** Force reprocessing even if already processed */
  force?: boolean;
}

// V3 step order - simplified from V2
const STEP_ORDER_V3: ProcessingStep[] = [
  'vad',
  'transcription',
  'frame_extraction',
  'vlm_enrichment', // Repurposed: now does batch VLM on all sampled frames
  'context_creation',
  'block_formation',
  'complete',
];

function shouldSkipStep(
  currentStep: ProcessingStep | null,
  targetStep: ProcessingStep
): boolean {
  if (!currentStep) return false;
  if (currentStep === 'complete') return true;

  const currentIndex = STEP_ORDER_V3.indexOf(currentStep);
  const targetIndex = STEP_ORDER_V3.indexOf(targetStep);

  return targetIndex < currentIndex;
}

/**
 * Process a recording using the V3 VLM-First pipeline.
 *
 * Key differences from V2:
 * - No OCR processing step
 * - No embedding generation step
 * - No semantic clustering step
 * - VLM processes all sampled frames (not just sparse selection)
 * - Activity-based segmentation (not embedding similarity)
 */
export async function processRecordingV3(
  recordingId: string,
  repos: Repositories,
  adapters: {
    preprocessor: AudioPreprocessor;
    transcription: TranscriptionService;
    video: VideoService;
    intelligence: IntelligenceService;
  },
  options: ProcessRecordingV3Options = {}
): Promise<void> {
  const dbRecording = repos.recordings.findById(recordingId);
  if (!dbRecording) {
    throw new Error(`Recording ${recordingId} not found`);
  }

  // Handle --force: delete existing observations and reset
  if (options.force) {
    log(
      'info',
      `[V3] Force flag set, deleting existing observations for ${recordingId}...`
    );
    repos.observations.deleteByRecording(recordingId);
  }

  // Map DB to Domain
  let recording: Recording = {
    id: dbRecording.id,
    status: dbRecording.status as any,
    processingStep: dbRecording.processing_step as any,
    errorMessage: dbRecording.error_message,
    videoPath: dbRecording.video_path,
    audioMicPath: dbRecording.audio_mic_path,
    audioSystemPath: dbRecording.audio_system_path,
    capturedAt: dbRecording.captured_at,
    duration: dbRecording.duration,
  };

  // If forced, reset to raw state
  if (options.force) {
    recording = {
      ...recording,
      status: 'raw',
      processingStep: null,
      errorMessage: null,
    };
    updateRecordingInDb(repos, recording);
  }

  if (recording.processingStep) {
    log(
      'info',
      `[V3] Resuming ${recording.id} from step: ${recording.processingStep}`
    );
  }

  try {
    // Start processing
    if (!shouldSkipStep(recording.processingStep, 'vad')) {
      recording = startProcessing(recording);
      updateRecordingInDb(repos, recording);
    }

    // ============================================
    // AUDIO PIPELINE (reused from V2)
    // ============================================
    if (!shouldSkipStep(recording.processingStep, 'transcription')) {
      log('info', '[V3] Running audio pipeline...');
      const audioObservations = await processAudioPipeline(recording, adapters);

      if (audioObservations.length > 0) {
        await step('save-audio-observations', async () => {
          repos.observations.saveBatch(audioObservations);
          log(
            'info',
            `[V3] Saved ${audioObservations.length} audio observations`
          );
        });
      }

      recording = advanceStep(recording, 'transcription');
      updateRecordingInDb(repos, recording);
    } else {
      log('info', '[V3] Skipping audio pipeline (already completed)');
    }

    // ============================================
    // VISUAL PIPELINE (V3: VLM-First)
    // ============================================
    if (recording.videoPath) {
      // Step: Frame Extraction
      let extractedFrames: InputFrame[] = [];

      if (!shouldSkipStep(recording.processingStep, 'frame_extraction')) {
        extractedFrames = await step('frame-extraction-v3', async () => {
          const framesDir = path.join(
            os.tmpdir(),
            'escribano',
            recording.id,
            'frames'
          );

          // Extract frames at 2-second intervals (as before)
          const frames = await adapters.video.extractFramesAtInterval(
            recording.videoPath!,
            0.3,
            framesDir
          );

          log('info', `[V3] Extracted ${frames.length} frames`);

          // Only advance step after successful extraction
          recording = advanceStep(recording, 'frame_extraction');
          updateRecordingInDb(repos, recording);

          return frames;
        });
      } else {
        log('info', '[V3] Skipping frame extraction (already completed)');

        // TODO: i dont think we need this next lines of codea; the one i commented

        // // Reload frame list from disk if possible, but for Sprint 1 we focus on the flow
        // const framesDir = path.join(
        //   os.tmpdir(),
        //   'escribano',
        //   recording.id,
        //   'frames'
        // );
        // extractedFrames = await adapters.video.extractFramesAtInterval(
        //   recording.videoPath!,
        //   0.3,
        //   framesDir
        // );
      }

      // Step: Scene Detection (for smarter sampling)
      let sceneChanges: number[] = [];
      const dbRecording = repos.recordings.findById(recording.id);
      const sourceMetadata = dbRecording?.source_metadata
        ? JSON.parse(dbRecording.source_metadata)
        : {};

      if (sourceMetadata.scene_changes) {
        // Load from DB for resume
        sceneChanges = sourceMetadata.scene_changes;
        log('info', `[V3] Loaded ${sceneChanges.length} scene changes from DB`);
      } else if (
        !shouldSkipStep(recording.processingStep, 'frame_extraction')
      ) {
        // Run scene detection only once (during initial processing)
        sceneChanges = await step('scene-detection', async () => {
          const changes = await adapters.video.detectSceneChanges(
            recording.videoPath!
          );
          log('info', `[V3] Detected ${changes.length} scene changes`);

          // Save to DB for resume safety
          if (dbRecording) {
            const updatedMetadata = {
              ...sourceMetadata,
              scene_changes: changes,
            };
            repos.recordings.updateMetadata(
              recording.id,
              JSON.stringify(updatedMetadata)
            );
          }

          return changes;
        });
      }

      // Step: VLM Batch Inference (replaces OCR + Embedding + Clustering)
      if (!shouldSkipStep(recording.processingStep, 'vlm_enrichment')) {
        await step('vlm-batch-inference', async () => {
          // Adaptive sampling with scene awareness
          log('info', '[V3] Applying adaptive sampling...');
          const sampledFrames =
            sceneChanges.length > 0
              ? adaptiveSampleWithScenes(extractedFrames, sceneChanges)
              : adaptiveSample(extractedFrames);
          const stats = getSamplingStats(extractedFrames, sampledFrames);

          // Log adaptive interval for visibility
          if (sceneChanges.length > 0) {
            const adaptiveInterval = calculateAdaptiveBaseInterval(
              sceneChanges.length,
              Number(process.env.ESCRIBANO_SAMPLE_INTERVAL) || 10
            );
            log(
              'info',
              `[V3] Adaptive base interval: ${adaptiveInterval}s (${sceneChanges.length} scenes detected)`
            );
          }

          log(
            'info',
            `[V3] Sampled ${stats.sampledCount} frames (${stats.reductionPercent}% reduction): ` +
              `${stats.baseCount} base + ${stats.gapFillCount} gap fill + ${stats.sceneChangeCount} scene`
          );

          // Check for already-processed frames (crash-safe resumption)
          // IMPORTANT: Exclude fallback descriptions ("No description", "Parse error")
          const existingObs = repos.observations
            .findByRecording(recording.id)
            .filter((o) => o.type === 'visual' && o.vlm_description)
            .filter(
              (o) =>
                !o.vlm_description?.startsWith('No description') &&
                !o.vlm_description?.startsWith('Parse error')
            );

          const processedTimestamps = new Set(
            existingObs.map((o) => o.timestamp)
          );
          const framesToProcess = sampledFrames.filter(
            (f) => !processedTimestamps.has(f.timestamp)
          );

          if (framesToProcess.length < sampledFrames.length) {
            log(
              'info',
              `[V3] Found ${existingObs.length} already-processed frames, ${framesToProcess.length} remaining`
            );
          }

          if (framesToProcess.length === 0) {
            log(
              'info',
              '[V3] All frames already processed, skipping VLM inference'
            );
          } else {
            // VLM batch inference with eager saving per batch
            log('info', '[V3] Starting VLM batch inference...');
            await batchDescribeFrames(framesToProcess, adapters.intelligence, {
              recordingId: recording.id,
              onBatchComplete: (batchResults, batchIndex) => {
                // Eager save: persist each batch immediately
                const observations: DbObservationInsert[] = batchResults.map(
                  (desc) => ({
                    id: generateId(),
                    recording_id: recording.id,
                    type: 'visual' as const,
                    timestamp: desc.timestamp,
                    end_timestamp: desc.timestamp,
                    image_path: sampledFrames[desc.index]?.imagePath || '',
                    ocr_text: null,
                    vlm_description: desc.description,
                    embedding: null,
                    text: null,
                    audio_source: null,
                    audio_type: null,
                  })
                );

                repos.observations.saveBatch(observations);
                log(
                  'info',
                  `[V3] Batch ${batchIndex}: Eagerly saved ${observations.length} observations`
                );
              },
            });

            // Log final stats
            const allVisualObs = repos.observations
              .findByRecording(recording.id)
              .filter((o) => o.type === 'visual' && o.vlm_description);

            log(
              'info',
              `[V3] VLM complete: ${allVisualObs.length} total visual observations`
            );
          }

          // Only advance step after all VLM processing is complete
          recording = advanceStep(recording, 'vlm_enrichment');
          updateRecordingInDb(repos, recording);
        });
      } else {
        log('info', '[V3] Skipping VLM inference (already completed)');
      }

      // Phase 2 - Activity Segmentation & TopicBlock Formation
      if (!shouldSkipStep(recording.processingStep, 'block_formation')) {
        await step('activity-segmentation-and-alignment', async () => {
          // Get all observations for this recording
          const allObservations = repos.observations.findByRecording(
            recording.id
          );
          const visualObservations = allObservations.filter(
            (o) => o.type === 'visual'
          );
          const audioObservations = allObservations.filter(
            (o) => o.type === 'audio'
          );

          log(
            'info',
            `[V3] Running activity segmentation on ${visualObservations.length} visual observations...`
          );

          // Import and run segmentation
          const { segmentByActivity, getSegmentStats } = await import(
            '../services/activity-segmentation.js'
          );
          const segments = segmentByActivity(visualObservations);
          const stats = getSegmentStats(segments);
          log(
            'info',
            `[V3] Created ${stats.totalSegments} segments: ${Object.entries(
              stats.activityTypeCounts
            )
              .map(([k, v]) => `${k}=${v}`)
              .join(', ')}`
          );

          // Import and run temporal alignment
          const { alignAudioToSegments, getAlignmentStats } = await import(
            '../services/temporal-alignment.js'
          );
          log(
            'info',
            `[V3] Aligning ${audioObservations.length} audio transcripts to segments...`
          );
          const enrichedSegments = alignAudioToSegments(
            segments,
            audioObservations
          );
          const alignStats = getAlignmentStats(enrichedSegments);
          log(
            'info',
            `[V3] Aligned audio: ${alignStats.segmentsWithAudio}/${alignStats.totalSegments} segments have transcripts (${alignStats.totalTranscriptSegments} total transcript segments)`
          );

          log(
            'info',
            `[V3] Creating ${enrichedSegments.length} TopicBlocks...`
          );
          let blockCount = 0;
          for (const segment of enrichedSegments) {
            // Create context from segment apps/topics
            const contextIds: string[] = [];

            // Simplified context creation using INSERT OR IGNORE
            for (const app of segment.apps) {
              const ctxId = generateId();
              repos.contexts.saveOrIgnore({
                id: ctxId,
                type: 'app',
                name: app,
                metadata: JSON.stringify({ source: 'vlm-v3' }),
              });
              // Fetch the context to get its ID (existing or newly created)
              const existingCtx = repos.contexts.findByTypeAndName('app', app);
              if (existingCtx) {
                contextIds.push(existingCtx.id);
              }
            }

            for (const topic of segment.topics) {
              const ctxId = generateId();
              repos.contexts.saveOrIgnore({
                id: ctxId,
                type: 'topic',
                name: topic,
                metadata: JSON.stringify({ source: 'vlm-v3' }),
              });
              // Fetch the context to get its ID (existing or newly created)
              const existingCtx = repos.contexts.findByTypeAndName(
                'topic',
                topic
              );
              if (existingCtx) {
                contextIds.push(existingCtx.id);
              }
            }

            // Create the TopicBlock with enriched classification
            repos.topicBlocks.save({
              id: generateId(),
              recording_id: recording.id,
              context_ids: JSON.stringify(contextIds),
              classification: JSON.stringify({
                activity_type: segment.activityType,
                key_description: segment.keyDescription,
                start_time: segment.startTime,
                end_time: segment.endTime,
                duration: segment.duration,
                apps: segment.apps,
                topics: segment.topics,
                transcript_count: segment.transcripts.length,
                has_transcript: segment.combinedTranscript.length > 0,
                combined_transcript: segment.combinedTranscript,
              }),
              duration: segment.duration,
            });
            blockCount++;
          }

          log('info', `[V3] Created ${blockCount} TopicBlocks`);

          // Only advance steps after all processing is complete
          recording = advanceStep(recording, 'context_creation');
          updateRecordingInDb(repos, recording);

          recording = advanceStep(recording, 'block_formation');
          updateRecordingInDb(repos, recording);
        });
      } else {
        log(
          'info',
          '[V3] Skipping segmentation and block formation (already completed)'
        );
      }
    }

    // Complete
    recording = completeProcessing(recording);
    updateRecordingInDb(repos, recording);
    log('info', `[V3] Successfully processed recording ${recording.id}`);
  } catch (error) {
    const message = (error as Error).message;
    log('error', `[V3] Processing failed for ${recordingId}: ${message}`);
    recording = failProcessing(recording, message);
    updateRecordingInDb(repos, recording);
    throw error;
  }
}

/**
 * Process audio sources (reused from V2 with minor modifications)
 */
async function processAudioPipeline(
  recording: Recording,
  adapters: {
    preprocessor: AudioPreprocessor;
    transcription: TranscriptionService;
  }
): Promise<DbObservationInsert[]> {
  const observations: DbObservationInsert[] = [];

  const processSource = async (
    audioPath: string | null,
    source: 'mic' | 'system'
  ) => {
    if (!audioPath) return;

    log('info', `[V3] Processing ${source} audio: ${audioPath}`);

    // VAD
    const { segments, tempDir } = await step(`vad-${source}`, async () => {
      return await adapters.preprocessor.extractSpeechSegments(
        audioPath,
        recording.id
      );
    });

    if (segments.length === 0) {
      log('info', `[V3] No speech segments found in ${source} audio`);
      await adapters.preprocessor.cleanup(tempDir);
      return;
    }

    log('info', `[V3] Found ${segments.length} segments in ${source} audio`);

    // Transcription
    await step(`transcription-${source}`, async () => {
      let successCount = 0;
      for (const segment of segments) {
        try {
          const text = await adapters.transcription.transcribeSegment(
            segment.audioPath
          );

          if (text.length > 0) {
            successCount++;
            observations.push({
              id: generateId(),
              recording_id: recording.id,
              type: 'audio',
              timestamp: segment.start,
              end_timestamp: segment.end,
              text,
              audio_source: source,
              audio_type: 'speech',
              image_path: null,
              ocr_text: null,
              vlm_description: null,
              embedding: null,
            });
          }
        } catch (error) {
          log(
            'warn',
            `[V3] Failed to transcribe segment at ${segment.start}s: ${(error as Error).message}`
          );
        }
      }
      log(
        'info',
        `[V3] Transcribed ${successCount}/${segments.length} segments for ${source}`
      );
    });

    // Cleanup
    await step(`cleanup-${source}`, async () => {
      await adapters.preprocessor.cleanup(tempDir);
    });
  };

  // Process sequentially
  await processSource(recording.audioMicPath, 'mic');
  await processSource(recording.audioSystemPath, 'system');

  return observations;
}

function updateRecordingInDb(repos: Repositories, recording: Recording) {
  repos.recordings.updateStatus(
    recording.id,
    recording.status as any,
    recording.processingStep as any,
    recording.errorMessage
  );
}
