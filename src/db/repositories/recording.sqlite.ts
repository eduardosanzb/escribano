/**
 * Recording Repository - SQLite Implementation
 */

import type Database from 'better-sqlite3';
import type {
  DbRecording,
  DbRecordingInsert,
  RecordingRepository,
} from '../../0_types.js';
import { nowISO } from '../helpers.js';

export function createSqliteRecordingRepository(
  db: Database.Database
): RecordingRepository {
  // Prepare statements once
  const stmts = {
    findById: db.prepare('SELECT * FROM recordings WHERE id = ?'),
    findByStatus: db.prepare(
      'SELECT * FROM recordings WHERE status = ? ORDER BY captured_at DESC'
    ),
    findPending: db.prepare(
      "SELECT * FROM recordings WHERE status IN ('raw', 'processing') ORDER BY captured_at ASC"
    ),
    insert: db.prepare(`
      INSERT INTO recordings (
        id, video_path, audio_mic_path, audio_system_path, duration, 
        captured_at, status, processing_step, source_type, 
        source_metadata, error_message, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateStatus: db.prepare(`
      UPDATE recordings 
      SET status = ?, processing_step = ?, error_message = ?, updated_at = ? 
      WHERE id = ?
    `),
    delete: db.prepare('DELETE FROM recordings WHERE id = ?'),
  };

  return {
    findById(id: string): DbRecording | null {
      const row = stmts.findById.get(id);
      return (row as DbRecording) ?? null;
    },

    findByStatus(status: DbRecording['status']): DbRecording[] {
      return stmts.findByStatus.all(status) as DbRecording[];
    },

    findPending(): DbRecording[] {
      return stmts.findPending.all() as DbRecording[];
    },

    save(recording: DbRecordingInsert): void {
      const now = nowISO();
      stmts.insert.run(
        recording.id,
        recording.video_path,
        recording.audio_mic_path,
        recording.audio_system_path,
        recording.duration,
        recording.captured_at,
        recording.status,
        recording.processing_step,
        recording.source_type,
        recording.source_metadata,
        recording.error_message,
        now,
        now
      );
    },

    updateStatus(
      id: string,
      status: DbRecording['status'],
      step?: DbRecording['processing_step'],
      error?: string | null
    ): void {
      stmts.updateStatus.run(status, step ?? null, error ?? null, nowISO(), id);
    },

    delete(id: string): void {
      stmts.delete.run(id);
    },
  };
}
