/**
 * Batch-Contextual VLM Analysis POC
 *
 * Compares two prompting strategies on the same frame batches:
 * 1. SIMPLE: Free-form "describe what's happening" (no format constraint)
 * 2. STRUCTURED: Activity ranges with defined format (activity, apps, topics, description)
 *
 * Output: Side-by-side comparison for manual evaluation of which approach
 * better captures activity understanding and transitions.
 *
 * Usage:
 *   tsx scripts/poc-batch-context/index.ts                          # List recordings
 *   tsx scripts/poc-batch-context/index.ts --recording-id <id>       # Process from DB
 *   tsx scripts/poc-batch-context/index.ts --frames-dir <dir>        # Process frames directly
 *   tsx scripts/poc-batch-context/index.ts --frames-dir <dir> --batch-size 8 --limit 3
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRepositories, ensureDb } from '../../src/db/index.js';
import { loadConfig } from '../../src/config.js';
import { createMlxIntelligenceService } from '../../src/adapters/intelligence.mlx.adapter.js';
import type { DbObservation, DbRecording } from '../../src/0_types.js';

interface Args {
  recordingId: string | null;
  framesDir: string | null;
  batchSize: number;
  model: string;
  limit: number | null;
}

interface ActivityRange {
  startFrame: number;
  endFrame: number;
  activity: string;
  apps: string[];
  topics: string[];
  description: string;
}

function parseArgs(): Args {
  const args: Args = {
    recordingId: null,
    framesDir: null,
    batchSize: 5,
    model: loadConfig().vlmModel,
    limit: null,
  };

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--recording-id' && i + 1 < process.argv.length) {
      args.recordingId = process.argv[++i];
    } else if (arg === '--frames-dir' && i + 1 < process.argv.length) {
      args.framesDir = process.argv[++i];
    } else if (arg === '--batch-size' && i + 1 < process.argv.length) {
      args.batchSize = parseInt(process.argv[++i], 10);
    } else if (arg === '--model' && i + 1 < process.argv.length) {
      args.model = process.argv[++i];
    } else if (arg === '--limit' && i + 1 < process.argv.length) {
      args.limit = parseInt(process.argv[++i], 10);
    }
  }

  return args;
}

function loadPrompt(filename: string): string {
  const path = fileURLToPath(new URL(`../../prompts/${filename}`, import.meta.url));
  return readFileSync(path, 'utf-8');
}

function listRecordings(repos: ReturnType<typeof getRepositories>): void {
  const recordings = repos.recordings.findByStatus('processed');

  if (recordings.length === 0) {
    console.log('No processed recordings found in database.\n');
    console.log('First, process a video:');
    console.log('  npx escribano --file ~/path/to/video.mov\n');
    return;
  }

  console.log('Processed recordings:\n');
  console.log(
    'ID'.padEnd(40) +
      ' Date'.padEnd(20) +
      ' Frames'.padEnd(10) +
      ' Duration'
  );
  console.log('-'.repeat(100));

  for (const rec of recordings) {
    const obsCount = repos.observations
      .findByRecordingAndType(rec.id, 'visual')
      .filter((o) => o.image_path !== null).length;
    const duration = rec.duration ? `${(rec.duration / 60).toFixed(1)}m` : 'unknown';

    console.log(
      rec.id.padEnd(40) +
        (rec.captured_at?.slice(0, 19) || 'unknown').padEnd(20) +
        String(obsCount).padEnd(10) +
        duration
    );
  }

  console.log('\nUsage:');
  console.log('  tsx scripts/poc-batch-context/index.ts --recording-id <id>\n');
}

function loadData(
  recordingId: string,
  repos: ReturnType<typeof getRepositories>
): { recording: DbRecording; observations: DbObservation[] } {
  const recording = repos.recordings.findById(recordingId);
  if (!recording) {
    console.error(`Recording not found: ${recordingId}`);
    process.exit(1);
  }

  const observations = repos.observations
    .findByRecordingAndType(recordingId, 'visual')
    .filter((o) => o.image_path !== null)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (observations.length === 0) {
    console.error(`No visual observations found for recording: ${recordingId}`);
    process.exit(1);
  }

  return { recording, observations };
}

interface FrameInfo {
  imagePath: string;
  timestamp: number;
  displayId: number;
}

function loadFramesFromDir(framesDir: string): FrameInfo[] {
  const files = readdirSync(framesDir)
    .filter((f) => f.endsWith('.jpg') || f.endsWith('.png'))
    .sort();

  const frames: FrameInfo[] = [];
  for (const file of files) {
    // Format: timestamp_displayId.jpg (e.g., 1773422039076_1.jpg)
    const match = file.match(/^(\d+)_(\d+)\.(jpg|png)$/);
    if (match) {
      frames.push({
        imagePath: join(framesDir, file),
        timestamp: parseInt(match[1], 10) / 1000, // Convert ms to seconds
        displayId: parseInt(match[2], 10),
      });
    }
  }

  return frames;
}

function parseStructured(text: string): ActivityRange[] {
  const ranges: ActivityRange[] = [];

  const pattern =
    /Range\s+\d+:\s*frames:\s*\[(\d+)-(\d+)\]\s*\|\s*activity:\s*(\S+)\s*\|\s*apps:\s*([^\|]+)\s*\|\s*topics:\s*([^\|]+)\s*\|\s*description:\s*(.+?)(?=Range\s+\d+:|$)/gis;

  let match;
  while ((match = pattern.exec(text)) !== null) {
    const appsStr = match[4].replace(/^\[|\]$/g, '').trim();
    const topicsStr = match[5].replace(/^\[|\]$/g, '').trim();

    ranges.push({
      startFrame: parseInt(match[1], 10),
      endFrame: parseInt(match[2], 10),
      activity: match[3].trim(),
      apps: appsStr.split(',').map((s) => s.trim()).filter(Boolean),
      topics: topicsStr.split(',').map((s) => s.trim()).filter(Boolean),
      description: match[6].trim(),
    });
  }

  return ranges;
}

function printBatch(
  batchNum: number,
  batch: DbObservation[],
  simpleRaw: string,
  structuredRaw: string,
  ranges: ActivityRange[]
): void {
  const startTime = batch[0].timestamp;
  const endTime = batch[batch.length - 1].timestamp;
  const frameRange = `${batch[0].id.slice(-3)}–${batch[batch.length - 1].id.slice(-3)}`;

  console.log(`\n${'═'.repeat(90)}`);
  console.log(
    `BATCH ${batchNum.toString().padStart(2)} │ frames ${frameRange} │ t=${startTime.toFixed(0)}s → t=${endTime.toFixed(0)}s`
  );
  console.log(`${'═'.repeat(90)}`);

  // SIMPLE
  console.log('\n[SIMPLE — Free-form description]');
  const simpleLines = simpleRaw.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of simpleLines) {
    console.log(`  ${line}`);
  }

  // STRUCTURED
  console.log('\n[STRUCTURED — Activity ranges]');
  if (ranges.length > 0) {
    for (const range of ranges) {
      const frameSpan = `[${range.startFrame}-${range.endFrame}]`;
      console.log(`  Range  ${frameSpan.padEnd(8)} ${range.activity.padEnd(12)} | ${range.apps.join(', ')}`);
      console.log(`    Topics: ${range.topics.join(', ')}`);
      console.log(`    "${range.description}"`);
    }
  } else {
    console.log('  [No ranges parsed — raw VLM output below]');
    console.log(`  ${structuredRaw.slice(0, 200)}...`);
  }

  // PER-FRAME (existing observations)
  console.log('\n[PER-FRAME — Existing observations in DB]');
  for (let i = 0; i < batch.length; i++) {
    const obs = batch[i];
    const frameNum = i + 1;
    const activity = obs.activity_type?.padEnd(10) || '(none)'.padEnd(10);
    const desc = (obs.vlm_description || '').slice(0, 60);
    console.log(
      `  f${frameNum.toString().padStart(2)}  t=${obs.timestamp.toFixed(0).padStart(4)}s  ${activity}  "${desc}${desc.length > 60 ? '...' : ''}"`
    );
  }
}

function printHeader(
  recording: DbRecording,
  numObservations: number,
  batchSize: number,
  numBatches: number,
  numLimited: number
): void {
  console.log('\n' + '═'.repeat(90));
  console.log('Batch-Contextual VLM Analysis POC');
  console.log('═'.repeat(90));
  console.log(`Recording : ${recording.id}`);
  console.log(`Date      : ${recording.captured_at || 'unknown'}`);
  console.log(`Frames    : ${numObservations} visual`);
  console.log(`Batches   : ${numBatches} total, processing ${numLimited}`);
  console.log(`Batch size: ${batchSize} frames (~${(batchSize * 10).toFixed(0)}s each)`);
  console.log('═'.repeat(90) + '\n');
}

function printHeaderFromDir(
  framesDir: string,
  numFrames: number,
  batchSize: number,
  numBatches: number,
  numLimited: number
): void {
  console.log('\n' + '═'.repeat(90));
  console.log('Batch-Contextual VLM Analysis POC');
  console.log('═'.repeat(90));
  console.log(`Frames dir: ${framesDir}`);
  console.log(`Frames    : ${numFrames}`);
  console.log(`Batches   : ${numBatches} total, processing ${numLimited}`);
  console.log(`Batch size: ${batchSize} frames`);
  console.log('═'.repeat(90) + '\n');
}

function printBatchFromDir(
  batchNum: number,
  frames: FrameInfo[],
  simpleRaw: string,
  structuredRaw: string,
  ranges: ActivityRange[]
): void {
  const startTime = frames[0].timestamp;
  const endTime = frames[frames.length - 1].timestamp;

  console.log(`\n${'═'.repeat(90)}`);
  console.log(
    `BATCH ${batchNum.toString().padStart(2)} │ ${frames.length} frames │ t=${startTime.toFixed(0)}s → t=${endTime.toFixed(0)}s`
  );
  console.log(`${'═'.repeat(90)}`);

  // Frame list
  console.log('\n[FRAMES]');
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const frameNum = i + 1;
    console.log(`  f${frameNum.toString().padStart(2)}  t=${f.timestamp.toFixed(0).padStart(4)}s  display=${f.displayId}  ${f.imagePath.split('/').pop()}`);
  }

  // SIMPLE
  console.log('\n[SIMPLE — Free-form description]');
  const simpleLines = simpleRaw.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of simpleLines) {
    console.log(`  ${line}`);
  }

  // STRUCTURED
  console.log('\n[STRUCTURED — Activity ranges]');
  if (ranges.length > 0) {
    for (const range of ranges) {
      const frameSpan = `[${range.startFrame}-${range.endFrame}]`;
      console.log(`  Range  ${frameSpan.padEnd(8)} ${range.activity.padEnd(12)} | ${range.apps.join(', ')}`);
      console.log(`    Topics: ${range.topics.join(', ')}`);
      console.log(`    "${range.description}"`);
    }
  } else {
    console.log('  [No ranges parsed — raw VLM output below]');
    console.log(`  ${structuredRaw.slice(0, 300)}...`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs();

  // --frames-dir mode: process frames directly from directory
  if (args.framesDir) {
    const frames = loadFramesFromDir(args.framesDir);
    if (frames.length === 0) {
      console.error(`No frames found in ${args.framesDir}`);
      process.exit(1);
    }

    console.log(`[Data] Loaded ${frames.length} frames from ${args.framesDir}`);

    // Batch
    const batches: FrameInfo[][] = [];
    for (let i = 0; i < frames.length; i += args.batchSize) {
      batches.push(frames.slice(i, i + args.batchSize));
    }
    const limited = args.limit != null ? batches.slice(0, args.limit) : batches;

    printHeaderFromDir(args.framesDir, frames.length, args.batchSize, batches.length, limited.length);

    // Load prompts
    const simplePrompt = loadPrompt('vlm-holistic-simple.md');
    const structuredPrompt = loadPrompt('vlm-holistic-structured.md');

    // Create MLX service
    const service = createMlxIntelligenceService();

    try {
      for (let i = 0; i < limited.length; i++) {
        const batch = limited[i];

        console.log(`[POC] Processing batch ${i + 1}/${limited.length}...`);

        try {
          // Build images array
          const images = batch.map((f) => ({
            imagePath: f.imagePath,
            timestamp: f.timestamp,
          }));

          // Run SIMPLE prompt
          console.log('  Running SIMPLE prompt...');
          const simpleResults = await service.describeImages(images, {
            prompt: simplePrompt,
          } as Parameters<typeof service.describeImages>[1]);
          const simpleRaw = simpleResults.map((r) => r.description).join('\n');

          // Run STRUCTURED prompt
          console.log('  Running STRUCTURED prompt...');
          const structuredResults = await service.describeImages(images, {
            prompt: structuredPrompt,
          } as Parameters<typeof service.describeImages>[1]);
          const structuredRaw = structuredResults.map((r) => r.description).join('\n');

          // Parse structured output
          const ranges = parseStructured(structuredRaw);

          // Print comparison
          printBatchFromDir(i + 1, batch, simpleRaw, structuredRaw, ranges);
        } catch (batchErr) {
          console.error(`\n[Error] Batch ${i + 1} failed: ${(batchErr as Error).message}`);
        }
      }
    } finally {
      if ('cleanup' in service && typeof service.cleanup === 'function') {
        service.cleanup();
      }
    }

    console.log(`\n${'═'.repeat(90)}`);
    console.log('POC complete');
    console.log(`${'═'.repeat(90)}\n`);
    return;
  }

  // --recording-id mode: use DB
  ensureDb();
  const repos = getRepositories();

  // No recording-id: list and exit
  if (!args.recordingId) {
    listRecordings(repos);
    process.exit(0);
  }

  // Load data
  const { recording, observations } = loadData(args.recordingId, repos);
  console.log(`[Data] Loaded recording ${recording.id} with ${observations.length} visual observations`);

  // Batch
  const batches: DbObservation[][] = [];
  for (let i = 0; i < observations.length; i += args.batchSize) {
    batches.push(observations.slice(i, i + args.batchSize));
  }
  const limited = args.limit != null ? batches.slice(0, args.limit) : batches;

  printHeader(recording, observations.length, args.batchSize, batches.length, limited.length);

  // Load prompts
  const simplePrompt = loadPrompt('vlm-holistic-simple.md');
  const structuredPrompt = loadPrompt('vlm-holistic-structured.md');

  // Create MLX service
  const service = createMlxIntelligenceService();

  try {
    for (let i = 0; i < limited.length; i++) {
      const batch = limited[i];

      console.log(`[POC] Processing batch ${i + 1}/${limited.length}...`);

      try {
        // Build images array
        const images = batch.map((obs) => ({
          imagePath: obs.image_path!,
          timestamp: obs.timestamp,
        }));

        // Run SIMPLE prompt
        const simpleResults = await service.describeImages(images, {
          prompt: simplePrompt,
        } as Parameters<typeof service.describeImages>[1]);
        const simpleRaw = simpleResults.map((r) => r.description).join('\n');

        // Run STRUCTURED prompt
        const structuredResults = await service.describeImages(images, {
          prompt: structuredPrompt,
        } as Parameters<typeof service.describeImages>[1]);
        const structuredRaw = structuredResults.map((r) => r.description).join('\n');

        // Parse structured output
        const ranges = parseStructured(structuredRaw);

        // Print comparison
        printBatch(i + 1, batch, simpleRaw, structuredRaw, ranges);
      } catch (batchErr) {
        console.error(`\n[Error] Batch ${i + 1} failed: ${(batchErr as Error).message}`);
      }
    }
  } finally {
    // Cleanup
    if ('cleanup' in service && typeof service.cleanup === 'function') {
      service.cleanup();
    }
  }

  console.log(`\n${'═'.repeat(90)}`);
  console.log('POC complete');
  console.log(`${'═'.repeat(90)}\n`);
}

// Run
main().catch((err) => {
  console.error(`\n[Fatal Error] ${err.message}`);
  process.exit(1);
});
