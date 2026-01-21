/**
 * Whisper Adapter
 *
 * Transcribes audio using whisper.cpp or OpenAI's whisper CLI.
 * Shells out to the whisper binary for simplicity.
 *
 * Prerequisites:
 * - whisper.cpp installed: brew install whisper-cpp
 * - ffmpeg installed: brew install ffmpeg (for audio format conversion)
 * - Or Python whisper: pip install openai-whisper
 */

import { exec } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import { promisify } from 'node:util';
import type {
  Transcript,
  TranscriptionService,
  WhisperConfig,
} from '../0_types.js';

const execAsync = promisify(exec);

const HALLUCINATION_PATTERNS = [
  /untertitel.*amara\.org/i,
  /www\.amara\.org/i,
  /thanks for watching/i,
  /please subscribe/i,
  /like and subscribe/i,
  /(.{20,})\1{4,}/, // Repetition loops
];

export function filterHallucinations(text: string): string {
  let filtered = text;
  for (const pattern of HALLUCINATION_PATTERNS) {
    filtered = filtered.replace(pattern, '');
  }
  return filtered.trim();
}

async function convertToWavIfNeeded(audioPath: string): Promise<string> {
  const ext = audioPath.toLowerCase().split('.').pop();

  if (['wav', 'flac', 'mp3'].includes(ext || '')) {
    return audioPath;
  }

  const outputPath = `${audioPath}.converted.wav`;

  try {
    console.log(`Converting ${audioPath} to WAV format...`);
    await execAsync(
      `ffmpeg -i "${audioPath}" -f wav -ar 16000 -ac 1 "${outputPath}" -y`,
      { timeout: 10 * 60 * 1000 }
    );
    console.log(`Conversion complete: ${outputPath}`);
    return outputPath;
  } catch (error) {
    console.error(`Audio conversion failed for ${audioPath}`);
    throw new Error(
      `Failed to convert audio to WAV: ${(error as Error).message}`
    );
  }
}

// Whisper JSON output format (from whisper.cpp)
interface WhisperJsonOutput {
  transcription: Array<{
    timestamps: {
      from: string; // "00:00:00,000"
      to: string;
    };
    offsets: {
      from: number; // milliseconds
      to: number;
    };
    text: string;
  }>;
}

/**
 * Creates a TranscriptionService that uses whisper CLI
 */
export function createWhisperTranscriptionService(
  config: Partial<WhisperConfig> = {}
): TranscriptionService {
  const resolvedConfig: WhisperConfig = {
    binaryPath: config.binaryPath ?? 'whisper-cpp',
    model: config.model ?? 'base',
    outputFormat: config.outputFormat ?? 'json',
    language: config.language,
  };

  return {
    transcribe: (audioPath) => transcribeWithWhisper(audioPath, resolvedConfig),
    transcribeSegment: async (audioPath) => {
      try {
        const transcript = await transcribeWithWhisper(
          audioPath,
          resolvedConfig,
          { silent: true }
        );
        if (!transcript || !transcript.fullText) {
          return '';
        }
        return filterHallucinations(transcript.fullText);
      } catch (error) {
        console.warn(
          `Whisper segment transcription failed: ${(error as Error).message}`
        );
        return '';
      }
    },
  };
}

/**
 * Transcribe audio file using whisper CLI
 */
async function transcribeWithWhisper(
  audioPath: string,
  config: WhisperConfig,
  options?: { silent?: boolean }
): Promise<Transcript> {
  const audioToProcess = await convertToWavIfNeeded(audioPath);

  const args = [
    `-m ${config.model}`,
    `-f "${audioToProcess}"`,
    '-oj', // Output JSON
    config.language ? `-l ${config.language}` : '',
  ].filter(Boolean);

  const command = `${config.binaryPath} ${args.join(' ')}`;

  try {
    let tick: NodeJS.Timeout | undefined;
    if (!options?.silent) {
      tick = setInterval(() => {
        process.stdout.write('.');
      }, 30000); // Print a dot every 30 seconds to indicate progress
    }

    const { stdout, stderr } = await execAsync(command, {
      cwd: config.cwd,
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large transcripts
      timeout: 10 * 60 * 1000, // 10 minute timeout
    });

    if (tick) {
      clearInterval(tick);
      process.stdout.write('\n');
    }

    const hasError =
      stderr.includes('error:') ||
      stderr.includes('Error:') ||
      stderr.includes('failed to');

    if (hasError) {
      if (audioToProcess !== audioPath) {
        await unlink(audioToProcess).catch(() => {});
      }
      throw new Error(`Whisper transcription failed:\n${stderr}`);
    }

    // whisper-cpp outputs JSON to a file named <input>.json
    const jsonOutputPath = `${audioToProcess}.json`;

    try {
      const jsonContent = await readFile(jsonOutputPath, 'utf-8');
      const whisperOutput: WhisperJsonOutput = JSON.parse(jsonContent);

      // Clean up the temp JSON file and converted audio
      await unlink(jsonOutputPath).catch(() => {});
      if (audioToProcess !== audioPath) {
        await unlink(audioToProcess).catch(() => {});
      }

      return parseWhisperOutput(whisperOutput);
    } catch {
      // Fallback: try to parse stdout as the transcript
      return parseWhisperStdout(stdout);
    }
  } catch (error) {
    if (audioToProcess && audioToProcess !== audioPath) {
      await unlink(audioToProcess).catch(() => {});
    }
    throw new Error(
      `Whisper transcription failed: ${(error as Error).message}`
    );
  }
}

/**
 * Parse whisper.cpp JSON output into our Transcript format
 */
function parseWhisperOutput(output: WhisperJsonOutput): Transcript {
  const segments = output.transcription.map((seg, index) => ({
    id: `seg-${index}`,
    start: seg.offsets.from / 1000, // Convert ms to seconds
    end: seg.offsets.to / 1000,
    text: seg.text.trim(),
    speaker: null,
  }));

  const fullText = segments.map((s) => s.text).join(' ');
  const duration = segments.length > 0 ? segments[segments.length - 1].end : 0;

  return {
    fullText,
    segments,
    language: 'en', // whisper.cpp doesn't always report language in JSON
    duration,
  };
}

/**
 * Fallback: parse whisper stdout (plain text with timestamps)
 */
function parseWhisperStdout(stdout: string): Transcript {
  // Example format: "[00:00:00.000 --> 00:00:05.000] Hello world"
  const lines = stdout.split('\n').filter((l) => l.trim());
  const segments: Transcript['segments'] = [];

  const timestampRegex =
    /\[(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})\]\s*(.*)/;

  for (const line of lines) {
    const match = line.match(timestampRegex);
    if (match) {
      const [, startStr, endStr, text] = match;
      segments.push({
        id: `seg-${segments.length}`,
        start: parseTimestamp(startStr),
        end: parseTimestamp(endStr),
        text: text.trim(),
        speaker: null,
      });
    }
  }

  // If no timestamps found, treat entire output as single segment
  if (segments.length === 0 && stdout.trim()) {
    segments.push({
      id: 'seg-0',
      start: 0,
      end: 0,
      text: stdout.trim(),
      speaker: null,
    });
  }

  const fullText = segments.map((s) => s.text).join(' ');
  const duration = segments.length > 0 ? segments[segments.length - 1].end : 0;

  return {
    fullText,
    segments,
    language: 'en',
    duration,
  };
}

/**
 * Parse timestamp string "00:00:00.000" to seconds
 */
function parseTimestamp(timestamp: string): number {
  const [hours, minutes, rest] = timestamp.split(':');
  const [seconds, ms] = rest.split('.');
  return (
    parseInt(hours, 10) * 3600 +
    parseInt(minutes, 10) * 60 +
    parseInt(seconds, 10) +
    parseInt(ms, 10) / 1000
  );
}
