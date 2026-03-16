/**
 * Frame Repository - SQLite Implementation
 */

import type Database from 'better-sqlite3';
import type { DbFrame, FrameRepository } from '../../0_types.js';
import { nowISO } from '../helpers.js';

export function createSqliteFrameRepository(
  db: Database.Database
): FrameRepository {
  // Prepare statements once
  const stmts = {
    findById: db.prepare('SELECT * FROM frames WHERE id = ?'),
    claimFrames: db.prepare(`
      UPDATE frames
      SET 
        processing_lock_id = ?,
        processing_started_at = ?,
        analyzed = 0
      WHERE id IN (
        SELECT id FROM frames
        WHERE analyzed = 0
        AND (processing_lock_id IS NULL OR processing_started_at < ?)
        ORDER BY timestamp ASC
        LIMIT ?
      )
    `),
    getClaimed: db.prepare(
      'SELECT * FROM frames WHERE processing_lock_id = ? AND analyzed = 0'
    ),
    markAnalyzed: db.prepare(`
      UPDATE frames 
      SET analyzed = 1, processing_lock_id = NULL
      WHERE id = ?
    `),
    markFailed: db.prepare(`
      UPDATE frames 
      SET 
        analyzed = CASE WHEN retry_count >= 3 THEN 2 ELSE 0 END,
        retry_count = retry_count + 1,
        processing_lock_id = NULL,
        failed_at = ?
      WHERE id = ?
    `),
    releaseStaleLocks: db.prepare(`
      UPDATE frames 
      SET processing_lock_id = NULL, processing_started_at = NULL
      WHERE processing_lock_id IS NOT NULL 
      AND processing_started_at < ?
    `),
    getPendingCount: db.prepare(
      'SELECT COUNT(*) as count FROM frames WHERE analyzed = 0'
    ),
    delete: db.prepare('DELETE FROM frames WHERE id = ?'),
  };

  return {
    findById(id: string): DbFrame | null {
      const row = stmts.findById.get(id);
      return (row as DbFrame) ?? null;
    },

    claimFrames(lockId: string, limit: number, expiryMinutes = 10): DbFrame[] {
      const now = nowISO();
      const expiryThreshold = new Date(
        Date.now() - expiryMinutes * 60 * 1000
      ).toISOString();

      // Use a transaction for the atomic update-then-select
      const transaction = db.transaction(() => {
        stmts.claimFrames.run(lockId, now, expiryThreshold, limit);
        return stmts.getClaimed.all(lockId) as DbFrame[];
      });

      return transaction();
    },

    markAnalyzed(id: string): void {
      stmts.markAnalyzed.run(id);
    },

    markFailed(id: string, error?: string): void {
      stmts.markFailed.run(nowISO(), id);
    },

    releaseStaleLocks(expiryMinutes = 30): number {
      const expiryThreshold = new Date(
        Date.now() - expiryMinutes * 60 * 1000
      ).toISOString();
      const info = stmts.releaseStaleLocks.run(expiryThreshold);
      return info.changes;
    },

    getPendingCount(): number {
      const row = stmts.getPendingCount.get() as { count: number };
      return row.count;
    },

    delete(id: string): void {
      stmts.delete.run(id);
    },
  };
}
