/**
 * Escribano CLI Entry Point
 *
 * Single command: process latest recording and generate summary
 * Refactored to use batch-context for shared initialization logic
 */

import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import pkg from '../package.json' with { type: 'json' };
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
import { logEnvironmentVariables } from './utils/env-logger.js';

const MODELS_DIR = path.join(homedir(), '.escribano', 'models');
const MODEL_FILE = 'ggml-large-v3.bin';
const _MODEL_PATH = path.join(MODELS_DIR, MODEL_FILE);

const VIDEO_EXTENSIONS = ['.mov', '.mp4', '.mkv', '.avi', '.webm'];

function expandPath(inputPath: string): string {
  if (!inputPath.startsWith('~')) {
    return inputPath;
  }

  const homeDir = homedir();
  if (!homeDir) {
    return inputPath;
  }

  if (inputPath === '~' || inputPath === '~/') {
    return homeDir;
  }

  if (inputPath.startsWith('~/')) {
    return path.join(homeDir, inputPath.slice(2));
  }

  return inputPath;
}

async function findLatestVideo(dirPath: string): Promise<string> {
  const resolvedPath = expandPath(dirPath);

  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(resolvedPath, { withFileTypes: true });
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err && typeof err === 'object') {
      switch (err.code) {
        case 'ENOENT':
          throw new Error(`Directory not found: ${resolvedPath}`);
        case 'ENOTDIR':
          throw new Error(`Not a directory: ${resolvedPath}`);
        case 'EACCES':
        case 'EPERM':
          throw new Error(
            `Permission denied reading directory: ${resolvedPath}`
          );
        default:
          break;
      }
    }
    throw error;
  }

  const videoFiles = entries.filter(
    (entry) =>
      entry.isFile() &&
      VIDEO_EXTENSIONS.some((ext) => entry.name.toLowerCase().endsWith(ext))
  );

  if (videoFiles.length === 0) {
    throw new Error(`No video files found in: ${resolvedPath}`);
  }

  let latestPath: string | null = null;
  let latestMtime = -Infinity;

  for (const entry of videoFiles) {
    const fullPath = path.join(resolvedPath, entry.name);
    const fileStat = await stat(fullPath);
    const mtimeMs = fileStat.mtime.getTime();

    if (mtimeMs > latestMtime) {
      latestMtime = mtimeMs;
      latestPath = fullPath;
    }
  }

  if (!latestPath) {
    throw new Error(`No video files found in: ${resolvedPath}`);
  }

  return latestPath;
}

interface ParsedArgs {
  force: boolean;
  help: boolean;
  version: boolean;
  doctor: boolean;
  file: string | null;
  latest: string | null;
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

  if (args.version) {
    console.log(`escribano v${pkg.version}`);
    process.exit(0);
  }

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
  const latestIndex = argsArray.indexOf('--latest');
  const latestPath =
    latestIndex !== -1 ? argsArray[latestIndex + 1] || null : null;

  if (filePath && latestPath) {
    console.error('Error: Cannot use both --latest and --file');
    process.exit(1);
  }

  if (latestIndex !== -1 && !latestPath) {
    console.error('Error: --latest requires a directory argument');
    process.exit(1);
  }

  if (latestIndex !== -1 && latestPath?.startsWith('-')) {
    console.error('Error: --latest requires a directory argument');
    process.exit(1);
  }

  const micIndex = argsArray.indexOf('--mic-audio');
  const micAudio = micIndex !== -1 ? argsArray[micIndex + 1] || null : null;
  const sysIndex = argsArray.indexOf('--system-audio');
  const systemAudio = sysIndex !== -1 ? argsArray[sysIndex + 1] || null : null;

  const formatIndex = argsArray.indexOf('--format');
  const formatValue = formatIndex !== -1 ? argsArray[formatIndex + 1] : 'card';

  return {
    force: argsArray.includes('--force'),
    help: argsArray.includes('--help') || argsArray.includes('-h'),
    version: argsArray.includes('--version') || argsArray.includes('-v'),
    doctor: argsArray[0] === 'doctor',
    file: filePath,
    latest: latestPath,
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
  npx escribano --latest <dir>            Process latest video in directory
  npx escribano --file <path> --mic-audio <wav>   Use external mic audio
  npx escribano --file <path> --system-audio <wav>  Provide system audio
  npx escribano --force                   Reprocess from scratch
  npx escribano --skip-summary            Process only (no summary generation)
  npx escribano --format <format>         Artifact format: card (default), standup, narrative
  npx escribano --include-personal        Include personal time in artifact
  npx escribano --copy                    Copy artifact to clipboard
  npx escribano --stdout                  Print artifact to stdout
  npx escribano --version                 Show version number
  npx escribano --help                    Show this help

Examples:
  npx escribano --file "~/Desktop/Screen Recording.mov"
  npx escribano --latest "~/Desktop"
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
    latest,
    skipSummary,
    micAudio,
    systemAudio,
    format,
    includePersonal,
    copyToClipboard,
    printToStdout,
  } = args;

  // Resolve --latest to a file path
  let resolvedFilePath = filePath;
  if (latest) {
    resolvedFilePath = await findLatestVideo(latest);
    console.log(`Found latest video: ${resolvedFilePath}`);
  }

  // Log environment variables if verbose mode is enabled
  logEnvironmentVariables();

  // Initialize system (reuses batch-context for consistency)
  console.log('Initializing database...');
  const ctx = await initializeSystem();
  // Note: repos unused in CLI mode (only needed for batch processing)
  void ctx;

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
  if (resolvedFilePath) {
    console.log(`Using filesystem source: ${resolvedFilePath}`);
    if (micAudio) console.log(`  Mic audio: ${micAudio}`);
    if (systemAudio) console.log(`  System audio: ${systemAudio}`);
    captureSource = createFilesystemCaptureSource(
      {
        videoPath: resolvedFilePath,
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
    if (resolvedFilePath) {
      console.log(`Failed to load video file: ${resolvedFilePath}`);
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
