/**
 * Database Connection
 *
 * Singleton database connection with lazy initialization.
 * Location: ~/.escribano/escribano.db
 */

import { mkdirSync } from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import type { Repositories } from '../0_types.js';
import { runMigrations } from './migrate.js';
import {
  createSqliteArtifactRepository,
  createSqliteContextRepository,
  createSqliteObservationRepository,
  createSqliteRecordingRepository,
  createSqliteTopicBlockRepository,
} from './repositories/index.js';

const DB_PATH = join(os.homedir(), '.escribano', 'escribano.db');

let db: Database.Database | null = null;
let repositories: Repositories | null = null;

/**
 * Get database connection (internal)
 */
function _getDb(): Database.Database {
  if (db) return db;

  // Ensure directory exists
  mkdirSync(dirname(DB_PATH), { recursive: true });

  // Open database
  db = new Database(DB_PATH);

  // Configure pragmas for performance and safety
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  // Run migrations
  runMigrations(db);

  return db;
}

/**
 * Ensure database is initialized
 */
export function ensureDb(): void {
  _getDb();
}

/**
 * Get all repositories
 */
export function getRepositories(): Repositories {
  if (repositories) return repositories;

  const dbInstance = _getDb();
  repositories = {
    recordings: createSqliteRecordingRepository(dbInstance),
    observations: createSqliteObservationRepository(dbInstance),
    contexts: createSqliteContextRepository(dbInstance),
    topicBlocks: createSqliteTopicBlockRepository(dbInstance),
    artifacts: createSqliteArtifactRepository(dbInstance),
  };

  return repositories;
}

/**
 * Create a fresh set of repositories for testing (using in-memory DB)
 */
export function createTestRepositories(): Repositories & {
  cleanup: () => void;
} {
  const testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  runMigrations(testDb);

  return {
    recordings: createSqliteRecordingRepository(testDb),
    observations: createSqliteObservationRepository(testDb),
    contexts: createSqliteContextRepository(testDb),
    topicBlocks: createSqliteTopicBlockRepository(testDb),
    artifacts: createSqliteArtifactRepository(testDb),
    cleanup: () => testDb.close(),
  };
}

/**
 * Close database connection
 */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
    repositories = null;
  }
}

/**
 * Get database path (useful for tests)
 */
export function getDbPath(): string {
  return DB_PATH;
}
