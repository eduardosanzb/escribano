/**
 * Escribano - Outline Index Management
 *
 * Maintains a global session index document in Outline.
 */

import type {
  DbRecording,
  DbTopicBlock,
  PublishingService,
  Repositories,
} from '../0_types.js';
import { log } from '../pipeline/context.js';

export interface IndexOptions {
  collectionName?: string;
  indexTitle?: string;
}

/**
 * Update the global session index in Outline.
 *
 * Creates or updates a master index document listing all published
 * recording summaries with links to their respective documents.
 *
 * @param repos - Database repositories
 * @param publishing - Outline publishing service
 * @param options - Index options
 * @returns URL of the index document
 */
export async function updateGlobalIndex(
  repos: Repositories,
  publishing: PublishingService,
  options: IndexOptions = {}
): Promise<{ url: string; documentId: string }> {
  const collectionName = options.collectionName ?? 'Escribano Sessions';
  const indexTitle = options.indexTitle ?? '📋 Session Summaries Index';

  log('info', `[Index] Updating global index...`);

  // 1. Ensure collection exists
  const collection = await publishing.ensureCollection(collectionName);

  // 2. Get all published recordings from DB
  const recordings = repos.recordings.findByStatus('published');

  // 3. Get topic blocks for all recordings
  const recordingsWithBlocks = recordings.map((recording) => ({
    recording,
    blocks: repos.topicBlocks.findByRecording(recording.id),
  }));

  // 4. Build index content
  const content = buildIndexContent(recordingsWithBlocks, indexTitle);

  // 5. Check for existing index document
  const existing = await publishing.findDocumentByTitle(
    collection.id,
    indexTitle
  );

  // 6. Create or update index
  let document: { id: string; url: string };
  if (existing) {
    log('info', `[Index] Updating existing index`);
    await publishing.updateDocument(existing.id, {
      title: indexTitle,
      content,
    });
    document = existing;
  } else {
    log('info', `[Index] Creating new index`);
    document = await publishing.createDocument({
      collectionId: collection.id,
      title: indexTitle,
      content,
      publish: true,
    });
  }

  log('info', `[Index] Index updated: ${document.url}`);

  return { url: document.url, documentId: document.id };
}

/**
 * Build the index document content.
 */
function buildIndexContent(
  recordings: Array<{ recording: DbRecording; blocks: DbTopicBlock[] }>,
  title: string
): string {
  const now = new Date();

  let content = `# ${title}\n\n`;
  content += `*Last updated: ${now.toLocaleString()}*\n\n`;

  // Group by month
  const grouped = groupByMonth(recordings);

  for (const [month, monthRecordings] of Object.entries(grouped)) {
    content += `## ${month}\n\n`;
    content += buildMonthTable(monthRecordings);
    content += `\n`;
  }

  // Add summary stats
  content += `\n---\n\n`;
  content += `## Statistics\n\n`;
  content += `- **Total sessions:** ${recordings.length}\n`;
  content += `- **Total duration:** ${formatTotalDuration(recordings)}\n`;
  content += `- **Last updated:** ${now.toLocaleString()}\n`;

  return content;
}

/**
 * Group recordings by month.
 */
function groupByMonth(
  recordings: Array<{ recording: DbRecording; blocks: DbTopicBlock[] }>
): Record<string, Array<{ recording: DbRecording; blocks: DbTopicBlock[] }>> {
  const grouped: Record<
    string,
    Array<{ recording: DbRecording; blocks: DbTopicBlock[] }>
  > = {};

  for (const item of recordings) {
    const date = new Date(item.recording.captured_at);
    const month = date.toLocaleString('default', {
      month: 'long',
      year: 'numeric',
    });

    if (!grouped[month]) {
      grouped[month] = [];
    }
    grouped[month].push(item);
  }

  // Sort months descending (newest first)
  const sortedMonths = Object.keys(grouped).sort((a, b) => {
    const dateA = new Date(grouped[a][0].recording.captured_at);
    const dateB = new Date(grouped[b][0].recording.captured_at);
    return dateB.getTime() - dateA.getTime();
  });

  const sorted: Record<string, (typeof grouped)[string]> = {};
  for (const month of sortedMonths) {
    sorted[month] = grouped[month];
  }

  return sorted;
}

/**
 * Build a markdown table for a month's recordings.
 */
function buildMonthTable(
  recordings: Array<{ recording: DbRecording; blocks: DbTopicBlock[] }>
): string {
  // Sort by date descending
  const sorted = [...recordings].sort((a, b) => {
    const dateA = new Date(a.recording.captured_at).getTime();
    const dateB = new Date(b.recording.captured_at).getTime();
    return dateB - dateA;
  });

  let table = `| Date | Activities | Duration | Link |\n`;
  table += `|------|------------|----------|------|\n`;

  for (const { recording, blocks } of sorted) {
    const date = new Date(recording.captured_at);
    const dateStr = date.toLocaleDateString();
    const activities =
      extractActivities(blocks).slice(0, 3).join(', ') || 'Unknown';
    const duration = formatDuration(recording.duration);

    // Try to get the outline URL from metadata
    const outlineUrl = extractOutlineUrl(recording);
    const link = outlineUrl ? `[View](${outlineUrl})` : '—';

    table += `| ${dateStr} | ${activities} | ${duration} | ${link} |\n`;
  }

  return table;
}

/**
 * Extract activities from topic blocks.
 */
function extractActivities(blocks: DbTopicBlock[]): string[] {
  const activityCounts = new Map<string, number>();

  for (const block of blocks) {
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
 * Calculate total duration of all recordings.
 */
function formatTotalDuration(
  recordings: Array<{ recording: DbRecording }>
): string {
  const totalSeconds = recordings.reduce(
    (sum, r) => sum + r.recording.duration,
    0
  );
  return formatDuration(totalSeconds);
}

/**
 * Extract Outline URL from recording metadata if available.
 */
function extractOutlineUrl(recording: DbRecording): string | null {
  try {
    const metadata = recording.source_metadata
      ? JSON.parse(recording.source_metadata)
      : {};
    return metadata.outline?.url ?? null;
  } catch {
    return null;
  }
}
