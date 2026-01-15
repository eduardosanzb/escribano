/**
 * Sync Session to Outline Action
 *
 * Orchestrates publishing a session and its artifacts to Outline.
 */

import type {
  ArtifactType,
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

  let sessionDocId: string;
  let sessionDocUrl: string;

  const existingSession = await publishing.findDocumentByTitle(
    collection.id,
    sessionTitle
  );

  if (existingSession) {
    await publishing.updateDocument(existingSession.id, {
      content: sessionContent,
    });
    sessionDocId = existingSession.id;
    sessionDocUrl = existingSession.url;
  } else {
    const created = await publishing.createDocument({
      collectionId: collection.id,
      title: sessionTitle,
      content: sessionContent,
      publish: true,
    });
    sessionDocId = created.id;
    sessionDocUrl = created.url;
  }

  // 3. Sync each artifact as child document
  const syncedArtifacts: any[] = [];

  for (const artifact of session.artifacts) {
    const artifactTitle = formatArtifactType(artifact.type);
    const existingArtifact = await findChildDocumentByTitle(
      publishing,
      collection.id,
      sessionDocId,
      artifactTitle
    );

    let docId: string;
    let docUrl: string;

    if (existingArtifact) {
      await publishing.updateDocument(existingArtifact.id, {
        content: artifact.content,
      });
      docId = existingArtifact.id;
      docUrl = existingArtifact.url;
    } else {
      const created = await publishing.createDocument({
        collectionId: collection.id,
        title: artifactTitle,
        content: artifact.content,
        parentDocumentId: sessionDocId,
        publish: true,
      });
      docId = created.id;
      docUrl = created.url;
    }

    syncedArtifacts.push({
      type: artifact.type,
      documentId: docId,
      documentUrl: docUrl,
      syncedAt: new Date(),
      contentHash: hashContent(artifact.content),
    });
  }

  // 4. Update sync state
  session.outlineSyncState = {
    collectionId: collection.id,
    sessionDocumentId: sessionDocId,
    sessionDocumentUrl: sessionDocUrl,
    artifacts: syncedArtifacts,
    lastSyncedAt: new Date(),
  };

  await storage.saveSession(session);

  // 5. Update global index
  await updateGlobalIndex(publishing, storage, collection.id);

  return { url: sessionDocUrl };
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
  if (existing) {
    await publishing.updateDocument(existing.id, { content });
  } else {
    await publishing.createDocument({
      collectionId,
      title,
      content,
      publish: true,
    });
  }
}
