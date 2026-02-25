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
import { setupStatsObserver } from './stats/index.js';

const MODELS_DIR = path.join(homedir(), '.escribano', 'models');
const MODEL_FILE = 'ggml-large-v3.bin';
const MODEL_PATH = path.join(MODELS_DIR, MODEL_FILE);

interface ParsedArgs {
  force: boolean;
  help: boolean;
  file: string | null;
  skipSummary: boolean;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  run(args.force, args.file, args.skipSummary).catch((error) => {
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
    skipSummary: argsArray.includes('--skip-summary'),
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
  pnpm escribano --skip-summary            Process only (no summary generation)
  pnpm escribano --help                    Show this help

Examples:
  pnpm escribano --file "~/Desktop/Screen Recording.mov"
  pnpm escribano --file "/path/to/video.mp4"

Output: Markdown summary saved to ~/.escribano/artifacts/
`);
}

async function run(
  force: boolean,
  filePath: string | null,
  skipSummary: boolean
): Promise<void> {
  // Initialize system (reuses batch-context for consistency)
  console.log('Initializing database...');
  const ctx = await initializeSystem();
  const { repos } = ctx;

  console.log(`Database ready: ${getDbPath()}`);
  console.log('');

  // Setup stats observer
  setupStatsObserver(repos.stats);

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
    captureSource = createFilesystemCaptureSource(
      { videoPath: filePath },
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
    { force, skipSummary }
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
