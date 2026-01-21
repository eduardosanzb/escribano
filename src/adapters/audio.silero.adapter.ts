import { exec } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface SpeechSegment {
  start: number;
  end: number;
  audioPath: string;
}

export interface AudioPreprocessor {
  extractSpeechSegments(
    audioPath: string,
    recordingId: string
  ): Promise<{ segments: SpeechSegment[]; tempDir: string }>;
  cleanup(tempDir: string): Promise<void>;
}

export function createSileroPreprocessor(): AudioPreprocessor {
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

      // Pre-convert to WAV 16kHz mono to sidestep Python audio loading issues
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
        await execAsync(command);

        const manifestContent = await readFile(manifestPath, 'utf-8');
        const segments: SpeechSegment[] = JSON.parse(manifestContent);

        return { segments, tempDir };
      } catch (error) {
        console.error(`Silero VAD failed: ${(error as Error).message}`);
        throw new Error(
          `Failed to extract speech segments: ${(error as Error).message}`
        );
      }
    },

    cleanup: async (tempDir: string) => {
      try {
        await rm(tempDir, { recursive: true, force: true });
        // Also try to remove the parent recording dir if empty
        const recordingDir = path.dirname(tempDir);
        await rm(recordingDir).catch(() => {});
      } catch (error) {
        console.warn(
          `Failed to cleanup temp segments: ${(error as Error).message}`
        );
      }
    },
  };
}
