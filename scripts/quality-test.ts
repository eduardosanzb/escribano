/**
 * Quality Test Batch Processor
 *
 * Processes multiple recordings through the Escribano pipeline
 * with a single MLX bridge instance (no socket conflicts).
 *
 * Usage:
 *   pnpm quality-test           # Full pipeline + summary + outline
 *   pnpm quality-test:fast      # Pipeline only (no summary generation)
 *
 * Features:
 * - Adapters initialized ONCE (MLX bridge loads model once)
 * - Continues processing on individual video failures
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

// Video files to process (in order)
const VIDEOS: string[] = [
  path.join(homedir(), 'Desktop', 'Screen Recording 2026-02-21 at 10.03.16.mov'),
  path.join(homedir(), 'Desktop', 'Screen Recording 2026-02-21 at 21.13.07.mov'),
  path.join(homedir(), 'Desktop', 'Screen Recording 2026-02-22 at 09.45.32.mov'),
  path.join(homedir(), 'Desktop', 'Screen Recording 2026-02-23 at 22.50.47.mov'),
  path.join(homedir(), 'Desktop', 'Screen Recording 2026-02-24 at 09.57.28.mov'),
  path.join(homedir(), 'Desktop', 'Screen Recording 2026-02-24 at 12.10.13.mov'),
  path.join(homedir(), 'Desktop', 'Screen Recording 2026-02-24 at 12.26.09.mov'),
];

async function main(): Promise<void> {
  const skipSummary = process.argv.includes('--skip-summary');
  const startTime = Date.now();

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           ESCRIBANO QUALITY TEST BATCH PROCESSOR           ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`Mode: ${skipSummary ? 'Pipeline only (no summary)' : 'Full (pipeline + summary + outline)'}`);
  console.log(`Videos: ${VIDEOS.length}`);
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

    const result = await processVideo(videoPath, ctx, {
      force: false, // Force reprocess for quality testing
      skipSummary,
    });
    debugLog(result)

    results.push(result);

    console.log();
    console.log(`Duration: ${result.duration.toFixed(1)}s`);

    if (result.success) {
      successCount++;
      console.log(`Status: ✓ SUCCESS`);
      if (result.outlineUrl) {
        console.log(`Outline: ${result.outlineUrl}`);
      }
    } else {
      failCount++;
      console.log(`Status: ✗ FAILED`);
      console.log(`Error: ${result.error}`);
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
  if (failCount > 0) {
    console.log('Failed videos:');
    results
      .filter((r) => !r.success)
      .forEach((r) => {
        console.log(`  ✗ ${path.basename(r.videoPath)}: ${r.error}`);
      });
    console.log();
  }

  // Success summary
  if (successCount > 0) {
    console.log('Generated artifacts:');
    results
      .filter((r) => r.success && r.artifactPath)
      .forEach((r) => {
        console.log(`  ✓ ${path.basename(r.artifactPath!)}`);
      });
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
