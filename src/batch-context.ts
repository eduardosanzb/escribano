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
  IntelligenceService,
  OutlineConfig,
  Repositories,
  TranscriptionService,
  VideoService,
} from './0_types.js';
import { generateSummaryV3 } from './actions/generate-summary-v3.js';
import { updateGlobalIndex } from './actions/outline-index.js';
import { processRecordingV3 } from './actions/process-recording-v3.js';
import {
  getOutlineMetadata,
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
import { createOllamaIntelligenceService } from './adapters/intelligence.ollama.adapter.js';
import { createOutlinePublishingService } from './adapters/publishing.outline.adapter.js';
import { createWhisperTranscriptionService } from './adapters/transcription.whisper.adapter.js';
import { createFfmpegVideoService } from './adapters/video.ffmpeg.adapter.js';
import { getDbPath, getRepositories } from './db/index.js';
import { log, setResourceTracker, withPipeline } from './pipeline/context.js';
import {
  type ResourceTrackable,
  ResourceTracker,
  setupStatsObserver,
} from './stats/index.js';

const MODELS_DIR = path.join(homedir(), '.escribano', 'models');
const MODEL_FILE = 'ggml-large-v3.bin';
const MODEL_PATH = path.join(MODELS_DIR, MODEL_FILE);

export interface SystemContext {
  repos: Repositories;
  adapters: {
    vlm: IntelligenceService;
    llm: IntelligenceService;
    video: VideoService;
    preprocessor: AudioPreprocessor;
    transcription: TranscriptionService;
  };
  resourceTracker: ResourceTracker;
  outlineConfig: OutlineConfig | null;
}

export interface ProcessVideoOptions {
  force?: boolean;
  skipSummary?: boolean;
  micAudioPath?: string;
  systemAudioPath?: string;
}

export interface ProcessVideoResult {
  success: boolean;
  recordingId: string;
  videoPath: string;
  artifactPath?: string;
  outlineUrl?: string;
  error?: string;
  duration: number; // processing time in seconds
}

/**
 * Initialize system components for batch processing.
 * All adapters are created ONCE and reused across recordings.
 */
export async function initializeSystem(): Promise<SystemContext> {
  console.log('Initializing database...');
  const repos = getRepositories();
  console.log(`Database ready: ${getDbPath()}`);
  console.log('');

  // Setup stats observer to capture pipeline events
  setupStatsObserver(repos.stats);

  // Initialize adapters ONCE
  console.log('[VLM] Using MLX-VLM for image processing');
  const vlm = createMlxIntelligenceService();

  console.log('[LLM] Using Ollama for text generation');
  const llm = createOllamaIntelligenceService();

  const video = createFfmpegVideoService();
  const preprocessor = createSileroPreprocessor();
  const transcription = createWhisperTranscriptionService({
    binaryPath: 'whisper-cli',
    model: MODEL_PATH,
    cwd: MODELS_DIR,
    outputFormat: 'json',
  });

  // Setup resource tracking
  const resourceTracker = new ResourceTracker();
  resourceTracker.register(vlm as ResourceTrackable);
  resourceTracker.register(video as ResourceTrackable);
  resourceTracker.register(preprocessor as ResourceTrackable);
  // Ollama runs as a daemon - special case
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
  setResourceTracker(resourceTracker);

  const outlineConfig = getOutlineConfig();

  return {
    repos,
    adapters: { vlm, llm, video, preprocessor, transcription },
    resourceTracker,
    outlineConfig,
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
  } = options;
  const { repos, adapters, outlineConfig } = ctx;
  const { vlm, llm, video, preprocessor, transcription } = adapters;

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
      repos.recordings.updateStatus(recording.id, 'raw', null, null);
    } else if (dbRec.status === 'published') {
      // Already done - return early
      const outlineMeta = getOutlineMetadata(dbRec);
      console.log('Recording already published to Outline.');
      if (outlineMeta) {
        console.log(`Published document: ${outlineMeta.url}`);
      }
      console.log('Use --force to reprocess.');
      return {
        success: true,
        recordingId: recording.id,
        videoPath,
        outlineUrl: outlineMeta?.url,
        duration: (Date.now() - startTime) / 1000,
      };
    } else if (dbRec.status === 'processed') {
      console.log('Recording already processed. Generating summary...');
    }

    // Run VLM pipeline (skip if already processed)
    const skipProcessing = dbRec && dbRec.status === 'processed' && !force;
    if (!skipProcessing) {
      const runType = force
        ? 'force'
        : dbRec?.processing_step
          ? 'resume'
          : 'initial';
      const runMetadata = collectRunMetadata(ctx.resourceTracker);

      await withPipeline(recording.id, runType, runMetadata, async () => {
        await processRecordingV3(
          recording.id,
          repos,
          { preprocessor, transcription, video, intelligence: vlm },
          { force }
        );
      });
    }

    // Generate summary (unless skipped)
    let artifact: { content: string; filePath: string } | null = null;
    if (!skipSummary) {
      console.log('\nGenerating summary...');
      artifact = await generateSummaryV3(recording.id, repos, llm, {
        recordingId: recording.id,
      });
      console.log(`Summary saved: ${artifact.filePath}`);
    }

    // Publish to Outline (unless skipped or no config)
    let outlineUrl: string | undefined;
    if (!skipSummary && outlineConfig && artifact) {
      console.log('\nPublishing to Outline...');
      try {
        const publishing = createOutlinePublishingService(outlineConfig);
        const topicBlocks = repos.topicBlocks.findByRecording(recording.id);
        const dbRecording = repos.recordings.findById(recording.id);

        if (dbRecording && !hasContentChanged(dbRecording, artifact.content)) {
          console.log('Content unchanged, skipping publish.');
        } else {
          const published = await publishSummaryV3(
            recording.id,
            artifact.content,
            topicBlocks,
            repos,
            publishing,
            { collectionName: outlineConfig.collectionName }
          );

          const outlineInfo: OutlineMetadata = {
            url: published.url,
            documentId: published.documentId,
            collectionId: published.collectionId,
            publishedAt: new Date().toISOString(),
            contentHash: published.contentHash,
          };
          updateRecordingOutlineMetadata(recording.id, outlineInfo, repos);

          console.log(`Published to Outline: ${published.url}`);
          outlineUrl = published.url;

          // Update global index
          const indexResult = await updateGlobalIndex(repos, publishing, {
            collectionName: outlineConfig.collectionName,
          });
          console.log(`Updated index: ${indexResult.url}`);
        }

        repos.recordings.updateStatus(recording.id, 'published', null, null);
        log(
          'info',
          `[Outline] Recording ${recording.id} status updated to 'published'`
        );
      } catch (error) {
        const errorMessage = (error as Error).message;
        console.warn(`Warning: Failed to publish to Outline: ${errorMessage}`);
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
    } else if (!skipSummary) {
      console.log(
        'No Outline configuration found. Marking as complete locally.'
      );
      repos.recordings.updateStatus(recording.id, 'published', null, null);
    }

    console.log('\n✓ Complete!');

    return {
      success: true,
      recordingId: recording.id,
      videoPath,
      artifactPath: artifact?.filePath,
      outlineUrl,
      duration: (Date.now() - startTime) / 1000,
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
  resourceTracker?: ResourceTracker
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
    llm_model: 'qwen3:32b',
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
