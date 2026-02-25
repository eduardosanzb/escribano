/**
 * FFmpeg Adapter
 *
 * Handles video manipulation using FFmpeg CLI.
 * Used for extracting screenshots and detecting scene changes.
 */

import { type ChildProcess, exec, spawn } from 'node:child_process';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { VideoService } from '../0_types.js';
import type { ResourceTrackable } from '../stats/types.js';
import { debugLog } from './intelligence.ollama.adapter.js';

const execAsync = promisify(exec);

// Scene detection configuration (with env var overrides)
// Lower threshold = more sensitive = more scene changes detected
// Examples: 0.3 (sensitive), 0.4 (default), 0.5 (conservative)
const SCENE_THRESHOLD = Number(process.env.ESCRIBANO_SCENE_THRESHOLD) || 0.4;

// Minimum seconds between detected scene changes
// Prevents rapid-fire scene changes from generating too many frames
const SCENE_MIN_INTERVAL =
  Number(process.env.ESCRIBANO_SCENE_MIN_INTERVAL) || 2;

/**
 * Creates a VideoService that uses FFmpeg CLI
 */
export function createFfmpegVideoService(): VideoService & ResourceTrackable {
  let currentProcess: ChildProcess | null = null;
  return {
    /**
     * Extract frames at specific timestamps.
     * @deprecated Use extractFramesAtTimestampsBatch for parallel extraction with progress logging.
     */
    extractFramesAtTimestamps: async (videoPath, timestamps, outputDir) => {
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
     * Extract frames at regular intervals.
     * @deprecated Use extractFramesAtTimestampsBatch + calculateRequiredTimestamps for smart extraction.
     *             This method extracts ALL frames, which is inefficient for long recordings.
     */
    extractFramesAtInterval: async (videoPath, _threshold, outputDir) => {
      // Clean directory first (removes stale frames from previous runs)
      await rm(outputDir, { recursive: true, force: true });
      await mkdir(outputDir, { recursive: true });

      const frameInterval = Number(process.env.ESCRIBANO_FRAME_INTERVAL) || 2;
      const frameWidth = Number(process.env.ESCRIBANO_FRAME_WIDTH) || 1920;

      // Get expected frame count for progress calculation
      let expectedFrames = 0;
      try {
        const probeCmd = `ffprobe -v error -show_entries format=duration -of json "${videoPath}"`;
        const { stdout } = await execAsync(probeCmd);
        const data = JSON.parse(stdout);
        const duration = Number.parseFloat(data.format?.duration || '0');
        if (duration > 0) {
          expectedFrames = Math.ceil(duration / frameInterval);
          console.log(
            `Expected frames: ${expectedFrames} (duration: ${Math.round(duration)}s, interval: ${frameInterval}s)`
          );
        }
      } catch {
        console.warn(
          'Could not get video metadata, progress will show frame count only'
        );
      }

      // Build FFmpeg command with clear sections
      const ffmpegParts = [
        'ffmpeg',
        '-progress pipe:2', // Structured progress output to stderr
        '-hwaccel videotoolbox', // M4 hardware acceleration
        `-i "${videoPath}"`, // Input file
        `-vf "scale=${frameWidth}:-2,fps=1/${frameInterval}"`, // Scale + FPS filter
        '-an -q:v 5', // No audio, JPEG quality 5
        `"${outputDir}/scene_%04d.jpg"`, // Output pattern
        '-y', // Overwrite
      ];
      const command = ffmpegParts.join(' ');
      debugLog(`Running frame extraction: ${command}`);

      try {
        currentProcess = spawn('sh', ['-c', command]);

        await new Promise<void>((resolve, reject) => {
          let lastLoggedPercent = 0;
          let firstProgressLogged = false;

          currentProcess?.stderr?.on('data', (data) => {
            const output = data.toString();
            const frameMatch = output.match(/frame=(\d+)/);
            const fpsMatch = output.match(/fps=\s*([\d.]+)/);

            if (frameMatch && expectedFrames > 0) {
              const frames = parseInt(frameMatch[1], 10);
              const percent = Math.floor((frames / expectedFrames) * 100);

              // log on the first frame and then every 5% increment
              if (!firstProgressLogged) {
                firstProgressLogged = true;
                console.log(`Extracting frames: 0/${expectedFrames} (0%)`);
              }
              if (percent - lastLoggedPercent >= 5) {
                lastLoggedPercent = percent;

                let etaStr = '';
                if (fpsMatch) {
                  const fps = parseFloat(fpsMatch[1]);
                  if (fps > 0) {
                    const remainingFrames = expectedFrames - frames;
                    const etaSeconds = Math.ceil(remainingFrames / fps);
                    etaStr = ` - ETA: ${etaSeconds}s`;
                  }
                }

                console.log(
                  `Extracting frames: ${frames}/${expectedFrames} (${percent}%)${etaStr}`
                );
              }
            }
          });

          currentProcess?.on('close', (code) => {
            currentProcess = null;
            if (code === 0) {
              if (expectedFrames > 0) {
                console.log(
                  `Extracting frames: ${expectedFrames}/${expectedFrames} (100%)`
                );
              }
              resolve();
            } else {
              reject(new Error(`Frame extraction failed with code ${code}`));
            }
          });

          currentProcess?.on('error', (err) => {
            currentProcess = null;
            reject(err);
          });
        });

        const files = await readdir(outputDir);
        const framePaths = files
          .filter((f) => f.startsWith('scene_') && f.endsWith('.jpg'))
          .map((f) => path.join(outputDir, f))
          .sort();

        console.log(`Extracted ${framePaths.length} frames`);
        return framePaths.map((p, i) => ({
          imagePath: p,
          timestamp: i * frameInterval,
        }));
      } catch (error) {
        currentProcess = null;
        throw new Error(
          `Visual log extraction failed: ${(error as Error).message}`
        );
      }
    },

    /**
     * Extract frames at specific timestamps efficiently.
     * Uses parallel batch extraction with progress logging.
     *
     * This is the preferred method for smart extraction:
     * 1. Run scene detection first
     * 2. Calculate required timestamps via frame-sampling.calculateRequiredTimestamps()
     * 3. Extract only those frames (not all frames)
     *
     * @param videoPath - Path to source video
     * @param timestamps - Array of timestamps (in seconds) to extract
     * @param outputDir - Directory to save extracted frames
     * @param concurrency - Number of parallel extractions (default: 4)
     *
     * @example
     * // Extract frames at 0s, 10s, 20s, 30s with 4 parallel workers
     * const frames = await extractFramesAtTimestampsBatch(
     *   '/path/to/video.mp4',
     *   [0, 10, 20, 30],
     *   '/tmp/frames',
     *   4
     * );
     * // Returns: [{ imagePath: '/tmp/frames/frame_000000.jpg', timestamp: 0 }, ...]
     */
    extractFramesAtTimestampsBatch: async (
      videoPath,
      timestamps,
      outputDir,
      concurrency = 4
    ) => {
      // Clean and create output directory
      await rm(outputDir, { recursive: true, force: true });
      await mkdir(outputDir, { recursive: true });

      const frameWidth = Number(process.env.ESCRIBANO_FRAME_WIDTH) || 1920;
      const total = timestamps.length;
      const results: Array<{ imagePath: string; timestamp: number }> = [];

      if (total === 0) {
        console.log('No frames to extract');
        return results;
      }

      console.log(`Extracting ${total} frames at specific timestamps...`);
      console.log(`Output directory: ${outputDir}`);

      const startTime = Date.now();
      let lastLoggedPercent = 0;

      // Process in batches of `concurrency`
      for (let i = 0; i < timestamps.length; i += concurrency) {
        const batch = timestamps.slice(i, i + concurrency);

        const promises = batch.map(async (timestamp, batchIndex) => {
          const frameIndex = i + batchIndex;
          const fileName = `frame_${frameIndex.toString().padStart(6, '0')}.jpg`;
          const outputPath = path.join(outputDir, fileName);

          // Build FFmpeg command with clear sections
          // -ss before -i for fast seeking (input seeking vs output seeking)
          const ffmpegParts = [
            'ffmpeg',
            '-ss',
            String(timestamp), // Seek position (before -i for speed)
            '-hwaccel videotoolbox', // M4 hardware acceleration
            `-i "${videoPath}"`, // Input file
            '-vframes 1', // Extract single frame
            `-vf "scale=${frameWidth}:-2"`, // Scale width, auto height
            '-q:v 5', // JPEG quality (2=best, 31=worst)
            `"${outputPath}"`, // Output file
            '-y', // Overwrite
          ];
          const command = ffmpegParts.join(' ');

          await execAsync(command);
          return { imagePath: outputPath, timestamp };
        });

        const batchResults = await Promise.all(promises);
        results.push(...batchResults);

        // Progress logging with ETA (every 5% or at completion)
        const processed = results.length;
        const percent = Math.floor((processed / total) * 100);

        if (percent - lastLoggedPercent >= 5 || processed === total) {
          lastLoggedPercent = percent;

          // Calculate ETA
          const elapsed = (Date.now() - startTime) / 1000;
          const rate = processed / elapsed; // frames per second
          const remaining = total - processed;
          const etaSeconds = rate > 0 ? Math.ceil(remaining / rate) : 0;

          const etaStr = processed < total ? ` - ETA: ${etaSeconds}s` : '';
          console.log(
            `Extracting frames: ${processed}/${total} (${percent}%)${etaStr}`
          );
        }
      }

      console.log(`Extracted ${results.length} frames`);
      return results.sort((a, b) => a.timestamp - b.timestamp);
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
     * OCR is parallelized across all available CPU cores.
     */
    runVisualIndexing: async (framesDir, outputPath) => {
      const scriptPath = path.join(
        process.cwd(),
        'src',
        'scripts',
        'visual_observer_base.py'
      );
      const frameInterval = Number(process.env.ESCRIBANO_FRAME_INTERVAL) || 2;
      const workers = os.cpus().length;

      // Use uv run to execute the script with its environment
      // --workers enables parallel OCR processing
      const command = `uv run "${scriptPath}" --frames-dir "${framesDir}" --output "${outputPath}" --frame-interval ${frameInterval} --workers ${workers}`;

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

    /**
     * Detect scene changes in video using ffmpeg scene filter.
     * Returns timestamps of significant visual changes.
     *
     * Configuration via environment variables:
     * - ESCRIBANO_SCENE_THRESHOLD: Sensitivity (0.0-1.0, lower=more sensitive)
     * - ESCRIBANO_SCENE_MIN_INTERVAL: Min seconds between scene changes
     */
    detectSceneChanges: async (videoPath, config = {}) => {
      // Use env vars as defaults, allow override via config parameter
      const threshold = config.threshold ?? SCENE_THRESHOLD;
      const minInterval = config.minInterval ?? SCENE_MIN_INTERVAL;

      // Get video duration for progress calculation
      let duration = 0;
      try {
        const probeCmd = `ffprobe -v error -show_entries format=duration -of json "${videoPath}"`;
        const { stdout } = await execAsync(probeCmd);
        const data = JSON.parse(stdout);
        duration = Number.parseFloat(data.format?.duration || '0');
        console.log(
          `Scene detection: analyzing ${Math.round(duration)}s video (threshold=${threshold})`
        );
      } catch {
        console.warn(
          'Could not get video duration, progress will not be shown'
        );
      }

      // Build FFmpeg command with progress output
      const ffmpegParts = [
        'ffmpeg',
        '-hwaccel videotoolbox', // M4 hardware acceleration
        '-progress pipe:2', // Structured progress output to stderr
        `-i "${videoPath}"`, // Input file
        `-vf "select='gt(scene,${threshold})',showinfo"`, // Scene detection filter
        '-vsync vfr', // Variable frame rate output
        '-f null', // Null output format
        '-', // Output to null
      ];
      const command = ffmpegParts.join(' ');
      debugLog(`Running scene detection: ${command}`);

      try {
        currentProcess = spawn('sh', ['-c', command]);

        const timestamps: number[] = [];
        const ptsTimeRegex = /pts_time:(\d+\.?\d*)/g;
        let lastLoggedPercent = 0;

        await new Promise<void>((resolve, reject) => {
          let stderrBuffer = '';

          currentProcess?.stderr?.on('data', (data) => {
            const output = data.toString();
            stderrBuffer += output;

            // Parse progress from out_time_ms
            if (duration > 0) {
              const outTimeMatch = output.match(/out_time_ms=(\d+)/);
              if (outTimeMatch) {
                const outTimeMs = parseInt(outTimeMatch[1], 10);
                const outTimeSec = outTimeMs / 1_000_000;
                const percent = Math.floor((outTimeSec / duration) * 100);

                // Log every 5%
                if (percent - lastLoggedPercent >= 5) {
                  lastLoggedPercent = percent;
                  const remaining = duration - outTimeSec;
                  const etaMin = Math.ceil(remaining / 60);
                  console.log(
                    `Scene detection: ${Math.round(outTimeSec)}s/${Math.round(duration)}s (${percent}%) - ETA: ${etaMin}m`
                  );
                }
              }
            }
          });

          currentProcess?.on('close', (code) => {
            currentProcess = null;

            if (code === 0) {
              // Parse all pts_time values from accumulated stderr
              const matches = stderrBuffer.matchAll(ptsTimeRegex);
              for (const match of matches) {
                const timestamp = Number.parseFloat(match[1] ?? '0');
                if (!Number.isNaN(timestamp) && timestamp > 0) {
                  timestamps.push(timestamp);
                }
              }

              if (duration > 0) {
                console.log(
                  `Scene detection: ${Math.round(duration)}s/${Math.round(duration)}s (100%)`
                );
              }
              console.log(
                `Found ${timestamps.length} scene changes before deduplication`
              );
              resolve();
            } else {
              reject(new Error(`Scene detection failed with code ${code}`));
            }
          });

          currentProcess?.on('error', (err) => {
            currentProcess = null;
            reject(err);
          });
        });

        // Sort and deduplicate (remove timestamps within minInterval of each other)
        const sortedTimestamps = timestamps.sort((a, b) => a - b);
        const deduplicated: number[] = [];

        for (const ts of sortedTimestamps) {
          // Check if this timestamp is at least minInterval seconds after the last one
          const lastTs = deduplicated[deduplicated.length - 1];
          if (lastTs === undefined || ts - lastTs >= minInterval) {
            deduplicated.push(ts);
          }
        }

        console.log(
          `Scene detection complete: ${deduplicated.length} scenes (after ${minInterval}s deduplication)`
        );
        return deduplicated;
      } catch (error) {
        currentProcess = null;
        console.warn(`Scene detection failed: ${(error as Error).message}`);
        return [];
      }
    },

    getResourceName(): string {
      return 'ffmpeg';
    },

    getPid(): number | null {
      return currentProcess?.pid ?? null;
    },
  };
}
