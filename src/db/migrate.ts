/**
 * Database Migration Runner
 *
 * Executes SQL migration files from /migrations directory.
 * Tracks applied versions in _schema_version table.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

interface MigrationFile {
  version: number;
  filename: string;
  sql: string;
}

/**
 * Get current schema version from database
 */
function getCurrentVersion(db: Database.Database): number {
  try {
    const row = db
      .prepare('SELECT MAX(version) as version FROM _schema_version')
      .get() as Record<string, unknown> | undefined;

    const version = row?.version;
    return typeof version === 'number' ? version : 0;
  } catch {
    // Table doesn't exist yet
    return 0;
  }
}

/**
 * Load all migration files from /migrations directory
 */
function loadMigrations(): MigrationFile[] {
  try {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    return files.map((filename) => {
      const match = filename.match(/^(\d+)_.+\.sql$/);
      if (!match) {
        throw new Error(
          `Invalid migration filename: ${filename}. Expected format: NNN_description.sql`
        );
      }

      const version = parseInt(match[1], 10);
      const sql = readFileSync(join(MIGRATIONS_DIR, filename), 'utf-8');

      return { version, filename, sql };
    });
  } catch (error) {
    console.error(
      `[db] Failed to load migrations from ${MIGRATIONS_DIR}:`,
      error
    );
    return [];
  }
}

/**
 * Run all pending migrations
 */
export function runMigrations(db: Database.Database): {
  applied: string[];
  currentVersion: number;
} {
  const currentVersion = getCurrentVersion(db);
  const migrations = loadMigrations();
  const pending = migrations.filter((m) => m.version > currentVersion);

  const applied: string[] = [];

  for (const migration of pending) {
    console.log(`[db] Applying migration: ${migration.filename}`);

    // Split migration into individual statements (simple split by ;)
    // NOTE: This might fail if ; is inside a string, but for simple schemas it's fine.
    // better-sqlite3 exec() can handle multiple statements.
    db.exec(migration.sql);

    // Update schema version
    db.prepare('INSERT INTO _schema_version (version) VALUES (?)').run(
      migration.version
    );

    applied.push(migration.filename);
  }

  const finalVersion = getCurrentVersion(db);

  if (applied.length > 0) {
    console.log(`[db] Migrations complete. Schema version: ${finalVersion}`);
  }

  return { applied, currentVersion: finalVersion };
}
