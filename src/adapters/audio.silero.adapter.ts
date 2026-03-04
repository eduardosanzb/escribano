import { type ChildProcess, exec, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path, { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { ResourceTrackable } from '../stats/types.js';

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));

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

      const scriptPath = resolve(
        __dirname,
        '..',
        '..',
        'src',
        'scripts',
        'audio_preprocessor.py'
      );

      if (!existsSync(scriptPath)) {
        throw new Error(
          `Audio preprocessor script not found at: ${scriptPath}`
        );
      }

      const command = `uv run "${scriptPath}" --audio "${inputWavPath}" --output-dir "${tempDir}" --output-json "${manifestPath}"`;

      try {
        console.log(`Running Silero VAD on ${inputWavPath}...`);
        if (process.env.ESCRIBANO_VERBOSE === 'true') {
          console.log(`  Script path: ${scriptPath}`);
          console.log(`  Script exists: ${existsSync(scriptPath)}`);
          console.log(`  Command: ${command}`);
          console.log(`  Working directory (user): ${process.cwd()}`);
          try {
            const { stdout: uvVersion } = await execAsync('uv --version');
            console.log(`  uv version: ${uvVersion.trim()}`);
          } catch {
            console.log(`  uv version: NOT FOUND`);
          }
        }

        currentProcess = spawn('sh', ['-c', command]);

        let stderr = '';
        let stdout = '';

        if (currentProcess.stderr) {
          currentProcess.stderr.on('data', (data) => {
            stderr += data.toString();
          });
        }

        if (currentProcess.stdout) {
          currentProcess.stdout.on('data', (data) => {
            stdout += data.toString();
          });
        }

        await new Promise<void>((resolve, reject) => {
          currentProcess?.on('close', (code) => {
            currentProcess = null;
            if (code === 0) {
              if (process.env.ESCRIBANO_VERBOSE === 'true' && stdout) {
                console.log(
                  `  Silero VAD stdout:\n${stdout
                    .split('\n')
                    .map((l) => '    ' + l)
                    .join('\n')}`
                );
              }
              resolve();
            } else {
              console.error(
                `  Silero VAD stderr:\n${stderr
                  .split('\n')
                  .map((l) => '    ' + l)
                  .join('\n')}`
              );
              if (stdout) {
                console.error(
                  `  Silero VAD stdout:\n${stdout
                    .split('\n')
                    .map((l) => '    ' + l)
                    .join('\n')}`
                );
              }
              reject(
                new Error(
                  `Silero VAD failed with code ${code}: ${stderr || stdout || 'No output captured'}`
                )
              );
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
