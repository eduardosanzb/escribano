/**
 * Quality Test Batch Processor
 *
 * Processes multiple recordings through the Escribano pipeline
 * with a single MLX bridge instance (no socket conflicts).
 *
 * Usage:
 *   pnpm quality-test                              # Full pipeline + all artifact formats
 *   pnpm quality-test --skip-summary               # Pipeline only (no summary generation)
 *   pnpm quality-test --formats card,standup       # Specific formats (comma-separated)
 *   ARTIFACT_FORMATS=narrative pnpm quality-test   # Use environment variable
 *
 * Formats: card (default), standup, narrative
 *
 * Features:
 * - Adapters initialized ONCE (MLX bridge loads model once)
 * - Continues processing on individual video failures
 * - Generate artifacts in specified formats (default: all three)
 * - Progress tracking with timestamps
 * - Final summary report
 */

import { homedir } from 'node:os';
import path from 'node:path';
import {
  cleanupMlxBridge,
  initializeSystem,
  processVideo,
  type ProcessVideoResult,
} from '../src/batch-context.js';
import { debuglog } from 'node:util';
import { debugLog } from '../src/adapters/intelligence.ollama.adapter.js';
import type { ArtifactFormat } from '../src/actions/generate-artifact-v3.js';
import fs from 'fs';

// we have to find all the *.mov in the desktop
// Video files to process (in order)
const DESKTOP = path.join(homedir(), 'Desktop');
const VIDEOS: string[] = [];
try {
  const files = await fs.promises.readdir(DESKTOP);
  for (const file of files) {
    if (file.toLowerCase().endsWith('.mov')) {
      VIDEOS.push(path.join(DESKTOP, file));
    }
  }
} catch (error) {
  console.error('Error reading desktop directory:', error);
  process.exit(1);
}

if (VIDEOS.length === 0) {
  console.error('No .mov files found on the desktop. Please add videos to process.');
  process.exit(1);
}

debuglog('quality-test')('Videos to process:', VIDEOS);


/**
 * Parse artifact formats from command-line args or environment variable
 * Priority: --formats flag > ARTIFACT_FORMATS env var > default (all)
 */
function getArtifactFormats(): ArtifactFormat[] {
  // Check command-line argument
  const formatsArg = process.argv.find((arg) => arg.startsWith('--formats='));
  if (formatsArg) {
    const formats = formatsArg.split('=')[1].split(',').map((f) => f.trim());
    return formats.filter((f) => ['card', 'standup', 'narrative'].includes(f)) as ArtifactFormat[];
  }

  // Check environment variable
  const envFormats = process.env.ARTIFACT_FORMATS;
  if (envFormats) {
    const formats = envFormats.split(',').map((f) => f.trim());
    return formats.filter((f) => ['card', 'standup', 'narrative'].includes(f)) as ArtifactFormat[];
  }

  // Default: all formats
  return ['card', 'standup', 'narrative'];
}

async function main(): Promise<void> {
  const skipSummary = process.argv.includes('--skip-summary');
  const formats = getArtifactFormats();
  const startTime = Date.now();

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           ESCRIBANO QUALITY TEST BATCH PROCESSOR           ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`Mode: ${skipSummary ? 'Pipeline only (no summary)' : `Full (pipeline + ${formats.join(', ')} formats)`}`);
  console.log(`Videos: ${VIDEOS.length}`);
  console.log(`Artifact formats: ${formats.length > 0 ? formats.join(', ') : 'none'}`);
  console.log(`Started: ${new Date().toLocaleString()}`);
  console.log();

  // Initialize system ONCE
  // This creates the MLX bridge and loads the model
  console.log('Initializing system...');
  const ctx = await initializeSystem();
  console.log('✓ System ready\n');

  // Setup graceful shutdown
  const shutdown = () => {
    console.log('\n\n⚠️  Interrupted by user');
    cleanupMlxBridge();
    process.exit(130);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Process each video
  const results: ProcessVideoResult[] = [];
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < VIDEOS.length; i++) {
    const videoPath = VIDEOS[i];
    const videoName = path.basename(videoPath);
    const current = i + 1;

    console.log('══════════════════════════════════════════════════════════════');
    console.log(`[${current}/${VIDEOS.length}] ${videoName}`);
    console.log('══════════════════════════════════════════════════════════════');
    console.log(`File: ${videoPath}`);
    console.log(`Started: ${new Date().toLocaleTimeString()}`);
    console.log();

    // Process each format for this video
    let videoSuccess = false;
    for (const format of formats) {
      console.log(`  Format: ${format}`);
      const result = await processVideo(videoPath, ctx, {
        force: false,
        skipSummary,
        format,
        includePersonal: true,
      });
      debugLog(result);

      results.push(result);

      if (result.success) {
        videoSuccess = true;
        console.log(`    ✓ ${format} generated`);
        if (result.artifactPath) {
          console.log(`      Path: ${path.basename(result.artifactPath)}`);
        }
      } else {
        console.log(`    ✗ ${format} failed: ${result.error}`);
      }
    }

    console.log();
    if (results.length > 0) {
      const lastResult = results[results.length - 1];
      console.log(`Duration: ${lastResult.duration.toFixed(1)}s`);
    }

    if (videoSuccess) {
      successCount++;
      console.log(`Status: ✓ SUCCESS`);
    } else {
      failCount++;
      console.log(`Status: ✗ FAILED`);
    }

    console.log(`Completed: ${new Date().toLocaleTimeString()}`);
    console.log();

    // Progress summary
    const elapsed = (Date.now() - startTime) / 1000;
    const avgPerVideo = elapsed / current;
    const remaining = (VIDEOS.length - current) * avgPerVideo;

    console.log(`Progress: ${current}/${VIDEOS.length} (${successCount}✓ ${failCount}✗)`);
    console.log(`Elapsed: ${formatDuration(elapsed)} | Est. remaining: ${formatDuration(remaining)}`);
    console.log();
  }

  // Cleanup MLX bridge
  console.log('Cleaning up...');
  cleanupMlxBridge();
  console.log('✓ Cleanup complete\n');

  // Final report
  const totalDuration = (Date.now() - startTime) / 1000;

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                      FINAL REPORT                          ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`Total videos: ${VIDEOS.length}`);
  console.log(`Successful: ${successCount} ✓`);
  console.log(`Failed: ${failCount} ✗`);
  console.log(`Total time: ${formatDuration(totalDuration)}`);
  console.log(`Average per video: ${(totalDuration / VIDEOS.length).toFixed(1)}s`);
  console.log();

  // List failures
  const failedResults = results.filter((r) => !r.success);
  if (failedResults.length > 0) {
    console.log('Failed artifacts:');
    failedResults.forEach((r) => {
      console.log(`  ✗ ${path.basename(r.videoPath)}: ${r.error}`);
    });
    console.log();
  }

  // Success summary by format
  if (successCount > 0) {
    console.log('Generated artifacts:');
    const successResults = results.filter((r) => r.success && r.artifactPath);

    // Group by format for better readability
    const byFormat = new Map<ArtifactFormat, string[]>();
    successResults.forEach((r) => {
      const baseName = path.basename(r.artifactPath!);
      // Extract format from filename (card/standup/narrative typically in the name)
      const format = (r.format || 'unknown') as ArtifactFormat;
      if (!byFormat.has(format)) {
        byFormat.set(format, []);
      }
      byFormat.get(format)!.push(baseName);
    });

    // Print grouped by format
    for (const [format, files] of byFormat) {
      console.log(`  ${format}:`);
      files.forEach((file) => {
        console.log(`    ✓ ${file}`);
      });
    }
    console.log();
  }

  console.log('══════════════════════════════════════════════════════════════');
  console.log(`Completed at: ${new Date().toLocaleString()}`);
  console.log('══════════════════════════════════════════════════════════════');

  // Exit with appropriate code
  process.exit(failCount > 0 ? 1 : 0);
}

/**
 * Format duration in human-readable form
 */
function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hrs > 0) {
    return `${hrs}h ${mins}m ${secs}s`;
  } else if (mins > 0) {
    return `${mins}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}

// Run
main().catch((error) => {
  console.error('Fatal error:', error);
  cleanupMlxBridge();
  process.exit(1);
});
