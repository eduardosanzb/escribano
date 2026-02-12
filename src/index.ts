/**
 * Escribano CLI Entry Point
 *
 * Single command: process latest recording and generate summary
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { generateSummaryV3 } from './actions/generate-summary-v3.js';
import { processRecordingV3 } from './actions/process-recording-v3.js';
import { createSileroPreprocessor } from './adapters/audio.silero.adapter.js';
import { createCapCaptureSource } from './adapters/capture.cap.adapter.js';
import { createOllamaIntelligenceService } from './adapters/intelligence.ollama.adapter.js';
import { createWhisperTranscriptionService } from './adapters/transcription.whisper.adapter.js';
import { createFfmpegVideoService } from './adapters/video.ffmpeg.adapter.js';
import { getRepositories } from './db/index.js';
import { withPipeline } from './pipeline/context.js';

const MODELS_DIR = path.join(homedir(), '.escribano', 'models');
const MODEL_FILE = 'ggml-large-v3.bin';
const MODEL_PATH = path.join(MODELS_DIR, MODEL_FILE);

interface ParsedArgs {
  force: boolean;
  help: boolean;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  run(args.force).catch((error) => {
    console.error('Error:', (error as Error).message);
    console.error((error as Error).stack);
    process.exit(1);
  });
}

function parseArgs(argsArray: string[]): ParsedArgs {
  return {
    force: argsArray.includes('--force'),
    help: argsArray.includes('--help') || argsArray.includes('-h'),
  };
}

function showHelp(): void {
  console.log(`
Escribano - Session Intelligence Tool

Usage:
  pnpm escribano           Process latest recording and generate summary
  pnpm escribano --force   Reprocess from scratch
  pnpm escribano --help    Show this help

Output: Markdown summary saved to ~/.escribano/artifacts/
`);
}

async function run(force: boolean): Promise<void> {
  const repos = getRepositories();
  const cap = createCapCaptureSource();
  const intelligence = createOllamaIntelligenceService();
  const video = createFfmpegVideoService();
  const preprocessor = createSileroPreprocessor();
  const transcription = createWhisperTranscriptionService({
    binaryPath: 'whisper-cli',
    model: MODEL_PATH,
    cwd: MODELS_DIR,
    outputFormat: 'json',
  });

  // Get latest Cap recording
  const recording = await cap.getLatestRecording();
  if (!recording) {
    console.log('No Cap recordings found.');
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
      source_type: 'cap',
      source_metadata: JSON.stringify(recording.source),
      error_message: null,
    });
    console.log('Created database entry');
  } else if (force) {
    console.log('Force flag set: clearing existing observations');
    repos.observations.deleteByRecording(recording.id);
    repos.recordings.updateStatus(recording.id, 'raw', null, null);
  } else if (dbRec.status === 'processed') {
    console.log('Recording already processed. Use --force to reprocess.');
    console.log('');
  }

  // Process recording
  await withPipeline(recording.id, async () => {
    await processRecordingV3(
      recording.id,
      repos,
      { preprocessor, transcription, video, intelligence },
      { force }
    );
  });

  console.log('');
  console.log('Generating summary...');

  // Generate summary
  const artifact = await generateSummaryV3(recording.id, repos, {
    recordingId: recording.id,
  });

  console.log('');
  console.log('✓ Complete!');
  console.log(`Summary saved: ${artifact.filePath}`);
}

main();
