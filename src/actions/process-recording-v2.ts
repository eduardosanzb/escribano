import os from 'node:os';
import path from 'node:path';
import type {
  DbObservationInsert,
  EmbeddingService,
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
import { findClusterMerges } from '../services/cluster-merge.js';
import { clusterObservations } from '../services/clustering.js';
import { extractSignals } from '../services/signal-extraction.js';
import {
  describeFrames,
  selectFramesForVLM,
} from '../services/vlm-enrichment.js';
import { bufferToEmbedding, chunkArray, parallelMap } from '../utils/index.js';
import { cleanOcrText } from '../utils/ocr.js';
import { createContextsFromSignals } from './create-contexts.js';
import { createTopicBlockFromCluster } from './create-topic-blocks.js';

export interface ProcessRecordingV2Options {
  parallel?: boolean;
  force?: boolean;
}

const STEP_ORDER: ProcessingStep[] = [
  'vad',
  'transcription',
  'frame_extraction',
  'ocr_processing',
  'embedding',
  'clustering',
  'vlm_enrichment',
  'signal_extraction',
  'cluster_merge',
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

  const currentIndex = STEP_ORDER.indexOf(currentStep);
  const targetIndex = STEP_ORDER.indexOf(targetStep);

  // Skip if we're past this step
  return targetIndex < currentIndex;
}

export async function processRecordingV2(
  recordingId: string,
  repos: Repositories,
  adapters: {
    preprocessor: AudioPreprocessor;
    transcription: TranscriptionService;
    video: VideoService;
    intelligence: IntelligenceService;
    embedding: EmbeddingService;
  },
  options: ProcessRecordingV2Options = {}
): Promise<void> {
  const dbRecording = repos.recordings.findById(recordingId);
  if (!dbRecording) {
    throw new Error(`Recording ${recordingId} not found`);
  }

  // Handle --force: delete existing observations and reset
  if (options.force) {
    log(
      'info',
      `Force flag set, deleting existing observations for ${recordingId}...`
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
      `Resuming ${recording.id} from step: ${recording.processingStep}`
    );
  }

  try {
    // 1. Start processing (unless already processing/processed)
    if (!shouldSkipStep(recording.processingStep, 'vad')) {
      recording = startProcessing(recording);
      updateRecordingInDb(repos, recording);
    }

    // ============================================
    // AUDIO PIPELINE
    // ============================================

    if (!shouldSkipStep(recording.processingStep, 'transcription')) {
      log('info', 'Running audio pipeline...');
      const audioObservations = await processAudioPipeline(
        recording,
        adapters,
        options
      );

      // Save audio observations immediately
      if (audioObservations.length > 0) {
        await step('save-audio-observations', async () => {
          repos.observations.saveBatch(audioObservations);
          log('info', `Saved ${audioObservations.length} audio observations`);
        });
      }

      recording = advanceStep(recording, 'transcription');
      updateRecordingInDb(repos, recording);
    } else {
      log('info', 'Skipping audio pipeline (already completed)');
    }

    // ============================================
    // VISUAL PIPELINE
    // ============================================

    if (recording.videoPath) {
      // Step: Frame Extraction
      if (!shouldSkipStep(recording.processingStep, 'frame_extraction')) {
        await step('frame-extraction', async () => {
          recording = advanceStep(recording, 'frame_extraction');
          updateRecordingInDb(repos, recording);

          const intervalSeconds =
            Number(process.env.ESCRIBANO_FRAME_INTERVAL) || 2;
          const framesDir = path.join(
            os.tmpdir(),
            'escribano',
            recording.id,
            'frames'
          );

          const extractedFrames = await adapters.video.extractFramesAtInterval(
            recording.videoPath!,
            0.3, // threshold
            framesDir
          );

          log(
            'info',
            `Extracted ${extractedFrames.length} frames (interval: ${intervalSeconds}s)`
          );
        });
      } else {
        log('info', 'Skipping frame extraction (already completed)');
      }

      // Step: OCR Processing
      if (!shouldSkipStep(recording.processingStep, 'ocr_processing')) {
        await step('ocr-processing', async () => {
          recording = advanceStep(recording, 'ocr_processing');
          updateRecordingInDb(repos, recording);

          const framesDir = path.join(
            os.tmpdir(),
            'escribano',
            recording.id,
            'frames'
          );
          const outputPath = path.join(
            os.tmpdir(),
            'escribano',
            recording.id,
            'visual-index.json'
          );

          const visualIndex = await adapters.video.runVisualIndexing(
            framesDir,
            outputPath
          );

          log('info', `OCR processed ${visualIndex.frames.length} frames`);

          // Build observations with cleaned OCR
          const observations: DbObservationInsert[] = [];
          for (const frame of visualIndex.frames) {
            const cleanedOcr = cleanOcrText(frame.ocrText);

            observations.push({
              id: generateId(),
              recording_id: recording.id,
              type: 'visual',
              timestamp: frame.timestamp,
              end_timestamp: frame.timestamp,
              image_path: frame.imagePath,
              ocr_text: cleanedOcr,
              vlm_description: null, // Phase 3D.5 TODO
              embedding: null, // Updated in next step
              text: null,
              audio_source: null,
              audio_type: null,
            });
          }

          // Save visual observations (without embeddings yet)
          if (observations.length > 0) {
            repos.observations.saveBatch(observations);
            log(
              'info',
              `Saved ${observations.length} visual observations (OCR only)`
            );
          }
        });
      } else {
        log('info', 'Skipping OCR processing (already completed)');
      }

      // Step: Generate Embeddings (for BOTH visual and audio)
      // Uses parallel batching with immediate persistence for crash-safety
      if (!shouldSkipStep(recording.processingStep, 'embedding')) {
        await step('generate-embeddings', async () => {
          recording = advanceStep(recording, 'embedding');
          updateRecordingInDb(repos, recording);

          // Get ALL observations that need embeddings
          const allObs = repos.observations.findByRecording(recording.id);
          const obsNeedingEmbedding = allObs.filter((o) => !o.embedding);

          if (obsNeedingEmbedding.length === 0) {
            log('info', 'All observations already have embeddings');
            return;
          }

          // Configuration from environment
          const BATCH_SIZE =
            Number(process.env.ESCRIBANO_EMBED_BATCH_SIZE) || 64;
          const CONCURRENCY =
            Number(process.env.ESCRIBANO_EMBED_CONCURRENCY) || 4;

          // Chunk observations into batches
          const chunks = chunkArray(obsNeedingEmbedding, BATCH_SIZE);
          let completedCount = 0;
          let successCount = 0;

          log(
            'info',
            `Generating embeddings for ${obsNeedingEmbedding.length} observations ` +
              `(${chunks.length} batches, ${CONCURRENCY} concurrent)...`
          );

          // Process chunks in parallel with immediate saves
          await parallelMap(
            chunks,
            async (chunk, chunkIndex) => {
              const batchStart = Date.now();
              log(
                'info',
                `[Worker] Batch ${chunkIndex + 1}/${chunks.length} started (${chunk.length} items)...`
              );

              // Extract text content based on observation type
              const textsToEmbed = chunk.map((o) => {
                if (o.type === 'visual') {
                  return o.ocr_text || '';
                }
                return o.text || ''; // Audio transcript
              });

              // Call embedding service for this batch
              const embeddings = await adapters.embedding.embedBatch(
                textsToEmbed,
                'clustering'
              );

              // IMMEDIATE SAVE - crash-safe persistence
              let batchSuccess = 0;
              const dbStart = Date.now();
              for (let i = 0; i < chunk.length; i++) {
                const embedding = embeddings[i];
                if (embedding && embedding.length > 0) {
                  repos.observations.updateEmbedding(chunk[i].id, embedding);
                  batchSuccess++;
                }
              }

              const batchDuration = (Date.now() - batchStart) / 1000;
              const dbDuration = (Date.now() - dbStart) / 1000;

              completedCount += chunk.length;
              successCount += batchSuccess;

              log(
                'info',
                `[Worker] Batch ${chunkIndex + 1}/${chunks.length} saved in ${batchDuration.toFixed(1)}s (DB: ${dbDuration.toFixed(2)}s) - ` +
                  `Total: ${completedCount}/${obsNeedingEmbedding.length}`
              );
            },
            CONCURRENCY
          );

          log(
            'info',
            `Completed: ${successCount}/${obsNeedingEmbedding.length} embeddings saved`
          );
        });
      } else {
        log('info', 'Skipping embedding generation (already completed)');
      }

      // ============================================================================
      // CLUSTERING PIPELINE
      // ============================================================================

      // Step: Semantic Clustering
      if (!shouldSkipStep(recording.processingStep, 'clustering')) {
        await step('clustering', async () => {
          recording = advanceStep(recording, 'clustering');
          updateRecordingInDb(repos, recording);

          // Delete existing clusters for this recording
          repos.clusters.deleteByRecording(recording.id);

          // Cluster visual observations
          const visualObs = repos.observations.findByRecordingAndType(
            recording.id,
            'visual'
          );
          const visualClusters = clusterObservations(
            visualObs,
            adapters.embedding,
            {
              timeWindowSeconds:
                Number(process.env.ESCRIBANO_CLUSTER_TIME_WINDOW) || 600,
              distanceThreshold:
                Number(process.env.ESCRIBANO_CLUSTER_DISTANCE_THRESHOLD) || 0.4,
            }
          );

          log('info', `Created ${visualClusters.length} visual clusters`);

          // Cluster audio observations
          const audioObs = repos.observations.findByRecordingAndType(
            recording.id,
            'audio'
          );
          const audioClusters = clusterObservations(
            audioObs,
            adapters.embedding,
            {
              timeWindowSeconds: 3600, // Audio can span longer
              distanceThreshold: 0.5,
            }
          );

          log('info', `Created ${audioClusters.length} audio clusters`);

          // Save clusters to database
          for (const cluster of [...visualClusters, ...audioClusters]) {
            const isVisual = visualClusters.includes(cluster);
            const clusterId = generateId();

            repos.clusters.save({
              id: clusterId,
              recording_id: recording.id,
              type: isVisual ? 'visual' : 'audio',
              start_timestamp: cluster.startTimestamp,
              end_timestamp: cluster.endTimestamp,
              observation_count: cluster.observations.length,
              centroid: Buffer.from(new Float32Array(cluster.centroid).buffer),
              classification: null, // Filled in signal extraction
              metadata: null,
            });

            // Link observations
            const links = cluster.observations.map((obs) => ({
              observationId: obs.id,
              clusterId,
              distance: 0, // TODO: compute actual distance
            }));
            repos.clusters.linkObservationsBatch(links);
          }
        });
      }

      // Step: VLM Enrichment
      if (!shouldSkipStep(recording.processingStep, 'vlm_enrichment')) {
        await step('vlm-enrichment', async () => {
          recording = advanceStep(recording, 'vlm_enrichment');
          updateRecordingInDb(repos, recording);

          const clusters = repos.clusters.findByRecordingAndType(
            recording.id,
            'visual'
          );
          let totalDescribed = 0;

          for (const cluster of clusters) {
            const observations = repos.clusters.getObservations(cluster.id);
            const frames = selectFramesForVLM(observations);

            if (frames.length > 0) {
              const descriptions = await describeFrames(
                frames,
                adapters.intelligence
              );

              // Update observations with VLM descriptions
              for (const [obsId, description] of descriptions) {
                repos.observations.updateVLMDescription(obsId, description);
                totalDescribed++;
              }
            }
          }

          log(
            'info',
            `VLM described ${totalDescribed} frames across ${clusters.length} clusters`
          );
        });
      }

      // Step: Signal Extraction
      if (!shouldSkipStep(recording.processingStep, 'signal_extraction')) {
        await step('signal-extraction', async () => {
          recording = advanceStep(recording, 'signal_extraction');
          updateRecordingInDb(repos, recording);

          const allClusters = repos.clusters.findByRecording(recording.id);

          for (const cluster of allClusters) {
            const observations = repos.clusters.getObservations(cluster.id);
            const signals = await extractSignals(
              observations,
              adapters.intelligence
            );

            repos.clusters.updateClassification(
              cluster.id,
              JSON.stringify(signals)
            );
          }

          log('info', `Extracted signals for ${allClusters.length} clusters`);
        });
      }

      // Step: Cluster Merge (Audio → Visual)
      if (!shouldSkipStep(recording.processingStep, 'cluster_merge')) {
        await step('cluster-merge', async () => {
          recording = advanceStep(recording, 'cluster_merge');
          updateRecordingInDb(repos, recording);

          const visualClusters = repos.clusters.findByRecordingAndType(
            recording.id,
            'visual'
          );
          const audioClusters = repos.clusters.findByRecordingAndType(
            recording.id,
            'audio'
          );

          if (audioClusters.length > 0 && visualClusters.length > 0) {
            // Build cluster-with-signals for merging
            const visualWithSignals = visualClusters.map((c) => ({
              cluster: c,
              signals: JSON.parse(c.classification || '{}'),
              centroid: bufferToEmbedding(c.centroid!),
            }));

            const audioWithSignals = audioClusters.map((c) => ({
              cluster: c,
              signals: JSON.parse(c.classification || '{}'),
              centroid: bufferToEmbedding(c.centroid!),
            }));

            const merges = findClusterMerges(
              visualWithSignals,
              audioWithSignals,
              adapters.embedding
            );

            for (const merge of merges) {
              repos.clusters.saveMerge(
                merge.visualClusterId,
                merge.audioClusterId,
                merge.similarityScore,
                merge.mergeReason
              );
            }

            log('info', `Created ${merges.length} audio-visual cluster merges`);
          } else {
            log('info', 'No audio clusters to merge');
          }
        });
      }

      // Step: Context Creation
      if (!shouldSkipStep(recording.processingStep, 'context_creation')) {
        await step('context-creation', async () => {
          recording = advanceStep(recording, 'context_creation');
          updateRecordingInDb(repos, recording);

          const clusters = repos.clusters.findByRecording(recording.id);
          let totalContexts = 0;

          for (const cluster of clusters) {
            const observations = repos.clusters.getObservations(cluster.id);
            const signals = JSON.parse(cluster.classification || '{}');

            const result = createContextsFromSignals(
              signals,
              observations,
              repos.contexts
            );
            totalContexts += result.contextIds.length;

            // Link observations to contexts
            for (const link of result.observationLinks) {
              repos.contexts.linkObservation(
                link.observationId,
                link.contextId
              );
            }
          }

          log('info', `Created/linked ${totalContexts} contexts`);
        });
      }

      // Step: TopicBlock Formation
      if (!shouldSkipStep(recording.processingStep, 'block_formation')) {
        await step('block-formation', async () => {
          recording = advanceStep(recording, 'block_formation');
          updateRecordingInDb(repos, recording);

          // Delete existing topic blocks
          repos.topicBlocks.deleteByRecording(recording.id);

          // Pre-load all context links for this recording to avoid N+1 queries
          const allLinks = repos.contexts.getLinksByRecording(recording.id);

          // Create TopicBlocks from visual clusters (audio merged in)
          const visualClusters = repos.clusters.findByRecordingAndType(
            recording.id,
            'visual'
          );

          for (const cluster of visualClusters) {
            const signals = JSON.parse(cluster.classification || '{}');
            const observations = repos.clusters.getObservations(cluster.id);

            // Get context IDs from pre-loaded links
            const obsIds = new Set(observations.map((o) => o.id));
            const contextIds = new Set<string>();
            for (const link of allLinks) {
              if (obsIds.has(link.observation_id)) {
                contextIds.add(link.context_id);
              }
            }

            // Get merged audio clusters
            const mergedAudio = repos.clusters.getMergedAudioClusters(
              cluster.id
            );

            createTopicBlockFromCluster(
              {
                cluster,
                contextIds: Array.from(contextIds),
                signals,
                mergedAudioClusterIds: mergedAudio.map((a) => a.id),
              },
              repos.topicBlocks
            );
          }

          // Create standalone TopicBlocks for unmerged audio clusters
          const audioClusters = repos.clusters.findByRecordingAndType(
            recording.id,
            'audio'
          );

          for (const cluster of audioClusters) {
            // Check if it was merged
            const isMerged = visualClusters.some((vc) => {
              const mergedAudio = repos.clusters.getMergedAudioClusters(vc.id);
              return mergedAudio.some((ma) => ma.id === cluster.id);
            });

            if (!isMerged) {
              const signals = JSON.parse(cluster.classification || '{}');
              const observations = repos.clusters.getObservations(cluster.id);

              const obsIds = new Set(observations.map((o) => o.id));
              const contextIds = new Set<string>();
              for (const link of allLinks) {
                if (obsIds.has(link.observation_id)) {
                  contextIds.add(link.context_id);
                }
              }

              createTopicBlockFromCluster(
                {
                  cluster,
                  contextIds: Array.from(contextIds),
                  signals,
                },
                repos.topicBlocks
              );
            }
          }

          log('info', `Created topic blocks for ${recording.id}`);
        });
      }
    }

    // 4. Complete
    recording = completeProcessing(recording);
    updateRecordingInDb(repos, recording);
    log('info', `Successfully processed recording ${recording.id}`);
  } catch (error) {
    const message = (error as Error).message;
    log('error', `Processing v2 failed for ${recordingId}: ${message}`);
    recording = failProcessing(recording, message);
    updateRecordingInDb(repos, recording);
    throw error;
  }
}

async function processAudioPipeline(
  recording: Recording,
  adapters: {
    preprocessor: AudioPreprocessor;
    transcription: TranscriptionService;
  },
  options: ProcessRecordingV2Options
): Promise<DbObservationInsert[]> {
  const observations: DbObservationInsert[] = [];

  const processSource = async (
    audioPath: string | null,
    source: 'mic' | 'system'
  ) => {
    if (!audioPath) return;

    log('info', `Processing ${source} audio: ${audioPath}`);

    // VAD
    const { segments, tempDir } = await step(`vad-${source}`, async () => {
      return await adapters.preprocessor.extractSpeechSegments(
        audioPath,
        recording.id
      );
    });

    if (segments.length === 0) {
      log('info', `No speech segments found in ${source} audio`);
      await adapters.preprocessor.cleanup(tempDir);
      return;
    }

    log('info', `Found ${segments.length} segments in ${source} audio`);

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
            `Failed to transcribe segment at ${segment.start}s: ${(error as Error).message}`
          );
        }
      }
      log(
        'info',
        `Successfully transcribed ${successCount}/${segments.length} segments for ${source}`
      );
    });

    // Cleanup
    await step(`cleanup-${source}`, async () => {
      await adapters.preprocessor.cleanup(tempDir);
    });
  };

  if (options.parallel) {
    await Promise.all([
      processSource(recording.audioMicPath, 'mic'),
      processSource(recording.audioSystemPath, 'system'),
    ]);
  } else {
    await processSource(recording.audioMicPath, 'mic');
    await processSource(recording.audioSystemPath, 'system');
  }

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
