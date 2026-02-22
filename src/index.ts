/**
 * Escribano CLI Entry Point
 *
 * Single command: process latest recording and generate summary
 */

import { homedir } from 'node:os';
import path from 'node:path';
import type { CaptureSource, OutlineConfig } from './0_types.js';
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
import { createSileroPreprocessor } from './adapters/audio.silero.adapter.js';
import { createCapCaptureSource } from './adapters/capture.cap.adapter.js';
import { createFilesystemCaptureSource } from './adapters/capture.filesystem.adapter.js';
import { createOllamaIntelligenceService } from './adapters/intelligence.ollama.adapter.js';
import { createOutlinePublishingService } from './adapters/publishing.outline.adapter.js';
import { createWhisperTranscriptionService } from './adapters/transcription.whisper.adapter.js';
import { createFfmpegVideoService } from './adapters/video.ffmpeg.adapter.js';
import { getDbPath, getRepositories } from './db/index.js';
import { log, withPipeline } from './pipeline/context.js';

const MODELS_DIR = path.join(homedir(), '.escribano', 'models');
const MODEL_FILE = 'ggml-large-v3.bin';
const MODEL_PATH = path.join(MODELS_DIR, MODEL_FILE);

interface ParsedArgs {
  force: boolean;
  help: boolean;
  file: string | null;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  run(args.force, args.file).catch((error) => {
    console.error('Error:', (error as Error).message);
    console.error((error as Error).stack);
    process.exit(1);
  });
}

function parseArgs(argsArray: string[]): ParsedArgs {
  const fileIndex = argsArray.indexOf('--file');
  const filePath = fileIndex !== -1 ? argsArray[fileIndex + 1] || null : null;

  return {
    force: argsArray.includes('--force'),
    help: argsArray.includes('--help') || argsArray.includes('-h'),
    file: filePath,
  };
}

function showHelp(): void {
  console.log(`
Escribano - Session Intelligence Tool

Usage:
  pnpm escribano                           Process latest Cap recording
  pnpm escribano --file <path>             Process video from filesystem
  pnpm escribano --force                   Reprocess from scratch
  pnpm escribano --file <path> --force     Reprocess specific file
  pnpm escribano --help                    Show this help

Examples:
  pnpm escribano --file "~/Desktop/Screen Recording.mov"
  pnpm escribano --file "/path/to/video.mp4"

Output: Markdown summary saved to ~/.escribano/artifacts/
`);
}

async function run(force: boolean, filePath: string | null): Promise<void> {
  // Initialize database (runs migrations automatically)
  console.log('Initializing database...');
  const repos = getRepositories();
  console.log(`Database ready: ${getDbPath()}`);
  console.log('');

  // Initialize adapters
  const intelligence = createOllamaIntelligenceService();
  const video = createFfmpegVideoService();
  const preprocessor = createSileroPreprocessor();
  const transcription = createWhisperTranscriptionService({
    binaryPath: 'whisper-cli',
    model: MODEL_PATH,
    cwd: MODELS_DIR,
    outputFormat: 'json',
  });

  // Create appropriate capture source
  let captureSource: CaptureSource;
  if (filePath) {
    console.log(`Using filesystem source: ${filePath}`);
    captureSource = createFilesystemCaptureSource(
      { videoPath: filePath },
      video
    );
  } else {
    console.log('Using Cap recordings source');
    captureSource = createCapCaptureSource({}, video);
  }

  // Get recording
  const recording = await captureSource.getLatestRecording();
  if (!recording) {
    if (filePath) {
      console.log(`Failed to load video file: ${filePath}`);
    } else {
      console.log('No Cap recordings found.');
    }
    return;
  }

  console.log(`Processing recording: ${recording.id}`);
  console.log(`Duration: ${Math.round(recording.duration / 60)} minutes`);
  console.log('');

  // Ensure DB recording exists
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
    // Check if already published with same content
    console.log('Recording already published to Outline.');
    const outlineMeta = getOutlineMetadata(dbRec);
    if (outlineMeta) {
      console.log(`Published document: ${outlineMeta.url}`);
    }
    console.log('Use --force to reprocess.');
    console.log('');
    return;
  } else if (dbRec.status === 'processed') {
    // Already processed, skip to summary generation + publishing
    console.log('Recording already processed. Publishing to Outline...');
    console.log('');
  }

  // Process recording (skip if already processed)
  const skipProcessing = dbRec && dbRec.status === 'processed' && !force;
  if (!skipProcessing) {
    await withPipeline(recording.id, async () => {
      await processRecordingV3(
        recording.id,
        repos,
        { preprocessor, transcription, video, intelligence },
        { force }
      );
    });
  }

  console.log('');
  console.log('Generating summary...');

  // Generate summary
  const artifact = await generateSummaryV3(recording.id, repos, intelligence, {
    recordingId: recording.id,
  });

  console.log('');

  // Publish to Outline if configured
  const outlineConfig = getOutlineConfig();
  if (outlineConfig) {
    console.log('Publishing to Outline...');
    try {
      const publishing = createOutlinePublishingService(outlineConfig);
      const topicBlocks = repos.topicBlocks.findByRecording(recording.id);

      // Check if already published with same content
      const dbRecording = repos.recordings.findById(recording.id);
      if (dbRecording && !hasContentChanged(dbRecording, artifact.content)) {
        console.log('Content unchanged, skipping publish.');
      } else {
        // Publish the summary
        const published = await publishSummaryV3(
          recording.id,
          artifact.content,
          topicBlocks,
          repos,
          publishing,
          { collectionName: outlineConfig.collectionName }
        );

        // Update recording metadata with outline info
        const outlineInfo: OutlineMetadata = {
          url: published.url,
          documentId: published.documentId,
          collectionId: published.collectionId,
          publishedAt: new Date().toISOString(),
          contentHash: published.contentHash,
        };
        updateRecordingOutlineMetadata(recording.id, outlineInfo, repos);

        console.log(`Published to Outline: ${published.url}`);

        // Update global index
        const indexResult = await updateGlobalIndex(repos, publishing, {
          collectionName: outlineConfig.collectionName,
        });
        console.log(`Updated index: ${indexResult.url}`);
      }

      // Update status to 'published' (whether we just published or skipped due to no changes)
      repos.recordings.updateStatus(recording.id, 'published', null, null);
      log(
        'info',
        `[Outline] Recording ${recording.id} status updated to 'published'`
      );
    } catch (error) {
      // Keep 'processed' status but store error in metadata
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
        log('info', `[Outline] Error stored in metadata for ${recording.id}`);
      } catch (metaError) {
        log(
          'error',
          `[Outline] Failed to store error metadata: ${(metaError as Error).message}`
        );
      }
    }
  } else {
    // No Outline config, but processing is complete - mark as published locally
    console.log('No Outline configuration found. Marking as complete locally.');
    repos.recordings.updateStatus(recording.id, 'published', null, null);
    log(
      'info',
      `[Outline] Recording ${recording.id} marked as 'published' (no Outline config)`
    );
  }

  console.log('');
  console.log('✓ Complete!');
  console.log(`Summary saved: ${artifact.filePath}`);
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

main();
