/**
 * Escribano - Storage Adapter
 *
 * Saves and loads sessions from filesystem
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import type { Session, StorageService } from '../0_types.js';

const SESSIONS_DIR = join(os.homedir(), '.escribano', 'sessions');

export function createStorageService(): StorageService {
  return {
    saveSession,
    loadSession,
    listSessions,
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

  return sessions;
}
