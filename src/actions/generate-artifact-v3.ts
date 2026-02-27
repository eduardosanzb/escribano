/**
 * Escribano - Generate Artifact V3.1
 *
 * Generates structured artifacts from Subjects using format templates.
 * Supports: card (default), standup, narrative
 */

import { execSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type {
  DbTopicBlock,
  IntelligenceService,
  Repositories,
} from '../0_types.js';
import { log, step } from '../pipeline/context.js';
import { normalizeAppNames } from '../services/app-normalization.js';
import {
  groupTopicBlocksIntoSubjects,
  type Subject,
  type SubjectGroupingResult,
  saveSubjectsToDatabase,
} from '../services/subject-grouping.js';

export type ArtifactFormat = 'card' | 'standup' | 'narrative';

export interface ArtifactResult {
  id: string;
  recordingId: string;
  format: ArtifactFormat;
  content: string;
  filePath: string;
  subjects: Subject[];
  personalDuration: number;
  workDuration: number;
  createdAt: Date;
}

export interface GenerateArtifactOptions {
  recordingId: string;
  format?: ArtifactFormat;
  outputDir?: string;
  includePersonal?: boolean;
  copyToClipboard?: boolean;
  printToStdout?: boolean;
  skipLlm?: boolean;
}

export async function generateArtifactV3(
  recordingId: string,
  repos: Repositories,
  intelligence: IntelligenceService,
  options: GenerateArtifactOptions
): Promise<ArtifactResult> {
  const format = options.format || 'card';

  log(
    'info',
    `[Artifact V3.1] Generating ${format} artifact for recording ${recordingId}...`
  );

  const recording = repos.recordings.findById(recordingId);
  if (!recording) {
    throw new Error(`Recording ${recordingId} not found`);
  }

  const topicBlocks = repos.topicBlocks.findByRecording(recordingId);
  if (topicBlocks.length === 0) {
    throw new Error(
      `No TopicBlocks found for recording ${recordingId}. Run process-v3 first.`
    );
  }

  log('info', `[Artifact V3.1] Found ${topicBlocks.length} TopicBlocks`);

  const existingSubjects = repos.subjects.findByRecording(recordingId);
  let subjects: Subject[];
  let personalDuration: number;
  let workDuration: number;

  if (existingSubjects.length > 0) {
    log(
      'info',
      `[Artifact V3.1] Reusing ${existingSubjects.length} existing subjects (no re-grouping needed)`
    );
    const loaded = await loadExistingSubjects(existingSubjects, repos);
    subjects = loaded.subjects;
    personalDuration = loaded.personalDuration;
    workDuration = loaded.workDuration;
  } else {
    log('info', '[Artifact V3.1] Grouping TopicBlocks into subjects...');
    const groupingResult = await step('subject grouping', () =>
      groupTopicBlocksIntoSubjects(topicBlocks, intelligence, recordingId)
    );

    log(
      'info',
      `[Artifact V3.1] Saving ${groupingResult.subjects.length} subjects to database...`
    );
    saveSubjectsToDatabase(groupingResult.subjects, recordingId, repos);

    subjects = groupingResult.subjects;
    personalDuration = groupingResult.personalDuration;
    workDuration = groupingResult.workDuration;
  }

  for (const subject of subjects) {
    subject.apps = normalizeAppNames(subject.apps);
  }

  const filteredSubjects = options.includePersonal
    ? subjects
    : subjects.filter((s) => !s.isPersonal);

  log('info', `[Artifact V3.1] Generating ${format} with LLM...`);
  const content = await step('artifact generation', () =>
    generateLlmArtifact(
      subjects,
      { subjects, personalDuration, workDuration },
      format,
      recording,
      intelligence,
      repos,
      topicBlocks
    )
  );

  const outputDir =
    options.outputDir || path.join(homedir(), '.escribano', 'artifacts');
  await mkdir(outputDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `${recordingId}-${format}-${timestamp}.md`;
  const filePath = path.join(outputDir, fileName);
  await writeFile(filePath, content, 'utf-8');
  log('info', `[Artifact V3.1] Artifact saved to: ${filePath}`);

  const artifactId = `artifact-${recordingId}-${format}-${Date.now()}`;
  repos.artifacts.save({
    id: artifactId,
    recording_id: recordingId,
    type: format,
    content,
    format: 'markdown',
    source_block_ids: JSON.stringify(subjects.flatMap((s) => s.topicBlockIds)),
    source_context_ids: null,
  });
  log('info', `[Artifact V3.1] Saved to database: ${artifactId}`);

  // Link subjects to artifact
  repos.artifacts.linkSubjects(
    artifactId,
    subjects.map((s) => s.id)
  );
  log('info', `[Artifact V3.1] Linked ${subjects.length} subjects to artifact`);

  if (options.printToStdout) {
    console.log(`\n${content}\n`);
  }

  if (options.copyToClipboard && process.platform === 'darwin') {
    try {
      execSync('pbcopy', { input: content, encoding: 'utf-8' });
      log('info', '[Artifact V3.1] Copied to clipboard');
    } catch (error) {
      log('warn', `[Artifact V3.1] Failed to copy to clipboard: ${error}`);
    }
  }

  return {
    id: artifactId,
    recordingId,
    format,
    content,
    filePath,
    subjects,
    personalDuration,
    workDuration,
    createdAt: new Date(),
  };
}

async function loadExistingSubjects(
  existingSubjects: Array<{
    id: string;
    label: string;
    is_personal: number;
    duration: number;
    activity_breakdown: string | null;
    metadata: string | null;
  }>,
  repos: Repositories
): Promise<SubjectGroupingResult> {
  const subjects: Subject[] = [];

  for (const dbSubject of existingSubjects) {
    const topicBlocks = repos.subjects.getTopicBlocks(dbSubject.id);
    const activityBreakdown = dbSubject.activity_breakdown
      ? JSON.parse(dbSubject.activity_breakdown)
      : {};

    const metadata = dbSubject.metadata ? JSON.parse(dbSubject.metadata) : {};
    const apps = metadata.apps || [];

    subjects.push({
      id: dbSubject.id,
      recordingId: topicBlocks[0]?.recording_id || '',
      label: dbSubject.label,
      topicBlockIds: topicBlocks.map((b) => b.id),
      totalDuration: dbSubject.duration,
      activityBreakdown,
      apps,
      isPersonal: dbSubject.is_personal === 1,
    });
  }

  const personalDuration = subjects
    .filter((s) => s.isPersonal)
    .reduce((sum, s) => sum + s.totalDuration, 0);

  const workDuration = subjects
    .filter((s) => !s.isPersonal)
    .reduce((sum, s) => sum + s.totalDuration, 0);

  return { subjects, personalDuration, workDuration };
}

function generateTemplateArtifact(
  subjects: Subject[],
  groupingResult: SubjectGroupingResult,
  format: ArtifactFormat,
  recording: { id: string; duration: number; captured_at: string }
): string {
  const sessionDate = new Date(recording.captured_at).toLocaleDateString(
    'en-US',
    {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }
  );

  const sessionDuration = formatDuration(recording.duration);

  switch (format) {
    case 'standup':
      return generateStandupTemplate(subjects, sessionDate, sessionDuration);
    case 'narrative':
      return generateNarrativeTemplate(subjects, sessionDate, sessionDuration);
    default:
      return generateCardTemplate(
        subjects,
        groupingResult,
        sessionDate,
        sessionDuration
      );
  }
}

function generateCardTemplate(
  subjects: Subject[],
  groupingResult: SubjectGroupingResult,
  sessionDate: string,
  sessionDuration: string
): string {
  let content = `# Session Card - ${sessionDate}\n\n`;
  content += `**Total Duration:** ${sessionDuration}\n`;
  content += `**Subjects:** ${subjects.length}\n\n`;

  for (const subject of subjects) {
    const activityStr = Object.entries(subject.activityBreakdown)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([activity, duration]) => `${activity} ${formatDuration(duration)}`)
      .join(', ');

    content += `## ${subject.label}\n`;
    content += `**${formatDuration(subject.totalDuration)}** | ${activityStr || 'various'}\n\n`;

    const bullets = extractAccomplishmentBullets(subject);
    for (const bullet of bullets.slice(0, 4)) {
      content += `- ${bullet}\n`;
    }
    content += '\n';
  }

  if (groupingResult.personalDuration > 0) {
    content += `---\n*Personal time: ${formatDuration(groupingResult.personalDuration)} (filtered)*\n`;
  }

  return content;
}

function generateStandupTemplate(
  subjects: Subject[],
  sessionDate: string,
  sessionDuration: string
): string {
  let content = `## Standup - ${sessionDate}\n\n`;
  content += `**What I did:**\n`;

  const allActivities: string[] = [];
  for (const subject of subjects) {
    allActivities.push(...extractAccomplishmentBullets(subject));
  }

  for (const activity of allActivities.slice(0, 5)) {
    content += `- ${activity}\n`;
  }

  content += '\n**Key outcomes:**\n';
  content += '- [Add key outcomes from session]\n';
  content += '- [Add key outcomes from session]\n';

  content += '\n**Next:**\n';
  content += '- [Add next steps]\n';

  return content;
}

function generateNarrativeTemplate(
  subjects: Subject[],
  sessionDate: string,
  sessionDuration: string
): string {
  let content = `# Session Summary - ${sessionDate}\n\n`;
  content += `**Duration:** ${sessionDuration}\n\n`;
  content += `## Overview\n\n`;
  content += `This session covered ${subjects.length} main subjects.\n\n`;

  for (const subject of subjects) {
    content += `## ${subject.label}\n\n`;
    content += `Spent ${formatDuration(subject.totalDuration)} on ${subject.label.toLowerCase()}.\n\n`;

    const bullets = extractAccomplishmentBullets(subject);
    for (const bullet of bullets.slice(0, 3)) {
      content += `- ${bullet}\n`;
    }
    content += '\n';
  }

  return content;
}

async function generateLlmArtifact(
  subjects: Subject[],
  groupingResult: SubjectGroupingResult,
  format: ArtifactFormat,
  recording: { id: string; duration: number; captured_at: string },
  intelligence: IntelligenceService,
  repos: Repositories,
  allTopicBlocks: DbTopicBlock[]
): Promise<string> {
  const ARTIFACT_THINK = process.env.ESCRIBANO_ARTIFACT_THINK === 'true';

  const promptFileName =
    format === 'card'
      ? 'card.md'
      : format === 'standup'
        ? 'standup.md'
        : 'summary-v3.md';
  const promptPath = path.join(process.cwd(), 'prompts', promptFileName);

  let promptTemplate: string;
  try {
    promptTemplate = await readFile(promptPath, 'utf-8');
  } catch {
    log(
      'warn',
      `[Artifact V3.1] Prompt template not found: ${promptPath}, using fallback`
    );
    return generateTemplateArtifact(
      subjects,
      groupingResult,
      format,
      recording
    );
  }

  const sessionDate = new Date(recording.captured_at).toLocaleDateString(
    'en-US',
    {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }
  );

  const subjectsData = buildSubjectsDataForPrompt(subjects, allTopicBlocks);

  const prompt = promptTemplate
    .replace('{{SESSION_DURATION}}', formatDuration(recording.duration))
    .replace('{{SESSION_DATE}}', sessionDate)
    .replace('{{SUBJECT_COUNT}}', String(subjects.length))
    .replace('{{SUBJECTS_DATA}}', subjectsData)
    .replace('{{WORK_SUBJECTS}}', subjectsData);

  return intelligence.generateText(prompt, {
    expectJson: false,
    think: ARTIFACT_THINK,
  });
}

function buildSubjectsDataForPrompt(
  subjects: Subject[],
  allTopicBlocks: DbTopicBlock[]
): string {
  // Build a map of TopicBlocks by subject ID for quick lookup
  const blocksBySubjectId = new Map<string, DbTopicBlock[]>();

  for (const subject of subjects) {
    const subjectBlocks = allTopicBlocks.filter((block) =>
      subject.topicBlockIds.includes(block.id)
    );
    blocksBySubjectId.set(subject.id, subjectBlocks);
  }

  return subjects
    .map((subject) => {
      const activityStr = Object.entries(subject.activityBreakdown)
        .sort((a, b) => b[1] - a[1])
        .map(
          ([activity, duration]) => `${activity}: ${formatDuration(duration)}`
        )
        .join(', ');

      const subjectBlocks = blocksBySubjectId.get(subject.id) || [];
      const blockDescriptions = subjectBlocks
        .map((block, index) => {
          try {
            const classification = JSON.parse(block.classification || '{}');
            const desc = classification.key_description || '';
            const duration = block.duration
              ? formatDuration(block.duration)
              : 'unknown';
            return `- Block ${index + 1} (${duration}): ${desc}`;
          } catch {
            return `- Block ${index + 1}: [Unable to parse description]`;
          }
        })
        .join('\n');

      return `### Subject: ${subject.label}
**Duration:** ${formatDuration(subject.totalDuration)}
**Activities:** ${activityStr || 'various'}
**Apps:** ${subject.apps.join(', ') || 'none'}
**isPersonal:** ${subject.isPersonal}

**Block Descriptions:**
${blockDescriptions || '(no blocks)'}
`;
    })
    .join('\n---\n\n');
}

function extractAccomplishmentBullets(subject: Subject): string[] {
  const bullets: string[] = [];

  if (subject.apps.length > 0) {
    bullets.push(`Worked with ${subject.apps.slice(0, 3).join(', ')}`);
  }

  const dominantActivity = Object.entries(subject.activityBreakdown).sort(
    (a, b) => b[1] - a[1]
  )[0];

  if (dominantActivity) {
    bullets.push(
      `Primary activity: ${dominantActivity[0]} (${formatDuration(dominantActivity[1])})`
    );
  }

  return bullets;
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
