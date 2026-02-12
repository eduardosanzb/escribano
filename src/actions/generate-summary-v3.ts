/**
 * Escribano - Generate Summary V3
 *
 * Generates a work session summary from V3 processed TopicBlocks.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { Repositories } from '../0_types.js';
import { log } from '../pipeline/context.js';

export interface SummaryArtifact {
  id: string;
  recordingId: string;
  content: string;
  filePath: string;
  createdAt: Date;
}

export interface GenerateSummaryOptions {
  /** Recording ID to generate summary for */
  recordingId: string;
  /** Output directory (defaults to ~/.escribano/artifacts) */
  outputDir?: string;
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
  options: GenerateSummaryOptions
): Promise<SummaryArtifact> {
  log(
    'info',
    `[Summary V3] Generating summary for recording ${recordingId}...`
  );

  // Get the recording
  const recording = repos.recordings.findById(recordingId);
  if (!recording) {
    throw new Error(`Recording ${recordingId} not found`);
  }

  // Get TopicBlocks for this recording
  const topicBlocks = repos.topicBlocks.findByRecording(recordingId);
  if (topicBlocks.length === 0) {
    throw new Error(
      `No TopicBlocks found for recording ${recordingId}. Run process-v3 first.`
    );
  }

  log('info', `[Summary V3] Found ${topicBlocks.length} TopicBlocks`);

  // Get all observations for transcript data
  const observations = repos.observations.findByRecording(recordingId);
  const visualObs = observations.filter(
    (o) => o.type === 'visual' && o.vlm_description
  );
  const audioObs = observations.filter((o) => o.type === 'audio' && o.text);

  // Build sections from TopicBlocks
  const sections: Array<{
    activity: string;
    duration: number;
    description: string;
    transcript: string;
    startTime: number;
    endTime: number;
  }> = [];

  for (const block of topicBlocks) {
    const classification = JSON.parse(block.classification || '{}');

    // Get observations within this block's time range
    const blockObs = visualObs.filter(
      (o) =>
        o.timestamp >= classification.start_time &&
        o.timestamp <= classification.end_time
    );

    const blockAudio = audioObs.filter(
      (o) =>
        o.timestamp >= classification.start_time &&
        o.timestamp <= classification.end_time
    );

    const description = blockObs
      .map((o) => o.vlm_description)
      .filter(Boolean)
      .join('\n');
    const transcript = blockAudio
      .map((o) => `[${o.audio_source?.toUpperCase()}] ${o.text}`)
      .join('\n');

    sections.push({
      activity: classification.activity_type || 'unknown',
      duration: block.duration || classification.duration || 0,
      description,
      transcript,
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

  // Build the summary directly (skip LLM for MVP - just format nicely)
  const summaryContent = formatSummary(
    sections,
    recording.duration,
    recording.id
  );

  // Ensure output directory exists
  const outputDir =
    options.outputDir || path.join(homedir(), '.escribano', 'artifacts');
  await mkdir(outputDir, { recursive: true });

  // Generate filename
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `${recordingId}-summary-${timestamp}.md`;
  const filePath = path.join(outputDir, fileName);

  // Write to file
  await writeFile(filePath, summaryContent, 'utf-8');

  log('info', `[Summary V3] Summary saved to: ${filePath}`);

  return {
    id: `summary-${recordingId}-${Date.now()}`,
    recordingId,
    content: summaryContent,
    filePath,
    createdAt: new Date(),
  };
}

/**
 * Format sections into a readable markdown summary.
 */
function formatSummary(
  sections: Array<{
    activity: string;
    duration: number;
    description: string;
    transcript: string;
    startTime: number;
    endTime: number;
  }>,
  totalDuration: number,
  recordingId: string
): string {
  const durationMinutes = Math.round(totalDuration / 60);
  const now = new Date().toLocaleString();

  let summary = `# Work Session Summary

**Generated:** ${now}  
**Recording ID:** ${recordingId}  
**Session Duration:** ${durationMinutes} minutes  
**Activities Identified:** ${sections.length}

## Overview

This work session consisted of ${sections.length} distinct activities over ${durationMinutes} minutes.

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
