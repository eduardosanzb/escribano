/**
 * Batch Processing Context
 *
 * Provides reusable initialization and video processing functions
 * for batch operations (e.g., quality testing multiple recordings).
 *
 * Key Design Decisions:
 * - Adapters initialized ONCE and reused across recordings
 * - MLX bridge spawns once, reused for all videos (no socket conflicts)
 * - Filesystem capture source created per-video (hardcoded to file input)
 * - Results returned as objects (never throws) for reliable batch processing
 */

import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import type {
  CaptureSource,
  IntelligenceConfig,
  IntelligenceService,
  OutlineConfig,
  Repositories,
  TranscriptionService,
  VideoService,
} from './0_types.js';
import {
  type ArtifactFormat,
  type ArtifactResult,
  generateArtifactV3,
} from './actions/generate-artifact-v3.js';
import { generateSummaryV3 } from './actions/generate-summary-v3.js';
import { updateGlobalIndex } from './actions/outline-index.js';
import { processRecordingV3 } from './actions/process-recording-v3.js';
import {
  hasContentChanged,
  type OutlineMetadata,
  publishSummaryV3,
  updateRecordingOutlineMetadata,
} from './actions/publish-summary-v3.js';
import type { AudioPreprocessor } from './adapters/audio.silero.adapter.js';
import { createSileroPreprocessor } from './adapters/audio.silero.adapter.js';
import { createFilesystemCaptureSource } from './adapters/capture.filesystem.adapter.js';
import {
  cleanupMlxBridge,
  createMlxIntelligenceService,
} from './adapters/intelligence.mlx.adapter.js';
import {
  createOllamaIntelligenceService,
  unloadOllamaModel,
} from './adapters/intelligence.ollama.adapter.js';
import { createOutlinePublishingService } from './adapters/publishing.outline.adapter.js';
import { createWhisperTranscriptionService } from './adapters/transcription.whisper.adapter.js';
import { createFfmpegVideoService } from './adapters/video.ffmpeg.adapter.js';
import { createDefaultConfig, loadConfig, logConfig } from './config.js';
import { getDbPath, getRepositories } from './db/index.js';
import {
  log,
  setResourceTracker,
  step,
  withPipeline,
} from './pipeline/context.js';
import {
  type ResourceTrackable,
  ResourceTracker,
  setupStatsObserver,
} from './stats/index.js';
import {
  formatModelSelection,
  selectBestLLMModel,
  selectBestMLXModel,
} from './utils/model-detector.js';

const MODELS_DIR = path.join(homedir(), '.escribano', 'models');
const MODEL_FILE = 'ggml-large-v3.bin';
const MODEL_PATH = path.join(MODELS_DIR, MODEL_FILE);

export interface SystemContext {
  repos: Repositories;
  adapters: {
    vlm: IntelligenceService | null;
    llm: IntelligenceService;
    video: VideoService;
    preprocessor: AudioPreprocessor;
    transcription: TranscriptionService;
  };
  resourceTracker: ResourceTracker;
  outlineConfig: OutlineConfig | null;
  config: ReturnType<typeof loadConfig>;
  llmBackend: 'mlx' | 'ollama';
}

export interface ProcessVideoOptions {
  force?: boolean;
  skipSummary?: boolean;
  micAudioPath?: string;
  systemAudioPath?: string;
  format?: ArtifactFormat;
  includePersonal?: boolean;
  copyToClipboard?: boolean;
  printToStdout?: boolean;
  outputDir?: string;
}

export interface ProcessVideoResult {
  success: boolean;
  recordingId: string;
  videoPath: string;
  artifactPath?: string;
  outlineUrl?: string;
  error?: string;
  duration: number;
  format?: ArtifactFormat;
  workDuration?: number;
  personalDuration?: number;
}

/**
 * Initialize system components for batch processing.
 * All adapters are created ONCE and reused across recordings.
 */
export async function initializeSystem(): Promise<SystemContext> {
  // Create default config file if it doesn't exist
  createDefaultConfig();

  // Load and log unified configuration
  const config = loadConfig();
  logConfig();
  console.log('');

  console.log('Initializing database...');
  const repos = getRepositories();
  console.log(`Database ready: ${getDbPath()}`);
  console.log('');

  // Setup stats observer to capture pipeline events
  setupStatsObserver(repos.stats);

  // Detect best LLM model based on configured backend
  let llm: IntelligenceService;
  let mlxService: ReturnType<typeof createMlxIntelligenceService> | null = null;

  if (config.llmBackend === 'mlx') {
    console.log('[LLM] Using MLX for text generation');
    const mlxModelSelection = await selectBestMLXModel();
    console.log(formatModelSelection(mlxModelSelection));
    console.log('');
    mlxService = createMlxIntelligenceService();
    llm = mlxService;
  } else {
    console.log('[LLM] Using Ollama for text generation');
    const ollamaModelSelection = await selectBestLLMModel();
    console.log(formatModelSelection(ollamaModelSelection));
    console.log('');
    llm = createOllamaIntelligenceService();
  }

  const video = createFfmpegVideoService();
  const preprocessor = createSileroPreprocessor();
  const transcription = createWhisperTranscriptionService({
    binaryPath: 'whisper-cli',
    model: MODEL_PATH,
    cwd: MODELS_DIR,
    outputFormat: 'json',
  });

  const resourceTracker = new ResourceTracker();
  resourceTracker.register(video as ResourceTrackable);
  resourceTracker.register(preprocessor as ResourceTrackable);

  if (config.llmBackend === 'ollama') {
    resourceTracker.register({
      getResourceName: () => 'ollama',
      getPid: () => {
        try {
          const output = execSync('pgrep -f "ollama serve"').toString().trim();
          const pid = parseInt(output.split('\n')[0] ?? '0', 10);
          return pid > 0 ? pid : null;
        } catch {
          return null;
        }
      },
    });
  } else if (mlxService) {
    resourceTracker.register(mlxService as unknown as ResourceTrackable);
  }
  setResourceTracker(resourceTracker);

  const outlineConfig = getOutlineConfig();

  return {
    repos,
    adapters: {
      vlm: null as any,
      llm,
      video,
      preprocessor,
      transcription,
    },
    resourceTracker,
    outlineConfig,
    config,
    llmBackend: config.llmBackend,
  };
}

/**
 * Process a single video file.
 *
 * Note: Uses FilesystemCaptureSource (hardcoded for file input, not Cap recordings).
 * The video adapter is from context, but capture source is created per-call.
 */
export async function processVideo(
  videoPath: string,
  ctx: SystemContext,
  options: ProcessVideoOptions = {}
): Promise<ProcessVideoResult> {
  const startTime = Date.now();
  const {
    force = false,
    skipSummary = false,
    micAudioPath,
    systemAudioPath,
    format = 'card',
    includePersonal = false,
    copyToClipboard = false,
    printToStdout = false,
  } = options;
  const { repos, adapters, outlineConfig } = ctx;
  const { llm, video, preprocessor, transcription } = adapters;

  // Load unified config for lifecycle management
  const config = loadConfig();

  try {
    // Create capture source for this specific file
    // Note: Hardcoded to filesystem source, not Cap recordings
    const captureSource: CaptureSource = createFilesystemCaptureSource(
      { videoPath, micAudioPath, systemAudioPath },
      video
    );

    // Get recording metadata
    const recording = await captureSource.getLatestRecording();
    if (!recording) {
      return {
        success: false,
        recordingId: '',
        videoPath,
        error: `Failed to load video file: ${videoPath}`,
        duration: (Date.now() - startTime) / 1000,
      };
    }

    console.log(`\nProcessing recording: ${recording.id}`);
    console.log(`Duration: ${Math.round(recording.duration / 60)} minutes`);

    // Check/create DB recording
    const dbRec = repos.recordings.findById(recording.id);
    if (!dbRec) {
      repos.recordings.save({
        id: recording.id,
        video_path: recording.videoPath,
        audio_mic_path: recording.audioMicPath,
        audio_system_path: recording.audioSystemPath,
        duration: recording.duration,
        captured_at: recording.capturedAt.toISOString(),
        status: 'raw',
        processing_step: null,
        source_type: recording.source.type,
        source_metadata: JSON.stringify(recording.source),
        error_message: null,
      });
      console.log('Created database entry');
    } else if (force) {
      console.log('Force flag set: clearing existing data');
      repos.observations.deleteByRecording(recording.id);
      repos.topicBlocks.deleteByRecording(recording.id);
      repos.subjects.deleteByRecording(recording.id);
      repos.recordings.updateStatus(recording.id, 'raw', null, null);
    } else if (dbRec.status === 'published' || dbRec.status === 'processed') {
      console.log(
        `Recording already ${dbRec.status}. Regenerating artifact...`
      );
    }

    // Run VLM pipeline (skip if already processed or published)
    const skipProcessing =
      dbRec &&
      (dbRec.status === 'processed' || dbRec.status === 'published') &&
      !force;

    // Create VLM adapter lazily (only if needed)
    let vlm: IntelligenceService | null = null;
    if (!skipProcessing) {
      // Reuse the same MLX service instance for VLM (unified adapter handles both)
      // Check if LLM is MLX backend - if so, it's already a unified VLM+LLM service
      if (ctx.config.llmBackend === 'mlx' && llm) {
        vlm = llm;
      } else {
        console.log('[VLM] Initializing MLX-VLM for frame analysis...');
        vlm = createMlxIntelligenceService();
        ctx.resourceTracker.register(vlm as unknown as ResourceTrackable);
      }
      ctx.adapters.vlm = vlm;
    }

    if (!skipProcessing) {
      const runType = force
        ? 'force'
        : dbRec?.processing_step
          ? 'resume'
          : 'initial';
      const runMetadata = collectRunMetadata(ctx.resourceTracker, ctx.config);

      await withPipeline(recording.id, runType, runMetadata, async () => {
        if (!vlm)
          throw new Error(
            '[VLM] Internal error: VLM adapter expected but not initialized'
          );
        await processRecordingV3(
          recording.id,
          repos,
          { preprocessor, transcription, video, intelligence: vlm },
          { force }
        );
      });

      // Clean up VLM bridge after processing to free memory for LLM
      if (vlm) {
        console.log('[VLM] Unloading VLM model to free memory...');
        await vlm.unloadVlm?.();
        // Note: We don't kill the bridge process here, just unload the model
        // The bridge process will be reused for subsequent recordings if needed
      }
    }

    // Generate artifact and publish (unless skipped), tracked as a pipeline run
    let artifact: ArtifactResult | null = null;
    let outlineUrl: string | undefined;
    if (!skipSummary) {
      // Guard: Ensure VLM is unloaded before LLM generation to prevent memory contention
      if (ctx.adapters.vlm) {
        console.log(
          '[VLM] Warning: VLM bridge still loaded during artifact generation'
        );
        console.log('[VLM] Unloading to prevent memory contention with LLM...');
        if ('unloadVlm' in ctx.adapters.vlm && ctx.adapters.vlm.unloadVlm) {
          await ctx.adapters.vlm.unloadVlm();
        }
        ctx.adapters.vlm = null;
      }

      const artifactRunMetadata = collectRunMetadata(
        ctx.resourceTracker,
        ctx.config
      );
      const pipelineResult = await withPipeline(
        recording.id,
        'artifact',
        artifactRunMetadata,
        async () => {
          console.log(`\nGenerating ${format} artifact...`);
          let generatedArtifact: ArtifactResult;

          // LLM model loading is handled internally by generateText()
          // No explicit load/unload calls needed here

          if (format === 'narrative') {
            // Route narrative through the corrected path
            generatedArtifact = await generateSummaryV3(
              recording.id,
              repos,
              llm,
              {
                recordingId: recording.id,
                outputDir: options.outputDir,
                useTemplate: false,
                includePersonal,
                copyToClipboard,
                printToStdout,
              }
            );
          } else {
            // Card and standup use the original path
            generatedArtifact = await generateArtifactV3(
              recording.id,
              repos,
              llm,
              {
                recordingId: recording.id,
                format,
                includePersonal,
                copyToClipboard,
                printToStdout,
              }
            );
          }

          console.log(`Artifact saved: ${generatedArtifact.filePath}`);
          if (generatedArtifact.workDuration > 0) {
            const workMins = Math.round(generatedArtifact.workDuration / 60);
            console.log(`Work time: ${workMins} minutes`);
          }
          if (generatedArtifact.personalDuration > 0 && !includePersonal) {
            const personalMins = Math.round(
              generatedArtifact.personalDuration / 60
            );
            console.log(`Personal time: ${personalMins} minutes (filtered)`);
          }

          // Publish to Outline (unless no config)
          let publishedUrl: string | undefined;
          if (outlineConfig) {
            try {
              await step('outline publish', async () => {
                console.log('\nPublishing to Outline...');
                const publishing =
                  createOutlinePublishingService(outlineConfig);
                const topicBlocks = repos.topicBlocks.findByRecording(
                  recording.id
                );
                const dbRecording = repos.recordings.findById(recording.id);

                if (
                  dbRecording &&
                  !hasContentChanged(
                    dbRecording,
                    generatedArtifact.content,
                    format
                  )
                ) {
                  console.log('Content unchanged, skipping publish.');
                } else {
                  const published = await publishSummaryV3(
                    recording.id,
                    generatedArtifact.content,
                    topicBlocks,
                    repos,
                    publishing,
                    { collectionName: outlineConfig.collectionName, format }
                  );

                  const outlineInfo: OutlineMetadata = {
                    url: published.url,
                    documentId: published.documentId,
                    collectionId: published.collectionId,
                    publishedAt: new Date().toISOString(),
                    contentHash: published.contentHash,
                  };
                  updateRecordingOutlineMetadata(
                    recording.id,
                    outlineInfo,
                    repos,
                    format
                  );

                  console.log(`Published to Outline: ${published.url}`);
                  publishedUrl = published.url;
                }

                // Update status BEFORE rebuilding index so findByStatus('published') includes this recording
                repos.recordings.updateStatus(
                  recording.id,
                  'published',
                  null,
                  null
                );
                log(
                  'info',
                  `[Outline] Recording ${recording.id} status updated to 'published'`
                );

                // Update global index (after status update so this recording is included)
                if (publishedUrl) {
                  const indexResult = await updateGlobalIndex(
                    repos,
                    publishing,
                    {
                      collectionName: outlineConfig.collectionName,
                    }
                  );
                  console.log(`Updated index: ${indexResult.url}`);
                }
              });
            } catch (error) {
              const errorMessage = (error as Error).message;
              console.warn(
                `Warning: Failed to publish to Outline: ${errorMessage}`
              );
              log('warn', `[Outline] Publishing failed: ${errorMessage}`);

              // Store error in metadata
              try {
                const dbRecording = repos.recordings.findById(recording.id);
                const currentMetadata = dbRecording?.source_metadata
                  ? JSON.parse(dbRecording.source_metadata)
                  : {};
                const existingOutline = currentMetadata.outline || {};
                const updatedMetadata = {
                  ...currentMetadata,
                  outline: {
                    ...existingOutline,
                    error: errorMessage,
                    failedAt: new Date().toISOString(),
                  },
                };
                repos.recordings.updateMetadata(
                  recording.id,
                  JSON.stringify(updatedMetadata)
                );
              } catch (metaError) {
                log(
                  'error',
                  `[Outline] Failed to store error metadata: ${(metaError as Error).message}`
                );
              }
            }
          } else {
            console.log(
              'No Outline configuration found. Marking as complete locally.'
            );
            repos.recordings.updateStatus(
              recording.id,
              'published',
              null,
              null
            );
          }

          return { artifact: generatedArtifact, outlineUrl: publishedUrl };
        }
      );
      artifact = pipelineResult.artifact;
      outlineUrl = pipelineResult.outlineUrl;

      // Unload LLM after artifact generation to free memory (good hygiene for all RAM tiers)
      if (config.llmModel) {
        console.log('[LLM] Unloading model to free memory...');
        const intelConfig: IntelligenceConfig = {
          provider: 'ollama',
          endpoint: 'http://localhost:11434/api/chat',
          model: config.llmModel,
          generationModel: config.llmModel,
          visionModel: config.vlmModel,
          maxRetries: 3,
          timeout: 600000,
          keepAlive: '10m',
          maxContextSize: 131072,
          embedding: { model: 'nomic-embed-text', similarityThreshold: 0.75 },
          vlmBatchSize: config.vlmBatchSize,
          vlmMaxTokens: config.vlmMaxTokens,
          mlxSocketPath: config.mlxSocketPath,
        };
        await unloadOllamaModel(config.llmModel, intelConfig);
      } else if (
        'unloadLlm' in ctx.adapters.llm &&
        ctx.adapters.llm.unloadLlm
      ) {
        console.log('[LLM] Unloading MLX model to free memory...');
        await ctx.adapters.llm.unloadLlm();
      }
    }

    console.log('\n✓ Complete!');

    return {
      success: true,
      recordingId: recording.id,
      videoPath,
      artifactPath: artifact?.filePath,
      outlineUrl,
      duration: (Date.now() - startTime) / 1000,
      format: artifact?.format,
      workDuration: artifact?.workDuration,
      personalDuration: artifact?.personalDuration,
    };
  } catch (error) {
    const errorMessage = (error as Error).message;
    console.error(`\n✗ Failed: ${errorMessage}`);
    return {
      success: false,
      recordingId: '',
      videoPath,
      error: errorMessage,
      duration: (Date.now() - startTime) / 1000,
    };
  }
}

/**
 * Get Outline configuration from environment if available.
 */
function getOutlineConfig(): OutlineConfig | null {
  const url = process.env.ESCRIBANO_OUTLINE_URL;
  const token = process.env.ESCRIBANO_OUTLINE_TOKEN;

  if (!url || !token) {
    return null;
  }

  return {
    url,
    token,
    collectionName:
      process.env.ESCRIBANO_OUTLINE_COLLECTION ?? 'Escribano Sessions',
  };
}

/**
 * Collect metadata about the current run.
 */
function collectRunMetadata(
  resourceTracker?: ResourceTracker,
  config?: ReturnType<typeof loadConfig>
): Record<string, unknown> {
  let commitHash = 'unknown';
  try {
    commitHash = execSync('git rev-parse --short HEAD', {
      encoding: 'utf-8',
    }).trim();
  } catch {
    // Not in a git repo
  }

  const metadata: Record<string, unknown> = {
    vlm_model:
      process.env.ESCRIBANO_VLM_MODEL ??
      'mlx-community/Qwen3-VL-2B-Instruct-bf16',
    llm_model: process.env.ESCRIBANO_LLM_MODEL ?? 'auto-detected',
    llm_backend: config?.llmBackend ?? 'ollama',
    commit_hash: commitHash,
    node_version: process.version,
    platform: process.platform,
    arch: process.arch,
    env: {
      ESCRIBANO_SAMPLE_INTERVAL: process.env.ESCRIBANO_SAMPLE_INTERVAL,
      ESCRIBANO_VLM_BATCH_SIZE: process.env.ESCRIBANO_VLM_BATCH_SIZE,
      ESCRIBANO_VERBOSE: process.env.ESCRIBANO_VERBOSE,
    },
  };

  if (resourceTracker) {
    metadata.system = resourceTracker.getSystemInfo();
  }

  return metadata;
}

export { cleanupMlxBridge };
