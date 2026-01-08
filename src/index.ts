/**
 * Escribano CLI Entry Point
 *
 * Transcribes Cap recordings using whisper.cpp.
 */

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { createCapSource } from './adapters/cap.adapter.js';
import { createWhisperTranscriber } from './adapters/whisper.adapter.js';
import { processSession } from './actions/process-session.js';
import type { Recording } from './0_types.js';

const MODELS_DIR = path.join(os.homedir(), '.escribano', 'models');
const MODEL_FILE = 'ggml-large-v3.bin';
const MODEL_PATH = path.join(MODELS_DIR, MODEL_FILE);
const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/' + MODEL_FILE;

interface ParsedArgs {
  command: string;
  limit: number;
  recordingId?: string;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  try {
    switch (args.command) {
      case 'list':
        executeList(args.limit);
        break;

      case 'transcribe-latest':
        executeTranscribeLatest(args);
        break;

      case 'transcribe':
        executeTranscribeById(args);
        break;

      default:
        showHelp();
        process.exit(1);
    }
  } catch (error) {
    console.error('Error:', (error as Error).message);
    console.error((error as Error).stack);
    process.exit(1);
  }
}

function parseArgs(argsArray: string[]): ParsedArgs {
  if (argsArray.length === 0) {
    return { command: 'help', limit: 10 };
  }

  const command = argsArray[0];

  switch (command) {
    case 'list':
      return {
        command: 'list',
        limit: argsArray[1] ? parseInt(argsArray[1]) : 10,
        recordingId: undefined
      };

    case 'transcribe-latest':
      return { command: 'transcribe-latest', limit: 10 };

    case 'transcribe':
      if (argsArray.length < 2) {
        return { command: 'help', limit: 10 };
      }
      return {
        command: 'transcribe',
        recordingId: argsArray[1],
        limit: 10
      };

    default:
      return { command: 'help', limit: 10 };
  }
}

async function executeList(limit: number): Promise<void> {
  console.log('Fetching Cap recordings...');

  const capSource = createCapSource({});
  const recordings = await capSource.listRecordings(limit);

  if (recordings.length === 0) {
    console.log('No recordings found.');
    return;
  }

  console.log('Found ' + recordings.length + ' recordings:\n');

  recordings.forEach((recording, index) => {
    console.log('='.repeat(60));
    console.log('[' + (index + 1) + '] ' + recording.id);
    console.log('');
    console.log('  Captured:  ' + formatDate(recording.capturedAt));
    console.log('  Duration:   ' + formatDuration(recording.duration));
    console.log('  Audio:      ' + recording.audioPath);
    if (recording.videoPath) {
      console.log('  Video:      ' + recording.videoPath);
    }
  });
}

async function executeTranscribeLatest(args: ParsedArgs): Promise<void> {
  await ensureModel();

  console.log('Fetching latest Cap recording...');

  const capSource = createCapSource();
  const recording = await capSource.getLatestRecording();

  if (recording === null) {
    console.error('No recordings found.');
    process.exit(1);
  }

  await transcribeRecording(recording);
}

async function executeTranscribeById(args: ParsedArgs): Promise<void> {
  if (!args.recordingId) {
    console.error('Recording ID required');
    process.exit(1);
  }

  await ensureModel();

  console.log('Searching for recording: ' + args.recordingId);

  const capSource = createCapSource();
  const recordings = await capSource.listRecordings(100);

  const recording = recordings.find((r) => r.id === args.recordingId);

  if (recording === undefined) {
    console.error('Recording not found: ' + args.recordingId);
    console.log('Use "escribano list" to see available recordings.');
    process.exit(1);
  }

  await transcribeRecording(recording);
}

async function ensureModel(): Promise<void> {
  if (!existsSync(MODELS_DIR)) {
    await mkdir(MODELS_DIR, { recursive: true });
  }

  if (!existsSync(MODEL_PATH)) {
    console.log('Model not found. Downloading...');
    console.log('From: ' + MODEL_URL);
    console.log('To:   ' + MODEL_PATH);
    console.log('');

    await downloadModel();

    console.log('\nModel downloaded successfully!');
  } else {
    console.log('Model already downloaded.');
  }
}

function downloadModel(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('curl', [
      '-L',
      '--progress-bar',
      '-o', MODEL_PATH,
      MODEL_URL,
    ]);

    child.stdout.on('data', (data) => {
      process.stdout.write(data);
    });

    child.stderr.on('data', (data) => {
      process.stderr.write(data);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error('Download failed with code ' + code));
      }
    });

    child.on('error', reject);
  });
}

async function transcribeRecording(recording: Recording): Promise<void> {
  console.log('\nTranscribing: ' + recording.id);
  console.log('Captured:  ' + formatDate(recording.capturedAt));
  console.log('Duration:   ' + formatDuration(recording.duration) + 's');
  console.log('Audio:      ' + recording.audioPath);
  console.log('');

  const transcriber = createWhisperTranscriber({
    binaryPath: 'whisper-cli',
    model: MODEL_PATH,
    cwd: MODELS_DIR,
    outputFormat: 'json',
  });

  const session = await processSession(recording, transcriber);

  console.log('\n' + JSON.stringify(session, null, 2));
}

function formatDate(date: Date): string {
  const isoDate = date.toISOString().split('T')[0];
  const timePart = date.toTimeString().split(' ')[0];
  return isoDate + ' ' + timePart;
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return minutes + 'm ' + secs + 's';
}

function showHelp(): void {
  console.log('');
  console.log('Escribano - Session Intelligence Tool');
  console.log('');
  console.log('Usage:');
  console.log('  escribano list [limit]                    List recordings (default: 10)');
  console.log('  escribano transcribe-latest                Transcribe most recent');
  console.log('  escribano transcribe <id>                 Transcribe by ID');
  console.log('');
  console.log('Examples:');
  console.log('  escribano list');
  console.log('  escribano list 20');
  console.log('  escribano transcribe-latest');
  console.log('  escribano transcribe "Display 2025-01-08"');
  console.log('');
  console.log('Prerequisites:');
  console.log('  whisper-cli: brew install whisper-cpp');
  console.log('  Cap: https://cap.so');
  console.log('');
}

main();
