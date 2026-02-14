/**
 * Escribano - Debug Utilities
 *
 * Utilities for saving debug artifacts (VLM responses, frame copies) during processing.
 */

import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path, { dirname } from 'node:path';

const DEBUG_ENABLED = process.env.ESCRIBANO_DEBUG_VLM === 'true';
const DEBUG_DIR = path.join(homedir(), '.escribano', 'debug');

/**
 * Initialize debug directory for a recording.
 */
export async function initDebugDir(recordingId: string): Promise<string> {
  if (!DEBUG_ENABLED) return '';

  const debugPath = path.join(DEBUG_DIR, recordingId);
  const responsesPath = path.join(debugPath, 'vlm-responses');
  const framesPath = path.join(debugPath, 'frames');

  await mkdir(responsesPath, { recursive: true });
  await mkdir(framesPath, { recursive: true });

  return debugPath;
}

/**
 * Save a VLM response to disk.
 */
export async function saveVlmResponse(
  recordingId: string,
  batchIndex: number,
  response: unknown
): Promise<void> {
  if (!DEBUG_ENABLED) return;

  const filePath = path.join(
    DEBUG_DIR,
    recordingId,
    'vlm-responses',
    `batch-${String(batchIndex).padStart(3, '0')}-response.json`
  );

  // Create parent directories if they don't exist
  await mkdir(dirname(filePath), { recursive: true });

  await writeFile(filePath, JSON.stringify(response, null, 2), 'utf-8');
}

/**
 * Copy sampled frames to debug directory with batch naming.
 */
export async function copyFramesForDebug(
  recordingId: string,
  batchIndex: number,
  frames: Array<{ imagePath: string; timestamp: number; index: number }>
): Promise<void> {
  if (!DEBUG_ENABLED) return;

  const batchFramesDir = path.join(
    DEBUG_DIR,
    recordingId,
    'frames',
    `batch-${String(batchIndex).padStart(3, '0')}`
  );

  await mkdir(batchFramesDir, { recursive: true });

  for (const frame of frames) {
    const destFileName = `frame-${String(frame.index).padStart(3, '0')}-t${frame.timestamp.toFixed(1)}.jpg`;
    const destPath = path.join(batchFramesDir, destFileName);

    try {
      await copyFile(frame.imagePath, destPath);
    } catch (error) {
      console.warn(
        `[Debug] Failed to copy frame ${frame.imagePath}:`,
        (error as Error).message
      );
    }
  }
}
