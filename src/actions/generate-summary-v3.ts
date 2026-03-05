/**
 * Escribano - Generate Summary V3
 *
 * Generates a work session summary from V3 processed TopicBlocks using LLM.
 */

import { execSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path, { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IntelligenceService, Repositories } from '../0_types.js';
import { log } from '../pipeline/context.js';
import {
  groupTopicBlocksIntoSubjects,
  type Subject,
  saveSubjectsToDatabase,
} from '../services/subject-grouping.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface SummaryArtifact {
  id: string;
  recordingId: string;
  format: 'narrative';
  content: string;
  filePath: string;
  subjects: Subject[];
  personalDuration: number;
  workDuration: number;
  createdAt: Date;
}

export interface GenerateSummaryOptions {
  /** Recording ID to generate summary for */
  recordingId: string;
  /** Output directory (defaults to ~/.escribano/artifacts) */
  outputDir?: string;
  /** Skip LLM and use template fallback */
  useTemplate?: boolean;
  /** Filter out personal time */
  includePersonal?: boolean;
  /** Copy artifact to clipboard (macOS only) */
  copyToClipboard?: boolean;
  /** Print artifact to stdout */
  printToStdout?: boolean;
}

/**
 * Generate a work session summary artifact from processed TopicBlocks.
 *
 * @param recordingId - Recording ID to generate summary for
 * @param repos - Database repositories
 * @param intelligence - Intelligence service for LLM generation
 * @param options - Generation options
 * @returns Generated artifact
 */
export async function generateSummaryV3(
  recordingId: string,
  repos: Repositories,
  intelligence: IntelligenceService,
  options: GenerateSummaryOptions
): Promise<SummaryArtifact> {
  log(
    'info',
    `[Summary V3] Generating narrative for recording ${recordingId}...`
  );

  // Get the recording
  const recording = repos.recordings.findById(recordingId);
  if (!recording) {
    throw new Error(`Recording ${recordingId} not found`);
  }

  // Get TopicBlocks for this recording
  const allTopicBlocks = repos.topicBlocks.findByRecording(recordingId);
  if (allTopicBlocks.length === 0) {
    throw new Error(
      `No TopicBlocks found for recording ${recordingId}. Run process-v3 first.`
    );
  }

  log('info', `[Summary V3] Found ${allTopicBlocks.length} TopicBlocks`);

  // Check if subjects already exist for this recording
  const existingSubjects = repos.subjects.findByRecording(recordingId);

  let subjects: Subject[];
  let personalDuration: number;
  let workDuration: number;

  if (existingSubjects.length > 0) {
    log(
      'info',
      `[Summary V3] Reusing ${existingSubjects.length} existing subjects (no re-grouping needed)`
    );
    const loaded = loadExistingSubjects(existingSubjects, repos);
    subjects = loaded.subjects;
    personalDuration = loaded.personalDuration;
    workDuration = loaded.workDuration;
  } else {
    // Group TopicBlocks into subjects
    log('info', '[Summary V3] Grouping TopicBlocks into subjects...');
    const groupingResult = await groupTopicBlocksIntoSubjects(
      allTopicBlocks,
      intelligence,
      recordingId
    );

    log(
      'info',
      `[Summary V3] Saving ${groupingResult.subjects.length} subjects to database...`
    );
    saveSubjectsToDatabase(groupingResult.subjects, recordingId, repos);

    subjects = groupingResult.subjects;
    personalDuration = groupingResult.personalDuration;
    workDuration = groupingResult.workDuration;
  }

  // Filter TopicBlocks based on personal/work classification
  let topicBlocksToUse = allTopicBlocks;
  if (!options.includePersonal) {
    // Filter out blocks from personal subjects
    const personalSubjectIds = new Set(
      subjects.filter((s) => s.isPersonal).map((s) => s.id)
    );
    topicBlocksToUse = allTopicBlocks.filter((block) => {
      const subjectForBlock = subjects.find((s) =>
        s.topicBlockIds.includes(block.id)
      );
      // Use the collected personalSubjectIds set for filtering
      return !personalSubjectIds.has(subjectForBlock?.id ?? '');
    });
  }

  // Build sections from TopicBlocks
  const sections: Array<{
    activity: string;
    duration: number;
    description: string;
    transcript: string;
    apps: string[];
    topics: string[];
    startTime: number;
    endTime: number;
  }> = [];

  for (const block of topicBlocksToUse) {
    const classification = JSON.parse(block.classification || '{}');

    sections.push({
      activity: classification.activity_type || 'unknown',
      duration: block.duration || classification.duration || 0,
      description: classification.key_description || '',
      transcript: classification.combined_transcript || '',
      apps: classification.apps || [],
      topics: classification.topics || [],
      startTime: classification.start_time || 0,
      endTime: classification.end_time || 0,
    });
  }

  // Sort by start time
  sections.sort((a, b) => a.startTime - b.startTime);

  log(
    'info',
    `[Summary V3] Building summary from ${sections.length} sections...`
  );

  // Generate summary using LLM or template
  let summaryContent: string;
  const skipLlm =
    options.useTemplate || process.env.ESCRIBANO_SKIP_LLM === 'true';

  if (skipLlm) {
    log('info', '[Summary V3] Using template fallback (LLM skipped)');
    summaryContent = formatSummary(sections, recording.duration, recording.id);
  } else {
    log('info', '[Summary V3] Generating with LLM...');
    summaryContent = await generateLlmSummary(
      sections,
      recording,
      intelligence
    );
  }

  // Ensure output directory exists
  const outputDir =
    options.outputDir || path.join(homedir(), '.escribano', 'artifacts');
  await mkdir(outputDir, { recursive: true });

  // Generate filename
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `${recordingId}-narrative-${timestamp}.md`;
  const filePath = path.join(outputDir, fileName);

  // Write to file
  await writeFile(filePath, summaryContent, 'utf-8');

  log('info', `[Summary V3] Summary saved to: ${filePath}`);

  // Save to database
  const artifactId = `artifact-${recordingId}-narrative-${Date.now()}`;
  repos.artifacts.save({
    id: artifactId,
    recording_id: recordingId,
    type: 'narrative',
    content: summaryContent,
    format: 'markdown',
    source_block_ids: JSON.stringify(subjects.flatMap((s) => s.topicBlockIds)),
    source_context_ids: null,
  });
  log('info', `[Summary V3] Saved to database: ${artifactId}`);

  // Link subjects to artifact
  repos.artifacts.linkSubjects(
    artifactId,
    subjects.map((s) => s.id)
  );
  log('info', `[Summary V3] Linked ${subjects.length} subjects to artifact`);

  // Handle stdout/clipboard
  if (options.printToStdout) {
    console.log(`\n${summaryContent}\n`);
  }

  if (options.copyToClipboard && process.platform === 'darwin') {
    try {
      execSync('pbcopy', { input: summaryContent, encoding: 'utf-8' });
      log('info', '[Summary V3] Copied to clipboard');
    } catch (error) {
      log('warn', `[Summary V3] Failed to copy to clipboard: ${error}`);
    }
  }

  return {
    id: artifactId,
    recordingId,
    format: 'narrative',
    content: summaryContent,
    filePath,
    subjects,
    personalDuration,
    workDuration,
    createdAt: new Date(),
  };
}

/**
 * Generate summary using LLM.
 */
async function generateLlmSummary(
  sections: Array<{
    activity: string;
    duration: number;
    description: string;
    transcript: string;
    apps: string[];
    topics: string[];
    startTime: number;
    endTime: number;
  }>,
  recording: { id: string; duration: number; captured_at: string },
  intelligence: IntelligenceService
): Promise<string> {
  // Read prompt template
  const promptPath = resolve(__dirname, '..', '..', 'prompts', 'summary-v3.md');
  let promptTemplate: string;

  try {
    promptTemplate = await readFile(promptPath, 'utf-8');
  } catch {
    // Fallback if prompt file not found
    log('warn', '[Summary V3] Prompt template not found, using default');
    promptTemplate = `Generate a summary of this work session.\n\nSession Duration: {{SESSION_DURATION}} minutes\nActivities: {{ACTIVITY_COUNT}}\n\n{{ACTIVITY_TIMELINE}}`;
  }

  // Extract unique apps from all sections
  const allApps = new Set<string>();
  for (const section of sections) {
    for (const app of section.apps) {
      allApps.add(app);
    }
  }
  const appsList = [...allApps].sort().join(', ') || 'None detected';

  // Extract URLs from all descriptions
  const urlPattern = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;
  const allUrls = new Set<string>();
  for (const section of sections) {
    const matches = section.description.match(urlPattern);
    if (matches) {
      for (const url of matches) {
        // Clean up trailing punctuation
        const cleanUrl = url.replace(/[.,;:!?)\]]+$/, '');
        allUrls.add(cleanUrl);
      }
    }
    // Also check transcripts for URLs
    const transcriptMatches = section.transcript.match(urlPattern);
    if (transcriptMatches) {
      for (const url of transcriptMatches) {
        const cleanUrl = url.replace(/[.,;:!?)\]]+$/, '');
        allUrls.add(cleanUrl);
      }
    }
  }
  const urlsList =
    [...allUrls]
      .sort()
      .map((url) => `- ${url}`)
      .join('\n') || 'None detected';

  // Build activity timeline
  const activityTimeline = sections
    .map((section, i) => {
      const _startMin = Math.round(section.startTime / 60);
      const durationMin = Math.round(section.duration / 60);
      const startTimeStr = `${Math.floor(section.startTime / 60)}:${Math.floor(
        section.startTime % 60
      )
        .toString()
        .padStart(2, '0')}`;
      const endTimeStr = `${Math.floor(section.endTime / 60)}:${Math.floor(
        section.endTime % 60
      )
        .toString()
        .padStart(2, '0')}`;

      return `### Segment ${i + 1}: ${section.activity} (${startTimeStr} - ${endTimeStr}, ${durationMin} minutes)

**Description:**
${section.description || 'No description available'}

**Apps:** ${section.apps.join(', ') || 'None detected'}
**Topics:** ${section.topics.join(', ') || 'None detected'}

${section.transcript ? `**Audio Transcript:**\n${section.transcript}` : '*No audio transcript*'}
`;
    })
    .join('\n---\n\n');

  // Replace template variables
  const prompt = promptTemplate
    .replace(
      '{{SESSION_DURATION}}',
      String(Math.round(recording.duration / 60))
    )
    .replace(
      '{{SESSION_DATE}}',
      new Date(recording.captured_at).toLocaleDateString()
    )
    .replace('{{ACTIVITY_COUNT}}', String(sections.length))
    .replace('{{ACTIVITY_TIMELINE}}', activityTimeline)
    .replace('{{APPS_LIST}}', appsList)
    .replace('{{URLS_LIST}}', urlsList);

  // Call LLM
  const result = await intelligence.generateText(prompt, {
    expectJson: false,
  });
  return result;
}

/**
 * Format sections into a readable markdown summary (template fallback).
 */
function formatSummary(
  sections: Array<{
    activity: string;
    duration: number;
    description: string;
    transcript: string;
    apps: string[];
    topics: string[];
    startTime: number;
    endTime: number;
  }>,
  totalDuration: number,
  recordingId: string
): string {
  const durationMinutes = Math.round(totalDuration / 60);
  const now = new Date().toLocaleString();

  // Extract unique apps from all sections
  const allApps = new Set<string>();
  for (const section of sections) {
    for (const app of section.apps) {
      allApps.add(app);
    }
  }
  const appsList = [...allApps].sort().join(', ') || 'None detected';

  // Extract URLs from all descriptions
  const urlPattern = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;
  const allUrls = new Set<string>();
  for (const section of sections) {
    const matches = section.description.match(urlPattern);
    if (matches) {
      for (const url of matches) {
        const cleanUrl = url.replace(/[.,;:!?)\]]+$/, '');
        allUrls.add(cleanUrl);
      }
    }
    const transcriptMatches = section.transcript.match(urlPattern);
    if (transcriptMatches) {
      for (const url of transcriptMatches) {
        const cleanUrl = url.replace(/[.,;:!?)\]]+$/, '');
        allUrls.add(cleanUrl);
      }
    }
  }
  const urlsList =
    [...allUrls]
      .sort()
      .map((url) => `- ${url}`)
      .join('\n') || 'None detected';

  let summary = `# Work Session Summary

**Generated:** ${now}  
**Recording ID:** ${recordingId}  
**Session Duration:** ${durationMinutes} minutes  
**Activities Identified:** ${sections.length}

## Overview

This work session consisted of ${sections.length} distinct activities over ${durationMinutes} minutes.

## Apps & Pages Used

### Applications
${appsList}

### Websites Visited
${urlsList}

`;

  // Activity breakdown
  summary += `## Activities

`;

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const startMin = Math.round(section.startTime / 60);
    const durationMin = Math.round(section.duration / 60);

    summary += `### ${i + 1}. ${section.activity.charAt(0).toUpperCase() + section.activity.slice(1)}

- **Time:** ${startMin} minutes into session
- **Duration:** ${durationMin} minutes
- **Apps:** ${section.apps.join(', ') || 'None detected'}
- **Topics:** ${section.topics.join(', ') || 'None detected'}

**What was happening:**
${section.description || '*No visual description available*'}

`;

    if (section.transcript.trim()) {
      summary += `**Audio transcript:**
\`\`\`
${section.transcript}
\`\`\`

`;
    }

    summary += `---

`;
  }

  summary += `## Summary Statistics

- Total activities: ${sections.length}
- Total duration: ${durationMinutes} minutes
- Activities with audio: ${sections.filter((s) => s.transcript.trim()).length}

`;

  return summary;
}

function loadExistingSubjects(
  existingSubjects: Array<{
    id: string;
    label: string;
    is_personal: number;
    duration: number;
    activity_breakdown: string | null;
    metadata: string | null;
  }>,
  repos: Repositories
): { subjects: Subject[]; personalDuration: number; workDuration: number } {
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
