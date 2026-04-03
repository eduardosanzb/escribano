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
  activity_type?: string | null;
  vlm_description?: string | null;
}

interface HeuristicBlock {
  startIndex: number;
  endIndex: number;
  startTime: number;
  endTime: number;
  duration: number;
  observationCount: number;
  activityTypes: Set<string>;
  currentBlocksInside: TopicBlock[];
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

function findCurrentBlocksInsideHeuristic(
  heuristicBlock: HeuristicBlock,
  currentBlocks: TopicBlock[]
): TopicBlock[] {
  return currentBlocks.filter(
    (cb) =>
      cb.from_ts >= heuristicBlock.startTime &&
      cb.to_ts <= heuristicBlock.endTime
  );
}

function printGapAnalysis(
  heuristicBlocks: HeuristicBlock[],
  currentBlocks: TopicBlock[],
  threshold: number
) {
  console.log(`\n╔════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║                    GAP ANALYSIS (Threshold: ${threshold}s)                      ║`);
  console.log(`╚════════════════════════════════════════════════════════════════════════╝\n`);

  // First, associate current blocks with heuristic blocks
  for (const hb of heuristicBlocks) {
    hb.currentBlocksInside = findCurrentBlocksInsideHeuristic(hb, currentBlocks);
  }

  // Find orphaned blocks (those not fully contained in any heuristic block)
  const orphanedBlocks: TopicBlock[] = [];
  for (const cb of currentBlocks) {
    const isContained = heuristicBlocks.some(
      (hb) => cb.from_ts >= hb.startTime && cb.to_ts <= hb.endTime
    );
    if (!isContained) {
      orphanedBlocks.push(cb);
    }
  }

  // Print heuristic blocks with their contained current blocks
  console.log(`📦 HEURISTIC BLOCKS WITH CURRENT BLOCKS INSIDE:\n`);
  
  let totalFragmentationRatio = 0;
  let blocksWithFragments = 0;

  for (let i = 0; i < heuristicBlocks.length; i++) {
    const hb = heuristicBlocks[i];
    const timeRange = `${formatTime(hb.startTime)}-${formatTime(hb.endTime)}`;
    const insideCount = hb.currentBlocksInside.length;
    
    console.log(`  Heuristic Block #${i + 1}:`);
    console.log(`    Time: ${timeRange} | Duration: ${formatDuration(hb.duration)} | Obs: ${hb.observationCount}`);
    console.log(`    Current blocks inside: ${insideCount}`);
    
    if (insideCount > 0) {
      blocksWithFragments++;
      totalFragmentationRatio += insideCount;
      
      for (const cb of hb.currentBlocksInside) {
        const cbDuration = cb.to_ts - cb.from_ts;
        console.log(`      - ${cb.id.substring(0, 8)}... | ${formatDuration(cbDuration)} | ${cb.observation_count} obs`);
      }
      
      const fragmentationRatio = insideCount;
      console.log(`    📊 Fragmentation ratio: ${fragmentationRatio}:1 (current:heuristic)`);
    } else {
      console.log(`      (no current blocks fully contained - this is a NEW block)`);
    }
    console.log();
  }

  // Print summary stats
  if (blocksWithFragments > 0) {
    const avgFragmentation = totalFragmentationRatio / blocksWithFragments;
    console.log(`📈 Average fragmentation ratio: ${avgFragmentation.toFixed(2)}:1\n`);
  }

  return orphanedBlocks;
}

function extractActivityType(classification: string | null): string | null {
  if (!classification) return null;
  try {
    const parsed = JSON.parse(classification);
    // Find the activity with the highest score
    let maxActivity = null;
    let maxScore = 0;
    for (const [activity, score] of Object.entries(parsed)) {
      if (typeof score === 'number' && score > maxScore) {
        maxScore = score;
        maxActivity = activity;
      }
    }
    return maxActivity;
  } catch {
    return classification; // If not valid JSON, return as-is
  }
}

function printOrphanedBlockAnalysis(orphanedBlocks: TopicBlock[]) {
  if (orphanedBlocks.length === 0) {
    console.log(`✅ No orphaned blocks - all current blocks fit cleanly into heuristic blocks!\n`);
    return;
  }

  console.log(`\n╔════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║                 ORPHANED BLOCKS ANALYSIS (${orphanedBlocks.length} blocks)                    ║`);
  console.log(`╚════════════════════════════════════════════════════════════════════════╝\n`);

  console.log(`⚠️  These current blocks don't fit cleanly into any heuristic block:\n`);

  // Group by activity type
  const activityGroups = new Map<string, TopicBlock[]>();
  const noActivityBlocks: TopicBlock[] = [];

  for (const ob of orphanedBlocks) {
    const activityType = extractActivityType(ob.classification);
    if (activityType) {
      if (!activityGroups.has(activityType)) {
        activityGroups.set(activityType, []);
      }
      activityGroups.get(activityType)!.push(ob);
    } else {
      noActivityBlocks.push(ob);
    }
  }

  // Print by activity type
  console.log(`📊 Activity Type Distribution in Orphaned Blocks:\n`);
  
  const sortedActivities = Array.from(activityGroups.entries()).sort((a, b) => b[1].length - a[1].length);
  
  for (const [activity, blocks] of sortedActivities) {
    const totalDuration = blocks.reduce((sum, b) => sum + (b.to_ts - b.from_ts), 0);
    const totalObs = blocks.reduce((sum, b) => sum + b.observation_count, 0);
    console.log(`  ${activity.padEnd(15)}: ${String(blocks.length).padStart(3)} blocks | ${formatDuration(totalDuration).padStart(8)} total | ${totalObs} obs`);
  }
  
  if (noActivityBlocks.length > 0) {
    const totalDuration = noActivityBlocks.reduce((sum, b) => sum + (b.to_ts - b.from_ts), 0);
    const totalObs = noActivityBlocks.reduce((sum, b) => sum + b.observation_count, 0);
    console.log(`  ${'(no activity)'.padEnd(15)}: ${String(noActivityBlocks.length).padStart(3)} blocks | ${formatDuration(totalDuration).padStart(8)} total | ${totalObs} obs`);
  }

  // Sample classifications from orphaned blocks
  console.log(`\n📝 Sample Classifications from Orphaned Blocks:\n`);
  
  const blocksWithClassification = orphanedBlocks.filter(ob => ob.classification && ob.classification.length > 2);
  const sampleSize = Math.min(5, blocksWithClassification.length);
  
  if (sampleSize === 0) {
    console.log(`  (No classification data available for orphaned blocks)`);
  } else {
    // Shuffle and pick samples
    const shuffled = [...blocksWithClassification].sort(() => 0.5 - Math.random());
    const samples = shuffled.slice(0, sampleSize);
    
    for (let i = 0; i < samples.length; i++) {
      const block = samples[i];
      const duration = block.to_ts - block.from_ts;
      const activity = extractActivityType(block.classification);
      const classificationPreview = block.classification!.substring(0, 80).replace(/\n/g, ' ');
      console.log(`  ${i + 1}. [${activity || 'unknown'}] ${formatDuration(duration)} - ${classificationPreview}${block.classification!.length > 80 ? '...' : ''}`);
    }
  }

  // Analysis of why these are orphaned
  console.log(`\n🔍 Why are these blocks orphaned?\n`);
  
  let shortBlocksCount = 0;
  let fewObsCount = 0;
  let otherCount = 0;

  for (const ob of orphanedBlocks) {
    const duration = ob.to_ts - ob.from_ts;
    if (ob.observation_count < 3) {
      fewObsCount++;
    } else if (duration < 30) {
      shortBlocksCount++;
    } else {
      otherCount++;
    }
  }

  console.log(`  - Short blocks (< 3 obs):     ${fewObsCount} (likely noise or gaps)`);
  console.log(`  - Brief blocks (< 30s):         ${shortBlocksCount} (possibly fragmented)`);
  console.log(`  - Other:                        ${otherCount} (may extend beyond heuristic boundaries)`);
}

function printDiffSummary(
  currentBlocks: TopicBlock[],
  heuristicBlocks: HeuristicBlock[],
  threshold: number
) {
  console.log(`\n╔════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║                      DIFF SUMMARY (Threshold: ${threshold}s)                      ║`);
  console.log(`╚════════════════════════════════════════════════════════════════════════╝\n`);

  const totalCurrent = currentBlocks.length;
  const totalHeuristic = heuristicBlocks.length;
  const compressionRatio = totalCurrent / Math.max(totalHeuristic, 1);

  console.log(`📊 Block Counts:`);
  console.log(`  Total current blocks:     ${totalCurrent}`);
  console.log(`  Total heuristic blocks:   ${totalHeuristic}`);
  console.log(`  Compression ratio:        ${compressionRatio.toFixed(2)}:1 (current:heuristic)\n`);

  // Analyze what would be eliminated
  const eliminatedBlocks: { block: TopicBlock; reason: string }[] = [];

  for (const cb of currentBlocks) {
    const isContained = heuristicBlocks.some(
      (hb) => cb.from_ts >= hb.startTime && cb.to_ts <= hb.endTime
    );
    
    if (!isContained) {
      const duration = cb.to_ts - cb.from_ts;
      if (duration < 30) {
        eliminatedBlocks.push({ block: cb, reason: 'too short (< 30s)' });
      } else if (cb.observation_count < 3) {
        eliminatedBlocks.push({ block: cb, reason: 'too few obs (< 3)' });
      } else {
        eliminatedBlocks.push({ block: cb, reason: 'in gap (spans heuristic boundary)' });
      }
    }
  }

  console.log(`🗑️  Blocks that would be ELIMINATED: ${eliminatedBlocks.length}\n`);

  // Group by reason
  const reasonGroups = new Map<string, typeof eliminatedBlocks>();
  for (const eb of eliminatedBlocks) {
    if (!reasonGroups.has(eb.reason)) {
      reasonGroups.set(eb.reason, []);
    }
    reasonGroups.get(eb.reason)!.push(eb);
  }

  for (const [reason, blocks] of reasonGroups) {
    const totalDuration = blocks.reduce((sum, b) => sum + (b.block.to_ts - b.block.from_ts), 0);
    const totalObs = blocks.reduce((sum, b) => sum + b.block.observation_count, 0);
    console.log(`  ${reason.padEnd(30)}: ${String(blocks.length).padStart(3)} blocks | ${formatDuration(totalDuration).padStart(8)} total | ${totalObs} obs`);
  }

  // Signal loss analysis
  console.log(`\n⚠️  SIGNAL LOSS ANALYSIS:\n`);
  
  const significantEliminated = eliminatedBlocks.filter(
    (eb) => eb.block.observation_count >= 5 && (eb.block.to_ts - eb.block.from_ts) >= 60
  );

  if (significantEliminated.length === 0) {
    console.log(`  ✅ No significant signal loss detected!`);
    console.log(`     All eliminated blocks are short (< 60s) or have few observations (< 5).`);
  } else {
    console.log(`  ⚠️  WARNING: ${significantEliminated.length} substantial blocks would be eliminated!`);
    console.log(`     These may represent lost work context:\n`);
    
    for (let i = 0; i < Math.min(3, significantEliminated.length); i++) {
      const eb = significantEliminated[i];
      const duration = eb.block.to_ts - eb.block.from_ts;
      const activity = extractActivityType(eb.block.classification);
      console.log(`     ${i + 1}. ${eb.block.id.substring(0, 8)}... | ${eb.reason} | ${formatDuration(duration)} | ${eb.block.observation_count} obs`);
      if (eb.block.classification) {
        const classificationPreview = eb.block.classification.substring(0, 80).replace(/\n/g, ' ');
        console.log(`        Classification: ${classificationPreview}${eb.block.classification.length > 80 ? '...' : ''}`);
      }
    }
  }

  console.log(`\n📈 RECOMMENDATION:\n`);
  if (compressionRatio > 3 && eliminatedBlocks.length < totalCurrent * 0.3) {
    console.log(`  ✅ Heuristic looks PROMISING - high compression with acceptable loss`);
  } else if (compressionRatio > 2 && eliminatedBlocks.length < totalCurrent * 0.5) {
    console.log(`  ⚠️  Heuristic is MODERATE - decent compression but review eliminated blocks`);
  } else {
    console.log(`  ❌ Heuristic may be TOO AGGRESSIVE - low compression or high signal loss`);
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

  // Fetch current TopicBlocks in same range with more details
  const topicBlocks = db
    .prepare(
      `SELECT tb.id, tb.from_ts, tb.to_ts, tb.observation_count, tb.classification
       FROM topic_blocks tb
       WHERE tb.from_ts >= ? AND tb.to_ts <= ?`
    )
    .all(since, maxTimestamp) as TopicBlock[];

  console.log(`Found ${topicBlocks.length} existing TopicBlocks in time range`);
  
  // Check for duplicates
  const uniqueBlockIds = new Set(topicBlocks.map(b => b.id)).size;
  console.log(`Unique block count: ${uniqueBlockIds} (should match ${topicBlocks.length})\n`);

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

  // Enhanced gap analysis for 300s threshold
  console.log('\n');
  const blocks300 = heuristicBlocksByThreshold.get(300)!;
  const orphanedBlocks = printGapAnalysis(blocks300, topicBlocks, 300);
  printOrphanedBlockAnalysis(orphanedBlocks);
  printDiffSummary(topicBlocks, blocks300, 300);

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
