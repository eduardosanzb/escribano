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
const LLM_API_URL = 'http://localhost:8080/chat/completions';
const LLM_MODEL = 'Qwen/Qwen3.5-9B';
const LLM_TIMEOUT_MS = 60_000;

interface Observation {
  id: string;
  timestamp: number;
  activity_type: string | null;
  vlm_description: string | null;
  apps: string | null;
}

interface TopicBlock {
  id: string;
  from_ts: number;
  to_ts: number;
  observation_count: number;
  classification: string | null;
}

interface HeuristicBlock {
  startIndex: number;
  endIndex: number;
  startTime: number;
  endTime: number;
  duration: number;
  observationCount: number;
  activityTypes: Map<string, number>;
  descriptions: string[];
  apps: Map<string, number>;
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
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}h ${mins}m`;
  }
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

  function makeActivityMap(act: string | null): Map<string, number> {
    const m = new Map<string, number>();
    if (act) m.set(act, 1);
    return m;
  }

  function makeAppSet(appsJson: string | null): Map<string, number> {
    const m = new Map<string, number>();
    if (appsJson) {
      try {
        const arr = JSON.parse(appsJson);
        if (Array.isArray(arr)) {
          for (const a of arr) {
            if (typeof a === 'string') m.set(a, (m.get(a) ?? 0) + 1);
          }
        }
      } catch { /* ignore */ }
    }
    return m;
  }

  let currentBlock: HeuristicBlock = {
    startIndex: 0,
    endIndex: 0,
    startTime: observations[0].timestamp,
    endTime: observations[0].timestamp,
    duration: 0,
    observationCount: 1,
    activityTypes: makeActivityMap(observations[0].activity_type),
    descriptions: observations[0].vlm_description ? [observations[0].vlm_description] : [],
    apps: makeAppSet(observations[0].apps),
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
        activityTypes: makeActivityMap(currObs.activity_type),
        descriptions: currObs.vlm_description ? [currObs.vlm_description] : [],
        apps: makeAppSet(currObs.apps),
      };
    } else {
      // Continue current block
      currentBlock.endIndex = i;
      currentBlock.endTime = currObs.timestamp;
      currentBlock.observationCount++;
      if (currObs.activity_type) {
        currentBlock.activityTypes.set(
          currObs.activity_type,
          (currentBlock.activityTypes.get(currObs.activity_type) ?? 0) + 1
        );
      }
      if (currObs.vlm_description) {
        currentBlock.descriptions.push(currObs.vlm_description);
      }
      if (currObs.apps) {
        try {
          const arr = JSON.parse(currObs.apps);
          if (Array.isArray(arr)) {
            for (const a of arr) {
              if (typeof a === 'string') {
                currentBlock.apps.set(a, (currentBlock.apps.get(a) ?? 0) + 1);
              }
            }
          }
        } catch { /* ignore */ }
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

function topEntries(map: Map<string, number>, n: number): string[] {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k}(${v})`);
}

function topApps(map: Map<string, number>, n: number): string[] {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

function truncate(str: string, maxLen: number): string {
  const clean = str.replace(/\n/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen - 3) + '...';
}

function formatTimestampFull(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// ── Layer 2: LLM Subject Grouping ──────────────────────────────────────

interface SubjectGroup {
  label: string;
  blockIndices: number[];
}

function buildSubjectGroupingPrompt(blocks: HeuristicBlock[]): string {
  const blockDescriptions = blocks
    .map((b, i) => {
      const activities = topEntries(b.activityTypes, 3);
      const appList = topApps(b.apps, 5);
      const firstDesc = b.descriptions.find((d) => d && d.length > 0) ?? '(none)';

      return [
        `BLOCK ${i + 1}:`,
        `Time: ${formatTimestampFull(b.startTime)} - ${formatTimestampFull(b.endTime)} (${formatDuration(b.duration)})`,
        `Activity: ${activities.length > 0 ? activities.join(', ') : 'other'}`,
        `Apps: ${appList.length > 0 ? appList.join(', ') : 'none'}`,
        `Description: "${truncate(firstDesc, 150)}"`,
        `Observations: ${b.observationCount}`,
      ].join('\n');
    })
    .join('\n\n');

  return `You are analyzing a work session that has been divided into ${blocks.length} segments (TopicBlocks).

Your task is to group these segments into 3-8 coherent SUBJECTS. A subject represents a distinct thread of work (e.g., "Escribano pipeline optimization", "Personal time", "Email and admin", "Research on competitors").

GROUPING RULES:
1. Group segments that belong to the same work thread, even if they're not consecutive in time
2. Personal activities (WhatsApp, Instagram, social media, personal calls) should be grouped into a "Personal" subject
3. Email/calendar/admin is only its own group when email IS the primary activity
4. Deep work on the same project/codebase should be grouped together
5. Research sessions should be grouped separately from coding sessions unless clearly related

SEGMENTS TO GROUP:
${blockDescriptions}

For each group, output ONE line in this EXACT format:
Group 1: label: [Descriptive subject name] | blocks: [1, 2, 5]

CRITICAL REQUIREMENTS:
- Each group MUST have "label" and "blocks"
- Block numbers are the BLOCK N shown above (just the number, not the word BLOCK)
- Include ALL ${blocks.length} block numbers across all groups (every block must be assigned exactly once)
- Create 3-8 groups
- Use clear, descriptive labels for each subject
- Output ONLY the group lines — no explanation, no preamble, no markdown`;
}

function parseGroupingResponse(response: string, blockCount: number): SubjectGroup[] {
  // Strip thinking tags
  let cleaned = response.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (cleaned.includes('</think>')) {
    cleaned = cleaned.split('</think>')[1].trim();
  }
  // Handle "Thinking Process:" prose
  const tpMatch = cleaned.match(/(?:^|\n)Thinking Process:/);
  if (tpMatch !== null) {
    const after = cleaned.slice((tpMatch.index ?? 0) + tpMatch[0].length);
    const heading = after.match(/\n(#\s|\*\*|Group\s)/);
    cleaned = heading?.index !== undefined ? after.slice(heading.index).trim() : '';
  }

  const groups: SubjectGroup[] = [];
  const lines = cleaned.split('\n').filter((l) => l.trim());
  const groupRegex = /^Group\s+\d+:\s*label:\s*(.+?)\s*\|\s*blocks:\s*\[(.+?)\]$/i;

  for (const line of lines) {
    const match = line.match(groupRegex);
    if (!match) continue;

    const label = match[1].trim();
    const blockNums = match[2]
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n >= 1 && n <= blockCount);

    if (blockNums.length > 0 && label) {
      groups.push({ label, blockIndices: blockNums });
    }
  }

  return groups;
}

async function sendTextInferRequest(prompt: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const response = await fetch(LLM_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        max_tokens: 4000,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${body.slice(0, 200)}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from LLM API');
    }

    return content;
  } finally {
    clearTimeout(timeout);
  }
}

function printGroupingResult(groups: SubjectGroup[], blocks: HeuristicBlock[]) {
  console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
  console.log('║                  LAYER 2: LLM SUBJECT GROUPING                        ║');
  console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

  if (groups.length === 0) {
    console.log('  ⚠️  No groups parsed from LLM response.');
    return;
  }

  let totalDuration = 0;
  for (let g = 0; g < groups.length; g++) {
    const group = groups[g];
    const groupDuration = group.blockIndices.reduce((sum, idx) => {
      const b = blocks[idx - 1];
      return sum + (b ? b.duration : 0);
    }, 0);
    totalDuration += groupDuration;

    console.log(`  📌 Subject ${g + 1}: ${group.label}`);
    console.log(`     Blocks: ${group.blockIndices.join(', ')}`);
    console.log(`     Duration: ${formatDuration(groupDuration)}`);

    // Show activity summary for this group
    const activityTotals = new Map<string, number>();
    for (const idx of group.blockIndices) {
      const b = blocks[idx - 1];
      if (!b) continue;
      for (const [act, count] of b.activityTypes) {
        activityTotals.set(act, (activityTotals.get(act) ?? 0) + count);
      }
    }
    const topActivities = Array.from(activityTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, v]) => `${k}(${v})`);
    if (topActivities.length > 0) {
      console.log(`     Activities: ${topActivities.join(', ')}`);
    }
    console.log();
  }

  console.log(`  📊 Summary: ${groups.length} subjects | ${formatDuration(totalDuration)} total`);
  const assignedBlocks = groups.reduce((s, g) => s + g.blockIndices.length, 0);
  if (assignedBlocks < blocks.length) {
    console.log(`  ⚠️  ${blocks.length - assignedBlocks} blocks were NOT assigned to any group!`);
  }
}

function printBlocksForManualReview(blocks: HeuristicBlock[]) {
  console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
  console.log('║     BLOCKS FOR MANUAL REVIEW (copy-paste into any LLM)                ║');
  console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

  console.log('--- BEGIN PROMPT ---\n');
  console.log(buildSubjectGroupingPrompt(blocks));
  console.log('\n--- END PROMPT ---\n');
}

async function llmGroupBlocks(blocks: HeuristicBlock[]): Promise<void> {
  console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
  console.log('║                  LAYER 2: LLM SUBJECT GROUPING                        ║');
  console.log('╚════════════════════════════════════════════════════════════════════════╝');

  console.log(`\n  📡 Sending ${blocks.length} blocks to ${LLM_API_URL}...`);

  const prompt = buildSubjectGroupingPrompt(blocks);

  try {
    const rawResponse = await sendTextInferRequest(prompt);

    console.log(`\n  ✅ Received response (${rawResponse.length} chars)`);

    const groups = parseGroupingResponse(rawResponse, blocks.length);

    if (groups.length === 0) {
      console.log('  ⚠️  Could not parse groups from LLM response.');
      console.log(`  Raw response (first 500 chars):\n${rawResponse.slice(0, 500)}`);
      printBlocksForManualReview(blocks);
      return;
    }

    printGroupingResult(groups, blocks);
  } catch (error) {
    const err = error as Error;
    console.log(`\n  ❌ LLM request failed: ${err.message}`);
    printBlocksForManualReview(blocks);
  }
}

function printBlockContent(
  blockNum: number,
  startTime: number,
  endTime: number,
  duration: number,
  obsCount: number,
  activityTypes: Map<string, number>,
  apps: Map<string, number>,
  descriptions: string[]
) {
  console.log(`\n  === BLOCK #${blockNum} ===`);
  console.log(`  Time: ${formatTime(startTime)} - ${formatTime(endTime)} (${formatDuration(duration)})`);
  console.log(`  Observations: ${obsCount}`);

  const activities = topEntries(activityTypes, 3);
  console.log(`  Activities: ${activities.length > 0 ? activities.join(', ') : 'none'}`);

  const appList = topApps(apps, 5);
  console.log(`  Apps: ${appList.length > 0 ? appList.join(', ') : 'none'}`);

  const samples = descriptions.filter(d => d && d.length > 0).slice(0, 3);
  if (samples.length > 0) {
    console.log(`  Sample descriptions:`);
    for (const s of samples) {
      console.log(`    - "${truncate(s, 120)}"`);
    }
  } else {
    console.log(`  Sample descriptions: (none)`);
  }
}

function printHeuristicBlockDetails(blocks: HeuristicBlock[], threshold: number) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  GAP ${threshold}s — ${blocks.length} blocks`);
  console.log(`${'='.repeat(70)}`);

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    printBlockContent(
      i + 1,
      block.startTime,
      block.endTime,
      block.duration,
      block.observationCount,
      block.activityTypes,
      block.apps,
      block.descriptions
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

function printSubstantialDBBlocks(db: ReturnType<typeof Database>, since: number, maxTimestamp: number) {
  // Fetch substantial blocks: >= 5 observations AND >= 60s duration
  const substantialBlocks = db
    .prepare(
      `SELECT tb.id, tb.from_ts, tb.to_ts, tb.observation_count, tb.classification
       FROM topic_blocks tb
       WHERE tb.from_ts >= ? AND tb.to_ts <= ?
         AND tb.observation_count >= 5
         AND (tb.to_ts - tb.from_ts) >= 60
       ORDER BY tb.from_ts ASC`
    )
    .all(since, maxTimestamp) as TopicBlock[];

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  SUBSTANTIAL DB BLOCKS — ${substantialBlocks.length} blocks`);
  console.log(`  (observation_count >= 5 AND duration >= 60s)`);
  console.log(`${'='.repeat(70)}`);

  if (substantialBlocks.length === 0) {
    console.log(`\n  No substantial blocks found in this time range.`);
    return;
  }

  // Prepare statement to fetch observations for each block
  const fetchObsStmt = db.prepare(
    `SELECT activity_type, vlm_description, apps
     FROM observations
     WHERE timestamp >= ? AND timestamp <= ?
     ORDER BY timestamp ASC`
  );

  for (let i = 0; i < substantialBlocks.length; i++) {
    const tb = substantialBlocks[i];
    const duration = tb.to_ts - tb.from_ts;

    // Fetch observations in this block's time range
    const obs = fetchObsStmt.all(tb.from_ts, tb.to_ts) as {
      activity_type: string | null;
      vlm_description: string | null;
      apps: string | null;
    }[];

    // Aggregate activity types
    const activityTypes = new Map<string, number>();
    const apps = new Map<string, number>();
    const descriptions: string[] = [];

    for (const o of obs) {
      if (o.activity_type) {
        activityTypes.set(o.activity_type, (activityTypes.get(o.activity_type) ?? 0) + 1);
      }
      if (o.vlm_description) {
        descriptions.push(o.vlm_description);
      }
      if (o.apps) {
        try {
          const arr = JSON.parse(o.apps);
          if (Array.isArray(arr)) {
            for (const a of arr) {
              if (typeof a === 'string') {
                apps.set(a, (apps.get(a) ?? 0) + 1);
              }
            }
          }
        } catch { /* ignore */ }
      }
    }

    printBlockContent(
      i + 1,
      tb.from_ts,
      tb.to_ts,
      duration,
      tb.observation_count,
      activityTypes,
      apps,
      descriptions
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

async function main(): Promise<void> {
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
      'SELECT id, timestamp, activity_type, vlm_description, apps FROM observations WHERE timestamp >= ? ORDER BY timestamp ASC'
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

  // Print substantial DB blocks with full content
  printSubstantialDBBlocks(db, since, maxTimestamp);

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

  // Layer 2: LLM subject grouping on 60s-gap blocks
  const blocks60 = heuristicBlocksByThreshold.get(60)!;
  await llmGroupBlocks(blocks60);

  db.close();
}

main();
