/**
 * Filesystem Capture Adapter
 *
 * Allows processing arbitrary video files from the filesystem.
 * Useful for QuickTime screen recordings, downloaded videos, etc.
 */

import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { CaptureSource, Recording, VideoService } from '../0_types.js';

interface FilesystemConfig {
  /** Path to the video file */
  videoPath: string;
}

function expandPath(inputPath: string): string {
  if (inputPath.startsWith('~/')) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    return path.join(homeDir, inputPath.slice(2));
  }
  return inputPath;
}

function sanitizeFilenameToId(filename: string): string {
  // Remove extension
  const baseName = filename.replace(/\.[^/.]+$/, '');

  // Replace spaces and special chars with hyphens, keep only alphanumeric and hyphens
  return baseName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 100);
}

async function parseFilesystemRecording(
  videoPath: string,
  videoService: VideoService
): Promise<Recording> {
  try {
    const stats = await stat(videoPath);
    const capturedAt = stats.mtime;

    // Get video metadata (duration, dimensions)
    const metadata = await videoService.getMetadata(videoPath);

    // Generate recording ID from filename
    const fileName = path.basename(videoPath);
    const recordingId = sanitizeFilenameToId(fileName);

    return {
      id: recordingId,
      source: {
        type: 'raw',
        originalPath: videoPath,
        metadata: {
          filename: fileName,
          size: stats.size,
          duration: metadata.duration,
          width: metadata.width,
          height: metadata.height,
        },
      },
      videoPath: videoPath,
      audioMicPath: null,
      audioSystemPath: null,
      duration: metadata.duration,
      capturedAt,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Video file not found: ${videoPath}`);
    }
    throw new Error(
      `Failed to parse video at ${videoPath}: ${(error as Error).message}`
    );
  }
}

/**
 * Creates a CaptureSource that reads a single video file from the filesystem.
 *
 * @param config - Configuration with video file path
 * @param videoService - Video service for metadata extraction
 * @returns CaptureSource that treats the file as the "latest" recording
 */
export function createFilesystemCaptureSource(
  config: FilesystemConfig,
  videoService: VideoService
): CaptureSource {
  const resolvedPath = expandPath(config.videoPath);

  return {
    getLatestRecording: async (): Promise<Recording | null> => {
      try {
        const recording = await parseFilesystemRecording(
          resolvedPath,
          videoService
        );
        return recording;
      } catch (error) {
        console.error('Failed to load filesystem recording:', error);
        return null;
      }
    },
    listRecordings: async (_limit = 1): Promise<Recording[]> => {
      const recording = await parseFilesystemRecording(
        resolvedPath,
        videoService
      );
      return recording ? [recording] : [];
    },
  };
}
