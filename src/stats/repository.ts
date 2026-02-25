import type Database from 'better-sqlite3';
import { nowISO } from '../db/helpers.js';
import type {
  DbProcessingRunInsert,
  DbProcessingStatInsert,
  StatsRepository,
} from './types.js';

export function createStatsRepository(db: Database.Database): StatsRepository {
  const stmts = {
    insertRun: db.prepare(`
      INSERT INTO processing_runs (id, recording_id, run_type, status, started_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `),
    updateRun: db.prepare(`
      UPDATE processing_runs 
      SET status = ?, completed_at = ?, total_duration_ms = ?, error_message = ?
      WHERE id = ?
    `),
    insertStat: db.prepare(`
      INSERT INTO processing_stats (id, run_id, phase, status, started_at, items_total)
      VALUES (?, ?, ?, ?, ?, ?)
    `),
    updateStat: db.prepare(`
      UPDATE processing_stats 
      SET status = ?, completed_at = ?, duration_ms = ?, items_processed = ?, metadata = ?
      WHERE id = ?
    `),
  };

  return {
    createRun(run: DbProcessingRunInsert): void {
      stmts.insertRun.run(
        run.id,
        run.recording_id,
        run.run_type,
        run.status,
        run.started_at,
        run.metadata ?? null
      );
    },

    updateRun(
      id: string,
      updates: {
        status: DbProcessingRunInsert['status'];
        completed_at: string;
        total_duration_ms: number;
        error_message?: string;
      }
    ): void {
      stmts.updateRun.run(
        updates.status,
        updates.completed_at,
        updates.total_duration_ms,
        updates.error_message ?? null,
        id
      );
    },

    createStat(stat: DbProcessingStatInsert): void {
      stmts.insertStat.run(
        stat.id,
        stat.run_id,
        stat.phase,
        stat.status,
        stat.started_at,
        stat.items_total ?? null
      );
    },

    updateStat(
      id: string,
      updates: {
        status: DbProcessingStatInsert['status'];
        completed_at: string;
        duration_ms: number;
        items_processed?: number;
        metadata?: string;
      }
    ): void {
      stmts.updateStat.run(
        updates.status,
        updates.completed_at,
        updates.duration_ms,
        updates.items_processed ?? null,
        updates.metadata ?? null,
        id
      );
    },
  };
}
