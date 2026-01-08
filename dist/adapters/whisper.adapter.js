/**
 * Whisper Adapter
 *
 * Transcribes audio using whisper.cpp or OpenAI's whisper CLI.
 * Shells out to the whisper binary for simplicity.
 *
 * Prerequisites:
 * - whisper.cpp installed: brew install whisper-cpp
 * - Or Python whisper: pip install openai-whisper
 */
import { exec } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import { promisify } from 'node:util';
const execAsync = promisify(exec);
/**
 * Creates a TranscriptionService that uses whisper CLI
 */
export function createWhisperTranscriber(config = {}) {
    const resolvedConfig = {
        binaryPath: config.binaryPath ?? 'whisper-cpp',
        model: config.model ?? 'base',
        outputFormat: config.outputFormat ?? 'json',
        language: config.language,
    };
    return {
        transcribe: (audioPath) => transcribeWithWhisper(audioPath, resolvedConfig),
    };
}
/**
 * Transcribe audio file using whisper CLI
 */
async function transcribeWithWhisper(audioPath, config) {
    const args = [
        `-m ${config.model}`,
        `-f "${audioPath}"`,
        '-oj', // Output JSON
        config.language ? `-l ${config.language}` : '',
    ].filter(Boolean);
    const command = `${config.binaryPath} ${args.join(' ')}`;
    console.log(`Running: ${command}`);
    try {
        const { stdout, stderr } = await execAsync(command, {
            cwd: config.cwd,
            maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large transcripts
            timeout: 10 * 60 * 1000, // 10 minute timeout
        });
        if (stderr && !stderr.includes('whisper_')) {
            console.warn(`Whisper stderr: ${stderr}`);
        }
        // whisper-cpp outputs JSON to a file named <input>.json
        const jsonOutputPath = `${audioPath}.json`;
        try {
            const jsonContent = await readFile(jsonOutputPath, 'utf-8');
            const whisperOutput = JSON.parse(jsonContent);
            // Clean up the temp JSON file
            await unlink(jsonOutputPath).catch(() => { });
            return parseWhisperOutput(whisperOutput);
        }
        catch {
            // Fallback: try to parse stdout as the transcript
            console.warn('Could not read JSON output, falling back to stdout parsing');
            return parseWhisperStdout(stdout);
        }
    }
    catch (error) {
        throw new Error(`Whisper transcription failed: ${error}`);
    }
}
/**
 * Parse whisper.cpp JSON output into our Transcript format
 */
function parseWhisperOutput(output) {
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
function parseWhisperStdout(stdout) {
    // Example format: "[00:00:00.000 --> 00:00:05.000] Hello world"
    const lines = stdout.split('\n').filter((l) => l.trim());
    const segments = [];
    const timestampRegex = /\[(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})\]\s*(.*)/;
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
function parseTimestamp(timestamp) {
    const [hours, minutes, rest] = timestamp.split(':');
    const [seconds, ms] = rest.split('.');
    return (parseInt(hours, 10) * 3600 +
        parseInt(minutes, 10) * 60 +
        parseInt(seconds, 10) +
        parseInt(ms, 10) / 1000);
}
