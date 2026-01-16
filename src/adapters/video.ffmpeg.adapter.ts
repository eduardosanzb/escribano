/**
 * FFmpeg Adapter
 *
 * Handles video manipulation using FFmpeg CLI.
 * Used for extracting screenshots and detecting scene changes.
 */

import { exec } from 'node:child_process';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { VideoService } from '../0_types.js';

const execAsync = promisify(exec);

/**
 * Creates a VideoService that uses FFmpeg CLI
 */
export function createFfmpegVideoService(): VideoService {
  return {
    /**
     * Extract frames at specific timestamps.
     * High quality extraction using -q:v 2.
     */
    extractFrames: async (videoPath, timestamps, outputDir) => {
      await mkdir(outputDir, { recursive: true });
      const outputPaths: string[] = [];

      for (const timestamp of timestamps) {
        // Format timestamp for filename (e.g., 123.45 -> 000123_450)
        const seconds = Math.floor(timestamp);
        const ms = Math.floor((timestamp - seconds) * 1000);
        const formattedTime = `${seconds.toString().padStart(6, '0')}_${ms.toString().padStart(3, '0')}`;
        const fileName = `frame_${formattedTime}.jpg`;
        const outputPath = path.join(outputDir, fileName);

        // -ss before -i is significantly faster for large files (input seeking)
        // -vframes 1 ensures we only extract one frame
        const command = `ffmpeg -ss ${timestamp} -i "${videoPath}" -vframes 1 -q:v 2 "${outputPath}" -y`;

        try {
          await execAsync(command);
          outputPaths.push(outputPath);
        } catch (error) {
          console.warn(
            `Failed to extract frame at ${timestamp}s: ${(error as Error).message}`
          );
          // Continue with other timestamps even if one fails
        }
      }

      return outputPaths;
    },

    /**
     * Detect significant scene changes and extract frames.
     * Useful for silent sessions where we want to capture moments of activity.
     */
    detectAndExtractScenes: async (videoPath, _threshold, outputDir) => {
      await mkdir(outputDir, { recursive: true });

      const frameInterval = Number(process.env.ESCRIBANO_FRAME_INTERVAL) || 2;
      const frameWidth = Number(process.env.ESCRIBANO_FRAME_WIDTH) || 1920;

      // Robust strategy for Visual Log:
      // We use a combination of periodic sampling and resolution scaling.
      // This is more reliable across different video formats than pure scene detection.
      // 1. scale=${frameWidth}:-2: Optimize for AI reasoning
      // 2. fps=1/${frameInterval}: Configurable frame rate
      // 3. -strict unofficial: Compatibility for screen recordings
      const command = `ffmpeg -i "${videoPath}" -vf "scale=${frameWidth}:-2,fps=1/${frameInterval}" -strict unofficial -an -q:v 2 "${outputDir}/scene_%04d.jpg" -y`;

      try {
        await execAsync(command);

        // List generated files
        const files = await readdir(outputDir);
        const framePaths = files
          .filter((f) => f.startsWith('scene_') && f.endsWith('.jpg'))
          .map((f) => path.join(outputDir, f))
          .sort();

        // Calculate timestamps based on configured interval
        return framePaths.map((p, i) => ({
          imagePath: p,
          timestamp: i * frameInterval,
        }));
      } catch (error) {
        throw new Error(
          `Visual log extraction failed: ${(error as Error).message}`
        );
      }
    },

    /**
     * Get video metadata using ffprobe
     */
    getMetadata: async (videoPath) => {
      // -show_entries allows selective extraction of metadata
      // -of json returns machine-readable format
      const command = `ffprobe -v error -show_entries format=duration -show_entries stream=width,height -of json "${videoPath}"`;

      try {
        const { stdout } = await execAsync(command);
        const data = JSON.parse(stdout);

        const duration = data.format?.duration
          ? Number.parseFloat(data.format.duration)
          : 0;
        const videoStream = data.streams?.find(
          (s: { width: number; height: number }) => s.width && s.height
        );

        return {
          duration,
          width: videoStream?.width || 0,
          height: videoStream?.height || 0,
        };
      } catch (error) {
        throw new Error(
          `Failed to get video metadata: ${(error as Error).message}`
        );
      }
    },

    /**
     * Run visual indexing (OCR + CLIP) using the Python base script.
     */
    runVisualIndexing: async (framesDir, outputPath) => {
      const scriptPath = path.join(
        process.cwd(),
        'src',
        'scripts',
        'visual_observer_base.py'
      );
      const frameInterval = Number(process.env.ESCRIBANO_FRAME_INTERVAL) || 2;
      // Use uv run to execute the script with its environment
      const command = `uv run "${scriptPath}" --frames-dir "${framesDir}" --output "${outputPath}" --frame-interval ${frameInterval}`;

      try {
        await execAsync(command, {
          cwd: path.join(process.cwd(), 'src', 'scripts'),
        });
        const content = await readFile(outputPath, 'utf-8');
        return JSON.parse(content);
      } catch (error) {
        throw new Error(`Visual indexing failed: ${(error as Error).message}`);
      }
    },
  };
}
