/**
 * Cap Adapter - Fixed
 *
 * Reads recordings from Cap (https://cap.so).
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
/**
 * Create a source for Cap recordings.
 */
export function createCapSource(config = {}) {
    const recordingsPath = expandPath(config.recordingsPath);
    const innerList = async function (limit = 10) {
        try {
            const entries = await readdir(recordingsPath, { withFileTypes: true });
            // Filter for .cap directories
            const capDirs = entries.filter((entry) => entry.isDirectory() && entry.name.endsWith('.cap'));
            // Parse each recording
            const recordings = await Promise.all(capDirs.map((dir) => parseCapRecording(join(recordingsPath, dir.name))));
            // Filter nulls, sort by date, limit
            return recordings
                .filter((r) => r !== null)
                .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())
                .slice(0, limit);
        }
        catch (error) {
            console.error(`Failed to list Cap recordings: ${error}`);
            return [];
        }
    };
    return {
        getLatestRecording: async () => {
            const recordings = await innerList(1);
            return recordings[0] ?? null;
        },
        listRecordings: innerList,
    };
}
/**
 * Parse a single .cap directory into a Recording
 * TODO: document here the structure of Cap recordings
 */
async function parseCapRecording(capDirPath) {
    try {
        // Read recording-meta.json if it exists
        const metaPath = join(capDirPath, 'recording-meta.json');
        let meta = {};
        try {
            const metaContent = await readFile(metaPath, 'utf-8');
            meta = JSON.parse(metaContent);
        }
        catch {
            // No meta file, continue without it
        }
        // Find audio file in content/segments/segment-0/
        // TODO: why only segment-0? Multiple segments?
        const segmentPath = join(capDirPath, 'content', 'segments', 'segment-0');
        const audioPath = await findAudioFile(segmentPath);
        if (!audioPath) {
            console.warn(`No audio found in ${capDirPath}`);
            return null;
        }
        // Find video file (optional)
        const videoPath = await findVideoFile(segmentPath);
        // Get directory creation time as capture date
        const dirStat = await stat(capDirPath);
        const capturedAt = dirStat.birthtime;
        // Extract ID from directory name (remove .cap suffix)
        const dirName = capDirPath.split('/').pop() ?? '';
        const id = dirName.replace('.cap', '');
        // Get audio duration (we'll estimate from file size for now)
        const audioStat = await stat(audioPath);
        const estimatedDuration = estimateDurationFromFileSize(audioStat.size, audioPath);
        return {
            id,
            source: {
                type: 'cap',
                originalPath: capDirPath,
                metadata: {
                    prettyName: meta.pretty_name,
                    sharingLink: meta.sharing?.link,
                    sharingId: meta.sharing?.id,
                    status: meta.status?.status,
                },
            },
            videoPath,
            audioPath,
            duration: estimatedDuration,
            capturedAt,
        };
    }
    catch (error) {
        console.error(`Failed to parse Cap recording at ${capDirPath}: ${error}`);
        return null;
    }
}
/**
 * Find audio file in segment directory
 */
async function findAudioFile(segmentPath) {
    try {
        const entries = await readdir(segmentPath);
        // Cap uses .ogg for audio, but check other formats too
        const audioFile = entries.find((f) => f.endsWith('.ogg') ||
            f.endsWith('.mp3') ||
            f.endsWith('.wav') ||
            f.endsWith('.m4a') ||
            f.startsWith('audio-input'));
        return audioFile ? join(segmentPath, audioFile) : null;
    }
    catch {
        return null;
    }
}
/**
 * Find video file in segment directory
 */
async function findVideoFile(segmentPath) {
    try {
        const entries = await readdir(segmentPath);
        const videoFile = entries.find((f) => f.endsWith('.mp4') || f.endsWith('.webm') || f.endsWith('.mov'));
        return videoFile ? join(segmentPath, videoFile) : null;
    }
    catch {
        return null;
    }
}
/**
 * Expand ~ to home directory
 */
function expandPath(path) {
    if (path === undefined || path === null || path === '') {
        throw new Error('Cap recordings path is required. Please specify config.recordingsPath or ensure Cap is installed.');
    }
    if (path.startsWith('~')) {
        return join(homedir(), path.slice(1));
    }
    return path;
}
/**
 * Rough estimate of audio duration from file size
 * Different estimates for different formats
 */
function estimateDurationFromFileSize(bytes, filePath) {
    // OGG at ~96kbps = ~12KB/s
    // MP3 at ~128kbps = ~16KB/s
    const isOgg = filePath.endsWith('.ogg');
    const bytesPerSecond = isOgg ? 12 * 1024 : 16 * 1024;
    return Math.round(bytes / bytesPerSecond);
}
