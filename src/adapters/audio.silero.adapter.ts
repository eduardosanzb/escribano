import { type ChildProcess, exec, spawn } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ResourceTrackable } from '../stats/types.js';

const execAsync = promisify(exec);

export interface SpeechSegment {
  start: number;
  end: number;
  audioPath: string;
}

export interface AudioPreprocessor extends ResourceTrackable {
  extractSpeechSegments(
    audioPath: string,
    recordingId: string
  ): Promise<{ segments: SpeechSegment[]; tempDir: string }>;
  cleanup(tempDir: string): Promise<void>;
}

export function createSileroPreprocessor(): AudioPreprocessor {
  let currentProcess: ChildProcess | null = null;

  return {
    extractSpeechSegments: async (audioPath: string, recordingId: string) => {
      const tempDir = path.join(
        os.tmpdir(),
        'escribano',
        recordingId,
        'segments'
      );
      const manifestPath = path.join(tempDir, 'manifest.json');

      await mkdir(tempDir, { recursive: true });

      const inputWavPath = path.join(tempDir, 'input_16k.wav');
      try {
        console.log(`Converting ${audioPath} to 16kHz mono WAV...`);
        await execAsync(
          `ffmpeg -i "${audioPath}" -ar 16000 -ac 1 "${inputWavPath}" -y`
        );
      } catch (error) {
        throw new Error(
          `Failed to pre-convert audio for VAD: ${(error as Error).message}`
        );
      }

      const scriptPath = path.join(
        process.cwd(),
        'src',
        'scripts',
        'audio_preprocessor.py'
      );
      const command = `uv run "${scriptPath}" --audio "${inputWavPath}" --output-dir "${tempDir}" --output-json "${manifestPath}"`;

      try {
        console.log(`Running Silero VAD on ${inputWavPath}...`);

        currentProcess = spawn('sh', ['-c', command]);

        await new Promise<void>((resolve, reject) => {
          currentProcess?.on('close', (code) => {
            currentProcess = null;
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`Silero VAD failed with code ${code}`));
            }
          });
          currentProcess?.on('error', (err) => {
            currentProcess = null;
            reject(err);
          });
        });

        const manifestContent = await readFile(manifestPath, 'utf-8');
        const segments: SpeechSegment[] = JSON.parse(manifestContent);

        return { segments, tempDir };
      } catch (error) {
        currentProcess = null;
        console.error(`Silero VAD failed: ${(error as Error).message}`);
        throw new Error(
          `Failed to extract speech segments: ${(error as Error).message}`
        );
      }
    },

    cleanup: async (tempDir: string) => {
      try {
        await rm(tempDir, { recursive: true, force: true });
        const recordingDir = path.dirname(tempDir);
        await rm(recordingDir).catch(() => {});
      } catch (error) {
        console.warn(
          `Failed to cleanup temp segments: ${(error as Error).message}`
        );
      }
    },

    getResourceName(): string {
      return 'silero-python';
    },

    getPid(): number | null {
      return currentProcess?.pid ?? null;
    },
  };
}
