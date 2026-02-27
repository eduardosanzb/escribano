/**
 * Escribano - Subject Grouping Service
 *
 * Groups TopicBlocks into coherent subjects using LLM-based clustering.
 * This is the foundation for the new artifact architecture.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  DbSubjectInsert,
  DbTopicBlock,
  IntelligenceService,
} from '../0_types.js';

export interface Subject {
  id: string;
  recordingId: string;
  label: string;
  topicBlockIds: string[];
  totalDuration: number;
  activityBreakdown: Record<string, number>;
  apps: string[];
  isPersonal: boolean;
}

export interface SubjectGroupingResult {
  subjects: Subject[];
  personalDuration: number;
  workDuration: number;
}

interface TopicBlockForGrouping {
  id: string;
  startTime: number;
  endTime: number;
  duration: number;
  activityType: string;
  keyDescription: string;
  apps: string[];
  topics: string[];
}

interface TopicBlockClassification {
  activity_type: string;
  key_description: string;
  start_time: number;
  end_time: number;
  duration: number;
  apps: string[];
  topics: string[];
  transcript_count: number;
  has_transcript: boolean;
  combined_transcript: string;
}

const PERSONAL_APPS = new Set([
  'WhatsApp',
  'Instagram',
  'TikTok',
  'Telegram',
  'Facebook',
  'Twitter',
  'Snapchat',
  'Discord',
  'Messenger',
  'Signal',
  'FaceTime',
  'iMessage',
  'Messages',
]);

const PERSONAL_APP_THRESHOLD = 0.5;

const SUBJECT_GROUPING_MODEL =
  process.env.ESCRIBANO_SUBJECT_GROUPING_MODEL || 'qwen3:32b';

export async function groupTopicBlocksIntoSubjects(
  topicBlocks: DbTopicBlock[],
  intelligence: IntelligenceService,
  recordingId: string
): Promise<SubjectGroupingResult> {
  if (topicBlocks.length === 0) {
    return {
      subjects: [],
      personalDuration: 0,
      workDuration: 0,
    };
  }

  const blocksForGrouping = topicBlocks.map(extractBlockForGrouping);

  const prompt = buildGroupingPrompt(blocksForGrouping);

  console.log(
    `[subject-grouping] Grouping ${topicBlocks.length} blocks into subjects (model: ${SUBJECT_GROUPING_MODEL})`
  );

  try {
    const response = await intelligence.generateText(prompt, {
      expectJson: false,
      model: SUBJECT_GROUPING_MODEL,
      numPredict: 2000,
      think: false,
    });

    console.log(
      `[subject-grouping] LLM response (${response.length} chars):\n${response.slice(0, 500)}${response.length > 500 ? '...' : ''}`
    );

    const grouping = parseGroupingResponse(response, topicBlocks);

    console.log(
      `[subject-grouping] Parsed ${grouping.groups.length} groups: ${grouping.groups.map((g) => g.label).join(', ')}`
    );

    const subjects: Subject[] = grouping.groups.map((group, index) => {
      const subjectId = `subject-${recordingId}-${index}`;
      const blocks: DbTopicBlock[] = group.blockIds
        .map((id) => topicBlocks.find((b) => b.id === id))
        .filter((b): b is DbTopicBlock => b !== undefined);

      const totalDuration = blocks.reduce((sum, b) => {
        const classification = parseClassification(b);
        return sum + (classification?.duration ?? 0);
      }, 0);

      const activityBreakdown: Record<string, number> = {};
      const appsSet = new Set<string>();

      for (const block of blocks) {
        const classification = parseClassification(block);
        if (classification) {
          const activity = classification.activity_type || 'other';
          activityBreakdown[activity] =
            (activityBreakdown[activity] || 0) + (classification.duration ?? 0);
          if (classification.apps) {
            for (const app of classification.apps) {
              appsSet.add(app);
            }
          }
        }
      }

      const isPersonal = detectPersonalSubject(appsSet, activityBreakdown);

      return {
        id: subjectId,
        recordingId,
        label: group.label,
        topicBlockIds: group.blockIds,
        totalDuration,
        activityBreakdown,
        apps: [...appsSet],
        isPersonal,
      };
    });

    const personalDuration = subjects
      .filter((s) => s.isPersonal)
      .reduce((sum, s) => sum + s.totalDuration, 0);

    const workDuration = subjects
      .filter((s) => !s.isPersonal)
      .reduce((sum, s) => sum + s.totalDuration, 0);

    return {
      subjects,
      personalDuration,
      workDuration,
    };
  } catch (error) {
    const err = error as Error;
    const errorType = err.name || 'Error';
    const errorMessage = err.message || String(err);
    console.error(
      `[subject-grouping] LLM grouping failed (${errorType}): ${errorMessage}`
    );
    if (err.stack) {
      console.error(
        `[subject-grouping] Stack trace:`,
        err.stack.split('\n').slice(0, 3).join('\n')
      );
    }
    return createFallbackGrouping(topicBlocks, recordingId);
  }
}

function extractBlockForGrouping(block: DbTopicBlock): TopicBlockForGrouping {
  const classification = parseClassification(block);
  return {
    id: block.id,
    startTime: classification?.start_time ?? 0,
    endTime: classification?.end_time ?? 0,
    duration: classification?.duration ?? 0,
    activityType: classification?.activity_type || 'other',
    keyDescription: classification?.key_description ?? '',
    apps: classification?.apps ?? [],
    topics: classification?.topics ?? [],
  };
}

function parseClassification(
  block: DbTopicBlock
): TopicBlockClassification | null {
  if (!block.classification) return null;
  try {
    return JSON.parse(block.classification) as TopicBlockClassification;
  } catch {
    return null;
  }
}

function buildGroupingPrompt(blocks: TopicBlockForGrouping[]): string {
  const blockDescriptions = blocks
    .map((b, i) => {
      return `BLOCK ${i + 1}:
Time: ${formatTime(b.startTime)} - ${formatTime(b.endTime)} (${formatDuration(b.duration)})
Activity: ${b.activityType}
Description: ${b.keyDescription}
Apps: ${b.apps.join(', ') || 'none'}
Topics: ${b.topics.join(', ') || 'none'}
ID: ${b.id}`;
    })
    .join('\n\n');

  const blockIdList = blocks.map((b) => b.id);
  const exampleBlockIds =
    blockIdList.length >= 2
      ? `"${blockIdList[0]}", "${blockIdList[1]}"`
      : `"${blockIdList[0]}"`;

  let template: string;
  try {
    const promptPath = join(process.cwd(), 'prompts', 'subject-grouping.md');
    template = readFileSync(promptPath, 'utf-8');
  } catch {
    // Fallback inline prompt if file not found
    template = `You are analyzing a work session that has been divided into {{BLOCK_COUNT}} segments (TopicBlocks).

Your task is to group these segments into 1-6 coherent SUBJECTS. A subject represents a distinct thread of work (e.g., "Escribano pipeline optimization", "Personal time", "Email and admin", "Research on competitors").

GROUPING RULES:
1. Group segments that belong to the same work thread, even if they're not consecutive in time
2. Personal activities (WhatsApp, Instagram, social media, personal calls) should be grouped into a "Personal" subject
3. Email/calendar/admin is only its own group when email IS the primary activity — not just because an email app was open in the background
4. Deep work on the same project/codebase should be grouped together
5. Research sessions should be grouped separately from coding sessions unless clearly related

RULE PRIORITY (when in doubt):
- Classify by primary ACTIVITY TYPE and project context, not by which apps happened to be open
- If all segments are about the same project, one group is correct — do not invent artificial splits

SEGMENTS TO GROUP:
{{BLOCK_DESCRIPTIONS}}

For each group, output ONE line in this EXACT format:
Group 1: label: [Descriptive subject name] | blockIds: [uuid1, uuid2, uuid3]

Example output:
Group 1: label: Escribano VLM Integration | blockIds: [{{EXAMPLE_BLOCK_IDS}}]

CRITICAL REQUIREMENTS:
- Each group MUST have "label" and "blockIds"
- Block IDs are the UUIDs shown in each BLOCK above (copy them exactly)
- Include ALL {{BLOCK_COUNT}} block IDs across all groups (every block must be assigned exactly once)
- Create 1-6 groups (one group is fine if all work is the same project)
- Use clear, descriptive labels for each subject
- Output ONLY the group lines — no explanation, no preamble, no markdown`;
  }

  // Replace template variables
  return template
    .replaceAll('{{BLOCK_COUNT}}', String(blocks.length))
    .replace('{{BLOCK_DESCRIPTIONS}}', blockDescriptions)
    .replace('{{EXAMPLE_BLOCK_IDS}}', exampleBlockIds);
}

interface GroupingResponse {
  groups: Array<{
    label: string;
    blockIds: string[];
  }>;
}

function parseGroupingResponse(
  response: string,
  topicBlocks: DbTopicBlock[]
): GroupingResponse {
  const validBlockIds = new Set(topicBlocks.map((b) => b.id));
  const groups: GroupingResponse['groups'] = [];

  const lines = response.split('\n').filter((line) => line.trim());
  const groupRegex =
    /^Group\s+\d+:\s*label:\s*(.+?)\s*\|\s*blockIds:\s*\[(.+?)\]$/i;

  let matchedLines = 0;
  for (const line of lines) {
    const match = line.match(groupRegex);
    if (!match) continue;

    matchedLines++;
    const label = match[1].trim();
    const blockIdsStr = match[2].trim();

    const blockIds = blockIdsStr
      .split(',')
      .map((id) => id.trim().replace(/^["']|["']$/g, ''))
      .filter((id) => validBlockIds.has(id));

    console.log(
      `[subject-grouping] Parsed group "${label}": ${blockIds.length}/${blockIdsStr.split(',').length} valid block IDs`
    );

    if (blockIds.length > 0 && label) {
      groups.push({ label, blockIds });
    }
  }

  if (groups.length === 0) {
    console.error(
      `[subject-grouping] Failed to parse any groups from ${lines.length} lines (${matchedLines} matched regex)`
    );
    throw new Error(
      `No valid groups found in response. Matched ${matchedLines}/${lines.length} lines.`
    );
  }

  return { groups };
}

function detectPersonalSubject(
  apps: Set<string>,
  activityBreakdown: Record<string, number>
): boolean {
  let personalAppCount = 0;
  let totalAppCount = 0;

  for (const app of apps) {
    totalAppCount++;
    if (PERSONAL_APPS.has(app)) {
      personalAppCount++;
    }
  }

  if (totalAppCount === 0) return false;

  return personalAppCount / totalAppCount >= PERSONAL_APP_THRESHOLD;
}

function createFallbackGrouping(
  topicBlocks: DbTopicBlock[],
  recordingId: string
): SubjectGroupingResult {
  if (topicBlocks.length === 0) {
    return {
      subjects: [],
      personalDuration: 0,
      workDuration: 0,
    };
  }

  const subjects: Subject[] = [];
  let currentSubject: {
    label: string;
    blocks: DbTopicBlock[];
    apps: Set<string>;
    activities: Record<string, number>;
  } | null = null;

  const sortedBlocks = [...topicBlocks].sort((a, b) => {
    const aClass = parseClassification(a);
    const bClass = parseClassification(b);
    return (aClass?.start_time ?? 0) - (bClass?.start_time ?? 0);
  });

  for (const block of sortedBlocks) {
    const classification = parseClassification(block);
    if (!classification) continue;

    const apps = classification.apps || [];
    const isPersonal = apps.some((app) => PERSONAL_APPS.has(app));

    if (!currentSubject) {
      currentSubject = {
        label: isPersonal ? 'Personal' : 'Work Session',
        blocks: [],
        apps: new Set(),
        activities: {},
      };
    }

    const shouldStartNewSubject =
      (isPersonal && currentSubject.label !== 'Personal') ||
      (!isPersonal && currentSubject.label === 'Personal');

    if (shouldStartNewSubject) {
      subjects.push(
        finalizeSubject(currentSubject, recordingId, subjects.length)
      );
      currentSubject = {
        label: isPersonal ? 'Personal' : 'Work Session',
        blocks: [],
        apps: new Set(),
        activities: {},
      };
    }

    currentSubject.blocks.push(block);
    for (const app of apps) {
      currentSubject.apps.add(app);
    }
    const activity = classification.activity_type || 'other';
    currentSubject.activities[activity] =
      (currentSubject.activities[activity] || 0) +
      (classification.duration ?? 0);
  }

  if (currentSubject && currentSubject.blocks.length > 0) {
    subjects.push(
      finalizeSubject(currentSubject, recordingId, subjects.length)
    );
  }

  const personalDuration = subjects
    .filter((s) => s.isPersonal)
    .reduce((sum, s) => sum + s.totalDuration, 0);

  const workDuration = subjects
    .filter((s) => !s.isPersonal)
    .reduce((sum, s) => sum + s.totalDuration, 0);

  return { subjects, personalDuration, workDuration };
}

function finalizeSubject(
  subject: {
    label: string;
    blocks: DbTopicBlock[];
    apps: Set<string>;
    activities: Record<string, number>;
  },
  recordingId: string,
  index: number
): Subject {
  const totalDuration = subject.blocks.reduce((sum, b) => {
    const classification = parseClassification(b);
    return sum + (classification?.duration ?? 0);
  }, 0);

  return {
    id: `subject-${recordingId}-${index}`,
    recordingId,
    label: subject.label,
    topicBlockIds: subject.blocks.map((b) => b.id),
    totalDuration,
    activityBreakdown: subject.activities,
    apps: [...subject.apps],
    isPersonal: subject.label === 'Personal',
  };
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  if (mins > 0) {
    return `${mins}m`;
  }
  return `${Math.floor(seconds)}s`;
}

export function saveSubjectsToDatabase(
  subjects: Subject[],
  recordingId: string,
  repos: {
    subjects: {
      saveBatch: (subjects: DbSubjectInsert[]) => void;
      linkTopicBlocksBatch: (
        links: Array<{ subjectId: string; topicBlockId: string }>
      ) => void;
    };
  }
): void {
  const subjectInserts: DbSubjectInsert[] = [];
  const links: Array<{ subjectId: string; topicBlockId: string }> = [];

  for (const subject of subjects) {
    subjectInserts.push({
      id: subject.id,
      recording_id: subject.recordingId,
      label: subject.label,
      is_personal: subject.isPersonal ? 1 : 0,
      duration: subject.totalDuration,
      activity_breakdown: JSON.stringify(subject.activityBreakdown),
      metadata: JSON.stringify({ apps: subject.apps }),
    });

    for (const blockId of subject.topicBlockIds) {
      links.push({ subjectId: subject.id, topicBlockId: blockId });
    }
  }

  repos.subjects.saveBatch(subjectInserts);
  repos.subjects.linkTopicBlocksBatch(links);
}
