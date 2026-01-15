/**
 * Escribano - Storage Adapter
 *
 * Saves and loads sessions from filesystem
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import type { Artifact, Session, StorageService } from '../0_types.js';

const SESSIONS_DIR = join(os.homedir(), '.escribano', 'sessions');

export function createFsStorageService(): StorageService {
  return {
    saveSession,
    loadSession,
    listSessions,
    saveArtifact,
    loadArtifacts,
  };
}

async function ensureSessionsDir(): Promise<void> {
  await mkdir(SESSIONS_DIR, { recursive: true });
}

async function saveSession(session: Session): Promise<void> {
  await ensureSessionsDir();

  const sessionPath = join(SESSIONS_DIR, `${session.id}.json`);
  await writeFile(sessionPath, JSON.stringify(session, null, 2), 'utf-8');
}

async function loadSession(sessionId: string): Promise<Session | null> {
  await ensureSessionsDir();

  const sessionPath = join(SESSIONS_DIR, `${sessionId}.json`);

  try {
    const content = await readFile(sessionPath, 'utf-8');
    return JSON.parse(content) as Session;
  } catch {
    return null;
  }
}

async function listSessions(): Promise<Session[]> {
  await ensureSessionsDir();

  const files = await readdir(SESSIONS_DIR);
  const jsonFiles = files.filter((file) => file.endsWith('.json'));

  const sessions: Session[] = [];

  for (const file of jsonFiles) {
    const content = await readFile(join(SESSIONS_DIR, file), 'utf-8');
    sessions.push(JSON.parse(content) as Session);
  }

  // Sort by date descending (newest first)
  return sessions.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

async function saveArtifact(
  sessionId: string,
  artifact: Artifact
): Promise<void> {
  const artifactsDir = join(SESSIONS_DIR, sessionId, 'artifacts');
  await mkdir(artifactsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
  const extension = artifact.format === 'markdown' ? 'md' : artifact.format;
  const filename = `${artifact.type}-${timestamp}.${extension}`;
  const artifactPath = join(artifactsDir, filename);

  await writeFile(artifactPath, artifact.content, 'utf-8');
}

async function loadArtifacts(sessionId: string): Promise<Artifact[]> {
  const artifactsDir = join(SESSIONS_DIR, sessionId, 'artifacts');

  try {
    const files = await readdir(artifactsDir);
    const artifacts: Artifact[] = [];

    for (const file of files) {
      const content = await readFile(join(artifactsDir, file), 'utf-8');
      const match = file.match(/^(\w+)-(.+)\.md$/);
      if (!match) continue;

      const [, type] = match;

      artifacts.push({
        id: `${sessionId}-${file.replace('.md', '')}`,
        type: type as any,
        content,
        format: 'markdown',
        createdAt: new Date(),
      });
    }

    return artifacts;
  } catch {
    return [];
  }
}
