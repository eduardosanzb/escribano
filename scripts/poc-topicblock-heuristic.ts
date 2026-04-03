/**
 * TopicBlock Heuristic PoC
 *
 * Tests time-gap heuristics for TopicBlock creation and compares
 * against current LLM-based approach.
 *
 * Usage:
 *   npx tsx scripts/poc-topicblock-heuristic.ts
 *   npx tsx scripts/poc-topicblock-heuristic.ts --since 1743600000
 */

import Database from 'better-sqlite3';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DB_PATH = join(homedir(), '.escribano', 'escribano.db');

interface Observation {
  id: string;
  timestamp: number;
  activity_type: string | null;
  vlm_description: string | null;
}

interface TopicBlock {
  id: string;
  from_ts: number;
  to_ts: number;
  observation_count: number;
}

interface HeuristicBlock {
  startIndex: number;
  endIndex: number;
  startTime: number;
  endTime: number;
  duration: number;
  observationCount: number;
  activityTypes: Set<string>;
}

interface BlockStats {
  source: string;
  blocks: number;
  avgDuration: number;
  under30sPercent: number;
  under3obsPercent: number;
  avgObservations: number;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins > 0) {
    return `${mins}m ${secs}s`;
  }
  return `${secs}s`;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
}

function computeHeuristicBlocks(
  observations: Observation[],
  gapThreshold: number
): HeuristicBlock[] {
  const blocks: HeuristicBlock[] = [];

  if (observations.length === 0) {
    return blocks;
  }

  let currentBlock: HeuristicBlock = {
    startIndex: 0,
    endIndex: 0,
    startTime: observations[0].timestamp,
    endTime: observations[0].timestamp,
    duration: 0,
    observationCount: 1,
    activityTypes: new Set(observations[0].activity_type ? [observations[0].activity_type] : []),
  };

  for (let i = 1; i < observations.length; i++) {
    const prevObs = observations[i - 1];
    const currObs = observations[i];
    const gap = currObs.timestamp - prevObs.timestamp;

    if (gap > gapThreshold) {
      // Close current block
      currentBlock.endIndex = i - 1;
      currentBlock.endTime = prevObs.timestamp;
      currentBlock.duration = currentBlock.endTime - currentBlock.startTime;
      blocks.push(currentBlock);

      // Start new block
      currentBlock = {
        startIndex: i,
        endIndex: i,
        startTime: currObs.timestamp,
        endTime: currObs.timestamp,
        duration: 0,
        observationCount: 1,
        activityTypes: new Set(currObs.activity_type ? [currObs.activity_type] : []),
      };
    } else {
      // Continue current block
      currentBlock.endIndex = i;
      currentBlock.endTime = currObs.timestamp;
      currentBlock.observationCount++;
      if (currObs.activity_type) {
        currentBlock.activityTypes.add(currObs.activity_type);
      }
    }
  }

  // Close final block
  currentBlock.duration = currentBlock.endTime - currentBlock.startTime;
  blocks.push(currentBlock);

  return blocks;
}

function computeStats(blocks: HeuristicBlock[]): BlockStats {
  if (blocks.length === 0) {
    return {
      source: '',
      blocks: 0,
      avgDuration: 0,
      under30sPercent: 0,
      under3obsPercent: 0,
      avgObservations: 0,
    };
  }

  const totalDuration = blocks.reduce((sum, b) => sum + b.duration, 0);
  const totalObservations = blocks.reduce((sum, b) => sum + b.observationCount, 0);
  const under30s = blocks.filter((b) => b.duration < 30).length;
  const under3obs = blocks.filter((b) => b.observationCount < 3).length;

  return {
    source: '',
    blocks: blocks.length,
    avgDuration: totalDuration / blocks.length,
    under30sPercent: (under30s / blocks.length) * 100,
    under3obsPercent: (under3obs / blocks.length) * 100,
    avgObservations: totalObservations / blocks.length,
  };
}

function computeTopicBlockStats(topicBlocks: TopicBlock[]): BlockStats {
  if (topicBlocks.length === 0) {
    return {
      source: '',
      blocks: 0,
      avgDuration: 0,
      under30sPercent: 0,
      under3obsPercent: 0,
      avgObservations: 0,
    };
  }

  const totalDuration = topicBlocks.reduce((sum, b) => sum + (b.to_ts - b.from_ts), 0);
  const totalObservations = topicBlocks.reduce((sum, b) => sum + b.observation_count, 0);
  const under30s = topicBlocks.filter((b) => b.to_ts - b.from_ts < 30).length;
  const under3obs = topicBlocks.filter((b) => b.observation_count < 3).length;

  return {
    source: '',
    blocks: topicBlocks.length,
    avgDuration: totalDuration / topicBlocks.length,
    under30sPercent: (under30s / topicBlocks.length) * 100,
    under3obsPercent: (under3obs / topicBlocks.length) * 100,
    avgObservations: totalObservations / topicBlocks.length,
  };
}

function printComparisonTable(stats: BlockStats[]) {
  console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    TOPIC BLOCK COMPARISON                              ║');
  console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

  // Header
  console.log('Source         | Blocks | Avg Duration | Under 30s | Under 3 obs | Avg Obs');
  console.log('---------------+--------+--------------+-----------+-------------+--------');

  // Rows
  for (const stat of stats) {
    const source = stat.source.padEnd(14);
    const blocks = String(stat.blocks).padStart(6);
    const avgDuration = formatDuration(stat.avgDuration).padStart(12);
    const under30s = `${stat.under30sPercent.toFixed(1)}%`.padStart(9);
    const under3obs = `${stat.under3obsPercent.toFixed(1)}%`.padStart(11);
    const avgObs = stat.avgObservations.toFixed(1).padStart(7);

    console.log(`${source} | ${blocks} | ${avgDuration} | ${under30s} | ${under3obs} | ${avgObs}`);
  }
}

function printHeuristicBlockDetails(blocks: HeuristicBlock[], threshold: number) {
  console.log(`\n--- Gap ${threshold}s Heuristic Blocks (${blocks.length} total) ---\n`);

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const timeRange = `${formatTime(block.startTime)}-${formatTime(block.endTime)}`;
    const activities = Array.from(block.activityTypes).slice(0, 3).join(', ') || 'none';

    console.log(
      `#${String(i + 1).padStart(3)} | ${timeRange.padStart(11)} | ${formatDuration(block.duration).padStart(6)} | ${String(block.observationCount).padStart(3)} obs | [${activities}]`
    );
  }
}

function parseArgs(): { since: number | null } {
  const args = process.argv.slice(2);
  let since: number | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--since' && i + 1 < args.length) {
      since = parseInt(args[i + 1], 10);
      if (isNaN(since)) {
        console.error('Error: --since requires a valid unix timestamp');
        process.exit(1);
      }
    }
  }

  return { since };
}

function main(): void {
  const { since: sinceOverride } = parseArgs();

  // Connect to database
  console.log(`Connecting to ${DB_PATH}...`);
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  // Get latest observation timestamp
  const maxTimestampResult = db.prepare('SELECT MAX(timestamp) as max_ts FROM observations').get() as {
    max_ts: number | null;
  };

  if (!maxTimestampResult.max_ts) {
    console.log('No observations found in database.');
    db.close();
    return;
  }

  const maxTimestamp = maxTimestampResult.max_ts;

  // Compute since timestamp
  const since = sinceOverride ?? maxTimestamp - 42 * 3600;

  console.log(`Latest observation: ${new Date(maxTimestamp * 1000).toISOString()}`);
  console.log(`Analyzing observations from: ${new Date(since * 1000).toISOString()} (${sinceOverride ? 'CLI override' : '42 hours back'})\n`);

  // Fetch observations in range
  const observations = db
    .prepare(
      'SELECT id, timestamp, activity_type, vlm_description FROM observations WHERE timestamp >= ? ORDER BY timestamp ASC'
    )
    .all(since) as Observation[];

  console.log(`Found ${observations.length} observations in time range\n`);

  if (observations.length === 0) {
    console.log('No observations to analyze.');
    db.close();
    return;
  }

  // Fetch current TopicBlocks in same range
  const topicBlocks = db
    .prepare(
      'SELECT id, from_ts, to_ts, observation_count FROM topic_blocks WHERE from_ts >= ? AND to_ts <= ?'
    )
    .all(since, maxTimestamp) as TopicBlock[];

  console.log(`Found ${topicBlocks.length} existing TopicBlocks in time range\n`);

  // Compute heuristics for each threshold
  const thresholds = [60, 120, 300];
  const allStats: BlockStats[] = [];
  const heuristicBlocksByThreshold: Map<number, HeuristicBlock[]> = new Map();

  for (const threshold of thresholds) {
    const blocks = computeHeuristicBlocks(observations, threshold);
    heuristicBlocksByThreshold.set(threshold, blocks);

    const stats = computeStats(blocks);
    stats.source = `Gap ${threshold}s`;
    allStats.push(stats);
  }

  // Compute stats for current TopicBlocks
  const currentStats = computeTopicBlockStats(topicBlocks);
  currentStats.source = 'Current DB';
  allStats.unshift(currentStats);

  // Print comparison table
  printComparisonTable(allStats);

  // Print detailed block info for each heuristic
  for (const threshold of thresholds) {
    const blocks = heuristicBlocksByThreshold.get(threshold)!;
    printHeuristicBlockDetails(blocks, threshold);
  }

  // Summary
  console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
  console.log('║                           SUMMARY                                      ║');
  console.log('╚════════════════════════════════════════════════════════════════════════╝');
  console.log(`\nObservations analyzed: ${observations.length}`);
  console.log(`Time range: ${formatDuration(maxTimestamp - since)}`);
  console.log(`Existing TopicBlocks: ${topicBlocks.length}`);

  const bestHeuristic = allStats
    .filter((s) => s.source !== 'Current DB')
    .reduce((best, current) => {
      // Prefer fewer blocks with longer duration and more observations
      const currentScore = current.avgDuration * current.avgObservations / Math.max(current.blocks, 1);
      const bestScore = best.avgDuration * best.avgObservations / Math.max(best.blocks, 1);
      return currentScore > bestScore ? current : best;
    });

  console.log(`\nBest heuristic: ${bestHeuristic.source}`);
  console.log(`  - ${bestHeuristic.blocks} blocks (vs ${currentStats.blocks} current)`);
  console.log(`  - ${formatDuration(bestHeuristic.avgDuration)} avg duration (vs ${formatDuration(currentStats.avgDuration)} current)`);
  console.log(`  - ${bestHeuristic.avgObservations.toFixed(1)} avg observations (vs ${currentStats.avgObservations.toFixed(1)} current)`);
  console.log(`  - ${bestHeuristic.under30sPercent.toFixed(1)}% under 30s (vs ${currentStats.under30sPercent.toFixed(1)}% current)`);
  console.log(`  - ${bestHeuristic.under3obsPercent.toFixed(1)}% under 3 obs (vs ${currentStats.under3obsPercent.toFixed(1)}% current)`);

  db.close();
}

main();
