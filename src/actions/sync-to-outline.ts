/**
 * Sync Session to Outline Action
 *
 * Orchestrates publishing a session and its artifacts to Outline.
 */

import type {
  ArtifactType,
  OutlineSyncState,
  PublishingService,
  Session,
  StorageService,
} from '../0_types.js';

/**
 * Syncs a session and all its artifacts to Outline.
 */
export async function syncSessionToOutline(
  session: Session,
  publishing: PublishingService,
  storage: StorageService,
  collectionName = 'Escribano Sessions'
): Promise<{ url: string }> {
  // 1. Ensure collection exists
  const collection = await publishing.ensureCollection(collectionName);

  // 2. Create or update session parent document
  const sessionTitle = formatSessionTitle(session);
  const sessionContent = generateSessionDocument(session);

  const existingSession = await publishing.findDocumentByTitle(
    collection.id,
    sessionTitle
  );

  const sessionDoc = await upsertDocument(
    publishing,
    collection.id,
    sessionTitle,
    sessionContent,
    existingSession?.id
  );

  // 3. Sync each artifact as child document
  const syncedArtifacts: OutlineSyncState['artifacts'] = [];

  for (const artifact of session.artifacts) {
    const artifactTitle = formatArtifactType(artifact.type);
    const existingArtifact = await findChildDocumentByTitle(
      publishing,
      collection.id,
      sessionDoc.id,
      artifactTitle
    );

    const artifactDoc = await upsertDocument(
      publishing,
      collection.id,
      artifactTitle,
      artifact.content,
      existingArtifact?.id,
      sessionDoc.id
    );

    syncedArtifacts.push({
      type: artifact.type,
      documentId: artifactDoc.id,
      documentUrl: artifactDoc.url,
      syncedAt: new Date(),
      contentHash: hashContent(artifact.content),
    });
  }

  // 4. Update sync state
  session.outlineSyncState = {
    collectionId: collection.id,
    sessionDocumentId: sessionDoc.id,
    sessionDocumentUrl: sessionDoc.url,
    artifacts: syncedArtifacts,
    lastSyncedAt: new Date(),
  };

  await storage.saveSession(session);

  // 5. Update global index
  await updateGlobalIndex(publishing, storage, collection.id);

  return { url: sessionDoc.url };
}

/**
 * Creates or updates a document in Outline
 */
async function upsertDocument(
  publishing: PublishingService,
  collectionId: string,
  title: string,
  content: string,
  existingId?: string,
  parentDocumentId?: string
): Promise<{ id: string; url: string }> {
  if (existingId) {
    await publishing.updateDocument(existingId, { content });
    // We need the URL, but updateDocument doesn't return it.
    // Most publishing services will have the URL stable if the title/ID don't change.
    // For now we re-fetch or assume findDocumentByTitle was sufficient.
    const updated = await publishing.findDocumentByTitle(collectionId, title);
    if (!updated) throw new Error(`Failed to find updated document: ${title}`);
    return updated;
  }

  return publishing.createDocument({
    collectionId,
    title,
    content,
    parentDocumentId,
    publish: true,
  });
}

/**
 * Format session title for Outline
 */
function formatSessionTitle(session: Session): string {
  const date = new Date(session.createdAt);
  const dateStr = date.toISOString().split('T')[0];
  const timeStr = date.toTimeString().split(' ')[0].substring(0, 5);

  const primaryType = getPrimaryType(session);
  const typeLabel = primaryType ? `[${primaryType.toUpperCase()}] ` : '';

  return `${typeLabel}${dateStr} ${timeStr} - ${session.id}`;
}

function getPrimaryType(session: Session): string | null {
  if (!session.classification) return null;
  const top = Object.entries(session.classification).sort(
    ([, a], [, b]) => b - a
  )[0];
  return top[1] >= 25 ? top[0] : null;
}

/**
 * Format artifact type for display
 */
function formatArtifactType(type: ArtifactType): string {
  return type
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Find a child document by title under a specific parent
 */
async function findChildDocumentByTitle(
  publishing: PublishingService,
  collectionId: string,
  parentId: string,
  title: string
) {
  const docs = await publishing.listDocuments(collectionId);
  return (
    docs.find((d) => d.parentDocumentId === parentId && d.title === title) ||
    null
  );
}

/**
 * Generate parent session document content
 */
function generateSessionDocument(session: Session): string {
  const date = new Date(session.createdAt).toLocaleString();
  const types = session.classification
    ? Object.entries(session.classification)
        .filter(([, s]) => s >= 25)
        .sort(([, a], [, b]) => b - a)
        .map(([t, s]) => `${t} (${s}%)`)
        .join(' | ')
    : 'Not classified';

  let content = `# Session: ${session.id}\n\n`;
  content += `**Date:** ${date}\n`;
  content += `**Classification:** ${types}\n\n`;

  if (session.artifacts.length > 0) {
    content += `## Artifacts\n\n`;
    for (const artifact of session.artifacts) {
      content += `- ${formatArtifactType(artifact.type)}\n`;
    }
    content += `\n`;
  }

  if (session.metadata) {
    content += `## Metadata\n\n`;

    if (session.metadata.speakers?.length) {
      content += `### Speakers\n`;
      for (const s of session.metadata.speakers) {
        content += `- ${s.name}${s.role ? ` (${s.role})` : ''}\n`;
      }
      content += `\n`;
    }

    if (session.metadata.keyMoments?.length) {
      content += `### Key Moments\n`;
      for (const m of session.metadata.keyMoments) {
        content += `- [${formatTime(m.timestamp)}] ${m.description}\n`;
      }
      content += `\n`;
    }
  }

  return content;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Simple content hashing (placeholder)
 */
function hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return hash.toString();
}

/**
 * Updates the global session index document in Outline
 */
async function updateGlobalIndex(
  publishing: PublishingService,
  storage: StorageService,
  collectionId: string
): Promise<void> {
  const sessions = await storage.listSessions();
  const title = '📋 Session Index';

  let content = `# 📋 Escribano Session Index\n\n`;
  content += `*Last updated: ${new Date().toLocaleString()}*\n\n`;

  // Group by month
  const grouped: Record<string, Session[]> = {};
  for (const s of sessions) {
    const month = new Date(s.createdAt).toLocaleString('default', {
      month: 'long',
      year: 'numeric',
    });
    if (!grouped[month]) grouped[month] = [];
    grouped[month].push(s);
  }

  for (const [month, monthSessions] of Object.entries(grouped)) {
    content += `## ${month}\n\n`;
    content += `| Date | Type | Artifacts | Link |\n`;
    content += `|------|------|-----------|------|\n`;

    for (const s of monthSessions) {
      const date = new Date(s.createdAt).toLocaleString();
      const type = getPrimaryType(s) || 'Unknown';
      const artifacts = s.artifacts
        .map((a) => formatArtifactType(a.type))
        .join(', ');
      const link = s.outlineSyncState?.sessionDocumentUrl
        ? `[View](${s.outlineSyncState.sessionDocumentUrl})`
        : 'N/A';

      content += `| ${date} | ${type} | ${artifacts} | ${link} |\n`;
    }
    content += `\n`;
  }

  const existing = await publishing.findDocumentByTitle(collectionId, title);
  await upsertDocument(publishing, collectionId, title, content, existing?.id);
}
