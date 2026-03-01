/**
 * Escribano CLI Entry Point
 *
 * Single command: process latest recording and generate summary
 * Refactored to use batch-context for shared initialization logic
 */

import { homedir } from 'node:os';
import path from 'node:path';
import type { CaptureSource } from './0_types.js';
import { createCapCaptureSource } from './adapters/capture.cap.adapter.js';
import { createFilesystemCaptureSource } from './adapters/capture.filesystem.adapter.js';
import {
  cleanupMlxBridge,
  initializeSystem,
  type ProcessVideoResult,
  processVideo,
} from './batch-context.js';
import { getDbPath } from './db/index.js';
import {
  checkPrerequisites,
  hasMissingPrerequisites,
  printDoctorResults,
} from './prerequisites.js';
import { setupStatsObserver } from './stats/index.js';

const MODELS_DIR = path.join(homedir(), '.escribano', 'models');
const MODEL_FILE = 'ggml-large-v3.bin';
const MODEL_PATH = path.join(MODELS_DIR, MODEL_FILE);

interface ParsedArgs {
  force: boolean;
  help: boolean;
  doctor: boolean;
  file: string | null;
  skipSummary: boolean;
  micAudio: string | null;
  systemAudio: string | null;
  format: 'card' | 'standup' | 'narrative';
  includePersonal: boolean;
  copyToClipboard: boolean;
  printToStdout: boolean;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  if (args.doctor) {
    runDoctor().catch((error) => {
      console.error('Error:', (error as Error).message);
      process.exit(1);
    });
    return;
  }

  run(args).catch((error) => {
    console.error('Error:', (error as Error).message);
    console.error((error as Error).stack);
    process.exit(1);
  });
}

async function runDoctor(): Promise<void> {
  const results = checkPrerequisites();
  printDoctorResults(results);

  if (hasMissingPrerequisites(results)) {
    process.exit(1);
  }
}

function parseArgs(argsArray: string[]): ParsedArgs {
  const fileIndex = argsArray.indexOf('--file');
  const filePath = fileIndex !== -1 ? argsArray[fileIndex + 1] || null : null;
  const micIndex = argsArray.indexOf('--mic-audio');
  const micAudio = micIndex !== -1 ? argsArray[micIndex + 1] || null : null;
  const sysIndex = argsArray.indexOf('--system-audio');
  const systemAudio = sysIndex !== -1 ? argsArray[sysIndex + 1] || null : null;

  const formatIndex = argsArray.indexOf('--format');
  const formatValue = formatIndex !== -1 ? argsArray[formatIndex + 1] : 'card';

  return {
    force: argsArray.includes('--force'),
    help: argsArray.includes('--help') || argsArray.includes('-h'),
    doctor: argsArray[0] === 'doctor',
    file: filePath,
    skipSummary: argsArray.includes('--skip-summary'),
    micAudio,
    systemAudio,
    format:
      formatValue === 'standup' || formatValue === 'narrative'
        ? formatValue
        : 'card',
    includePersonal: argsArray.includes('--include-personal'),
    copyToClipboard: argsArray.includes('--copy'),
    printToStdout: argsArray.includes('--stdout'),
  };
}

function showHelp(): void {
  console.log(`
Escribano - Session Intelligence Tool

Usage:
  npx escribano                           Process latest Cap recording
  npx escribano doctor                    Check prerequisites
  npx escribano --file <path>             Process video from filesystem
  npx escribano --file <path> --mic-audio <wav>   Use external mic audio
  npx escribano --file <path> --system-audio <wav>  Provide system audio
  npx escribano --force                   Reprocess from scratch
  npx escribano --skip-summary            Process only (no summary generation)
  npx escribano --format <format>         Artifact format: card (default), standup, narrative
  npx escribano --include-personal        Include personal time in artifact
  npx escribano --copy                    Copy artifact to clipboard
  npx escribano --stdout                  Print artifact to stdout
  npx escribano --help                    Show this help

Examples:
  npx escribano --file "~/Desktop/Screen Recording.mov"
  npx escribano --file "/path/to/video.mp4" --mic-audio "/path/to/mic.wav"
  npx escribano --file "/path/to/video.mp4" --system-audio "/path/to/system.wav"
  npx escribano --format standup --stdout
  npx escribano --format narrative --include-personal

Output: Markdown summary saved to ~/.escribano/artifacts/
`);
}

async function run(args: ParsedArgs): Promise<void> {
  const {
    force,
    file: filePath,
    skipSummary,
    micAudio,
    systemAudio,
    format,
    includePersonal,
    copyToClipboard,
    printToStdout,
  } = args;

  // Initialize system (reuses batch-context for consistency)
  console.log('Initializing database...');
  const ctx = await initializeSystem();
  const { repos } = ctx;

  console.log(`Database ready: ${getDbPath()}`);
  console.log('');

  // SIGINT handler for graceful cancellation
  const sigintHandler = () => {
    console.log('\n⚠️  Run cancelled.');
    cleanupMlxBridge();
    process.exit(130);
  };
  process.on('SIGINT', sigintHandler);

  // Create appropriate capture source
  let captureSource: CaptureSource;
  if (filePath) {
    console.log(`Using filesystem source: ${filePath}`);
    if (micAudio) console.log(`  Mic audio: ${micAudio}`);
    if (systemAudio) console.log(`  System audio: ${systemAudio}`);
    captureSource = createFilesystemCaptureSource(
      {
        videoPath: filePath,
        micAudioPath: micAudio ?? undefined,
        systemAudioPath: systemAudio ?? undefined,
      },
      ctx.adapters.video
    );
  } else {
    console.log('Using Cap recordings source');
    captureSource = createCapCaptureSource({}, ctx.adapters.video);
  }

  // Get recording
  const recording = await captureSource.getLatestRecording();
  if (!recording) {
    if (filePath) {
      console.log(`Failed to load video file: ${filePath}`);
    } else {
      console.log('No Cap recordings found.');
    }
    cleanupMlxBridge();
    return;
  }

  console.log(`Processing: ${recording.id}`);
  console.log(`Duration: ${Math.round(recording.duration / 60)} minutes`);
  console.log('');

  // Use shared processVideo function
  if (!recording.videoPath) {
    console.error('Recording has no video path');
    cleanupMlxBridge();
    process.exit(1);
  }
  const result: ProcessVideoResult = await processVideo(
    recording.videoPath,
    ctx,
    {
      force,
      skipSummary,
      micAudioPath: micAudio ?? undefined,
      systemAudioPath: systemAudio ?? undefined,
      format,
      includePersonal,
      copyToClipboard,
      printToStdout,
    }
  );

  // Cleanup
  cleanupMlxBridge();

  // Exit with appropriate code
  if (!result.success) {
    console.error(`\nProcessing failed: ${result.error}`);
    process.exit(1);
  }

  console.log('\n✓ All done!');
  if (result.outlineUrl) {
    console.log(`Outline: ${result.outlineUrl}`);
  }
}

main();
