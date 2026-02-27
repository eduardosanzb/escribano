/**
 * Escribano - Publish Summary V3
 *
 * Publishes V3 session summaries to Outline wiki.
 */

import type {
  DbRecording,
  DbTopicBlock,
  OutlineSyncState,
  PublishingService,
  Repositories,
} from '../0_types.js';
import { log } from '../pipeline/context.js';

export interface PublishSummaryOptions {
  collectionName?: string;
  publish?: boolean;
  format?: string;
}

export interface PublishedSummary {
  url: string;
  documentId: string;
  collectionId: string;
  syncState: OutlineSyncState;
  contentHash: string;
}

/**
 * Outline metadata stored in recording.source_metadata
 */
export interface OutlineMetadata {
  url: string;
  documentId: string;
  collectionId: string;
  publishedAt: string;
  contentHash: string;
  error?: string;
  failedAt?: string;
}

/**
 * Publish a V3 session summary to Outline.
 *
 * Creates a single document per recording with full summary content.
 *
 * @param recordingId - Recording ID
 * @param content - Summary markdown content
 * @param topicBlocks - V3 topic blocks for metadata
 * @param repos - Database repositories
 * @param publishing - Outline publishing service
 * @param options - Publishing options
 * @returns Published document info
 */
export async function publishSummaryV3(
  recordingId: string,
  content: string,
  topicBlocks: DbTopicBlock[],
  repos: Repositories,
  publishing: PublishingService,
  options: PublishSummaryOptions = {}
): Promise<PublishedSummary> {
  const collectionName = options.collectionName ?? 'Escribano Sessions';
  const indexTitle = '📋 Session Summaries Index';

  log('info', `[Publish V3] Publishing summary for ${recordingId}...`);

  // 1. Get recording info
  const recording = repos.recordings.findById(recordingId);
  if (!recording) {
    throw new Error(`Recording ${recordingId} not found`);
  }

  // 2. Ensure collection exists
  const collection = await publishing.ensureCollection(collectionName);
  log(
    'info',
    `[Publish V3] Using collection: ${collectionName} (${collection.id})`
  );

  // Find index document to use as parent (if it exists)
  const indexDoc = await publishing.findDocumentByTitle(
    collection.id,
    indexTitle
  );
  if (indexDoc) {
    log('info', `[Publish V3] Nesting under index: ${indexTitle}`);
  }

  // 3. Build document title and content
  const title = buildDocumentTitle(recording, topicBlocks, options.format);
  const documentContent = buildDocumentContent(recording, content, topicBlocks);

  // 4. Check for existing document (by title)
  const existing = await publishing.findDocumentByTitle(collection.id, title);

  // 5. Create or update document
  let document: { id: string; url: string };
  if (existing) {
    log('info', `[Publish V3] Updating existing document: ${title}`);
    await publishing.updateDocument(existing.id, {
      title,
      content: documentContent,
    });
    document = existing;
  } else {
    log('info', `[Publish V3] Creating new document: ${title}`);
    document = await publishing.createDocument({
      collectionId: collection.id,
      parentDocumentId: indexDoc?.id, // Nest under index if it exists
      title,
      content: documentContent,
      publish: options.publish ?? true,
    });
  }

  // 6. Build sync state and content hash
  const contentHash = hashContent(content);
  const syncState: OutlineSyncState = {
    collectionId: collection.id,
    sessionDocumentId: document.id,
    sessionDocumentUrl: document.url,
    artifacts: [], // V3 doesn't use artifacts as children
    lastSyncedAt: new Date(),
  };

  log('info', `[Publish V3] Published to: ${document.url}`);

  return {
    url: document.url,
    documentId: document.id,
    collectionId: collection.id,
    syncState,
    contentHash,
  };
}

/**
 * Build a descriptive document title from recording and topic blocks.
 */
function buildDocumentTitle(
  recording: { id: string; captured_at: string; duration: number },
  topicBlocks: DbTopicBlock[],
  format?: string
): string {
  const date = new Date(recording.captured_at);
  const dateStr = date.toISOString().split('T')[0];
  const timeStr = date.toTimeString().split(' ')[0].substring(0, 5);

  // Try to extract primary activity from blocks
  const activities = extractActivities(topicBlocks);
  const primaryActivity = activities[0] ?? 'Session';

  // Append format if provided
  const formatSuffix = format ? ` [${format}]` : '';

  return `[${dateStr} ${timeStr}] ${primaryActivity} (${formatDuration(recording.duration)})${formatSuffix}`;
}

/**
 * Extract unique activities from topic blocks, sorted by frequency.
 */
function extractActivities(topicBlocks: DbTopicBlock[]): string[] {
  const activityCounts = new Map<string, number>();

  for (const block of topicBlocks) {
    try {
      const classification = JSON.parse(block.classification || '{}');
      const activity = classification.activity_type;
      if (activity) {
        activityCounts.set(activity, (activityCounts.get(activity) ?? 0) + 1);
      }
    } catch {
      // Ignore invalid JSON
    }
  }

  // Sort by count descending
  return Array.from(activityCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([activity]) => activity.charAt(0).toUpperCase() + activity.slice(1));
}

/**
 * Format duration in human-readable form.
 */
function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${remainingMinutes}m`;
}

/**
 * Build the full document content with metadata and summary.
 */
function buildDocumentContent(
  recording: {
    id: string;
    captured_at: string;
    duration: number;
    source_type?: string;
  },
  summary: string,
  topicBlocks: DbTopicBlock[]
): string {
  const date = new Date(recording.captured_at);
  const activities = extractActivities(topicBlocks);

  // Build metadata section
  let metadata = `---\n`;
  metadata += `**Date:** ${date.toLocaleString()}\n\n`;
  metadata += `**Duration:** ${formatDuration(recording.duration)}\n\n`;
  metadata += `**Activities:** ${activities.join(', ') || 'Unknown'}\n\n`;
  metadata += `**Recording ID:** \`${recording.id}\`\n\n`;
  if (recording.source_type) {
    metadata += `**Source:** ${recording.source_type}\n\n`;
  }
  metadata += `---\n\n`;

  // Append timeline of blocks if available
  const timeline = buildTimeline(topicBlocks);
  if (timeline) {
    metadata += `## Timeline\n\n`;
    metadata += timeline;
    metadata += `\n---\n\n`;
  }

  // Summary header
  const summaryHeader = `# Session Summary\n\n`;

  // Combine all parts
  return metadata + summaryHeader + summary;
}

/**
 * Build a brief timeline from topic blocks.
 */
function buildTimeline(topicBlocks: DbTopicBlock[]): string {
  if (topicBlocks.length === 0) return '';

  // Sort by start time
  const sortedBlocks = [...topicBlocks].sort((a, b) => {
    const aStart = JSON.parse(a.classification || '{}').start_time ?? 0;
    const bStart = JSON.parse(b.classification || '{}').start_time ?? 0;
    return aStart - bStart;
  });

  let timeline = '';
  for (const block of sortedBlocks) {
    try {
      const classification = JSON.parse(block.classification || '{}');
      const activity = classification.activity_type ?? 'unknown';
      const startTime = classification.start_time ?? 0;
      const endTime = classification.end_time ?? 0;
      const duration = endTime - startTime;
      const apps = (classification.apps ?? []).join(', ') || 'none';

      const timeStr = formatTime(startTime);
      const durationStr = formatDuration(duration);

      timeline += `- **${timeStr}** (${durationStr}): ${activity}`;
      if (apps !== 'none') {
        timeline += ` — ${apps}`;
      }
      timeline += `\n`;
    } catch {
      // Skip invalid blocks
    }
  }

  return timeline;
}

/**
 * Format seconds as MM:SS.
 */
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Simple content hashing for change detection.
 */
function hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return hash.toString(16);
}

/**
 * Update recording metadata with Outline publishing info.
 * This should be called after successful publish.
 */
export function updateRecordingOutlineMetadata(
  recordingId: string,
  outlineInfo: OutlineMetadata,
  repos: Repositories,
  format?: string
): void {
  const recording = repos.recordings.findById(recordingId);
  if (!recording) {
    throw new Error(`Recording ${recordingId} not found`);
  }

  // Parse existing metadata
  const currentMetadata = recording.source_metadata
    ? JSON.parse(recording.source_metadata)
    : {};

  // Store format-specific metadata
  if (format) {
    // Initialize formats array if needed
    if (!currentMetadata.outline_formats) {
      currentMetadata.outline_formats = [];
    }

    // Remove any existing entry for this format and add the new one
    currentMetadata.outline_formats = currentMetadata.outline_formats.filter(
      (f: any) => f.format !== format
    );
    currentMetadata.outline_formats.push({
      format,
      ...outlineInfo,
    });
  } else {
    // Backward compatibility: store as single outline object if no format specified
    currentMetadata.outline = outlineInfo;
  }

  repos.recordings.updateMetadata(recordingId, JSON.stringify(currentMetadata));
  log(
    'info',
    `[Publish V3] Updated metadata for ${recordingId}${format ? ` (${format})` : ''}`
  );
}

/**
 * Get current Outline metadata from recording if it exists.
 */
export function getOutlineMetadata(
  recording: DbRecording
): OutlineMetadata | null {
  try {
    const metadata = recording.source_metadata
      ? JSON.parse(recording.source_metadata)
      : {};
    return metadata.outline ?? null;
  } catch {
    return null;
  }
}

/**
 * Check if content has changed since last publish.
 */
export function hasContentChanged(
  recording: DbRecording,
  currentContent: string
): boolean {
  const outlineMeta = getOutlineMetadata(recording);
  if (!outlineMeta) return true;

  const currentHash = hashContent(currentContent);
  return currentHash !== outlineMeta.contentHash;
}
