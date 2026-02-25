/**
 * Escribano - V3 Recording Processor (VLM-First Pipeline)
 *
 * This pipeline replaces the V2 OCR→Embedding→Clustering approach with
 * a VLM-first approach where visual understanding drives segmentation.
 *
 * See ADR-005 for architectural rationale.
 */

import { readdir } from 'node:fs/promises';
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
  calculateRequiredTimestamps,
  getSamplingStats,
  type InputFrame,
} from '../services/frame-sampling.js';
import { describeFrames } from '../services/vlm-service.js';

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
      `[V3] Force flag set, deleting existing data for ${recordingId}...`
    );
    repos.observations.deleteByRecording(recordingId);
    repos.topicBlocks.deleteByRecording(recordingId);
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
        await step(
          'save-audio-observations',
          async () => {
            repos.observations.saveBatch(audioObservations);
            log(
              'info',
              `[V3] Saved ${audioObservations.length} audio observations`
            );
            return { itemsProcessed: audioObservations.length };
          },
          { itemsTotal: audioObservations.length }
        );
      }

      recording = advanceStep(recording, 'transcription');
      updateRecordingInDb(repos, recording);
    } else {
      log('info', '[V3] Skipping audio pipeline (already completed)');
    }

    // ============================================
    // VISUAL PIPELINE (V3: Smart Extraction)
    // ============================================
    if (recording.videoPath) {
      // Step 1: Get video metadata
      const metadata = await adapters.video.getMetadata(recording.videoPath!);
      log(
        'info',
        `[V3] Video: ${Math.round(metadata.duration)}s, ${metadata.width}x${metadata.height}`
      );

      // Step 2: Scene Detection FIRST (no frame extraction needed)
      let sceneChanges: number[] = [];
      const dbRecording = repos.recordings.findById(recording.id);
      const sourceMetadata = dbRecording?.source_metadata
        ? JSON.parse(dbRecording.source_metadata)
        : {};

      if (sourceMetadata.scene_changes) {
        sceneChanges = sourceMetadata.scene_changes;
        log('info', `[V3] Loaded ${sceneChanges.length} scene changes from DB`);
      } else {
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

      // Step 3: Calculate required timestamps (pure math, no I/O)
      log('info', '[V3] Calculating required frame timestamps...');
      const requiredTimestamps = calculateRequiredTimestamps(
        metadata.duration,
        sceneChanges
      );
      log(
        'info',
        `[V3] Need ${requiredTimestamps.length} frames (from ${Math.round(metadata.duration)}s video with ${sceneChanges.length} scenes)`
      );

      // Step 4: Extract ONLY the needed frames
      let extractedFrames: InputFrame[] = [];

      if (!shouldSkipStep(recording.processingStep, 'frame_extraction')) {
        extractedFrames = await step('frame-extraction-batch', async () => {
          const framesDir = path.join(
            os.tmpdir(),
            'escribano',
            recording.id,
            'frames'
          );

          const frames = await adapters.video.extractFramesAtTimestampsBatch(
            recording.videoPath!,
            requiredTimestamps,
            framesDir
          );

          log('info', `[V3] Extracted ${frames.length} frames`);

          recording = advanceStep(recording, 'frame_extraction');
          updateRecordingInDb(repos, recording);

          return frames;
        });
      } else {
        log('info', '[V3] Skipping frame extraction (already completed)');

        // Reload frames from disk if resuming
        const framesDir = path.join(
          os.tmpdir(),
          'escribano',
          recording.id,
          'frames'
        );
        try {
          const files = await readdir(framesDir);
          extractedFrames = files
            .filter((f) => f.endsWith('.jpg'))
            .map((f, i) => ({
              imagePath: path.join(framesDir, f),
              timestamp: requiredTimestamps[i] || i * 10,
            }))
            .sort((a, b) => a.timestamp - b.timestamp);
          log(
            'info',
            `[V3] Reloaded ${extractedFrames.length} frames from disk`
          );
        } catch {
          log('warn', '[V3] Could not reload frames from disk');
        }
      }

      // Step 5: VLM Batch Inference
      if (!shouldSkipStep(recording.processingStep, 'vlm_enrichment')) {
        // Check for already-processed frames (resume safety)
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
        const framesToProcess = extractedFrames.filter(
          (f) => !processedTimestamps.has(f.timestamp)
        );

        if (framesToProcess.length < extractedFrames.length) {
          log(
            'info',
            `[V3] Found ${existingObs.length} already-processed frames, ${framesToProcess.length} remaining`
          );
        }

        const vlmItemsTotal = framesToProcess.length;

        await step(
          'vlm-batch-inference',
          async () => {
            let framesProcessed = 0;

            if (framesToProcess.length === 0) {
              log(
                'info',
                '[V3] All frames already processed, skipping VLM inference'
              );
            } else {
              log(
                'info',
                `[V3] Frames to process (${framesToProcess.length}):`
              );
              framesToProcess.slice(0, 10).forEach((f, i) => {
                log(
                  'info',
                  `  [${i}] ${f.imagePath.split('/').pop()} @ ${f.timestamp}s`
                );
              });
              if (framesToProcess.length > 10) {
                log('info', `  ... and ${framesToProcess.length - 10} more`);
              }

              log('info', '[V3] Starting VLM inference...');
              await describeFrames(framesToProcess, adapters.intelligence, {
                recordingId: recording.id,
                onImageProcessed: (result, progress) => {
                  const observation: DbObservationInsert = {
                    id: generateId(),
                    recording_id: recording.id,
                    type: 'visual' as const,
                    timestamp: result.timestamp,
                    end_timestamp: result.timestamp,
                    image_path: result.imagePath,
                    ocr_text: null,
                    vlm_description: result.description,
                    vlm_raw_response: result.raw_response ?? null,
                    activity_type: result.activity,
                    apps: JSON.stringify(result.apps),
                    topics: JSON.stringify(result.topics),
                    embedding: null,
                    text: null,
                    audio_source: null,
                    audio_type: null,
                  };

                  repos.observations.save(observation);
                  framesProcessed = progress.current;

                  if (progress.current % 10 === 0) {
                    log(
                      'info',
                      `[V3] Processed ${progress.current}/${progress.total} frames`
                    );
                  }
                },
              });

              const allVisualObs = repos.observations
                .findByRecording(recording.id)
                .filter((o) => o.type === 'visual' && o.vlm_description);

              log(
                'info',
                `[V3] VLM complete: ${allVisualObs.length} total visual observations`
              );
            }

            recording = advanceStep(recording, 'vlm_enrichment');
            updateRecordingInDb(repos, recording);

            return { itemsProcessed: framesProcessed || existingObs.length };
          },
          { itemsTotal: vlmItemsTotal || extractedFrames.length }
        );
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

          recording = advanceStep(recording, 'context_creation');
          updateRecordingInDb(repos, recording);

          recording = advanceStep(recording, 'block_formation');
          updateRecordingInDb(repos, recording);

          return { itemsProcessed: blockCount };
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
    if (!audioPath) {
      log('info', `[V3] No ${source} audio path, skipping...`);
      return;
    }

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
    await step(
      `transcription-${source}`,
      async () => {
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
                vlm_raw_response: null,
                activity_type: null,
                apps: null,
                topics: null,
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
        return { itemsProcessed: successCount };
      },
      { itemsTotal: segments.length }
    );

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
