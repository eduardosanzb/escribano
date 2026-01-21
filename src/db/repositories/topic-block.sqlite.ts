/**
 * Topic Block Repository - SQLite Implementation
 */

import type Database from 'better-sqlite3';
import type {
  DbTopicBlock,
  DbTopicBlockInsert,
  TopicBlockRepository,
} from '../../0_types.js';
import { nowISO } from '../helpers.js';

export function createSqliteTopicBlockRepository(
  db: Database.Database
): TopicBlockRepository {
  const stmts = {
    findById: db.prepare('SELECT * FROM topic_blocks WHERE id = ?'),
    findByRecording: db.prepare(
      'SELECT * FROM topic_blocks WHERE recording_id = ? ORDER BY created_at ASC'
    ),
    findByContext: db.prepare(`
      SELECT * FROM topic_blocks 
      WHERE context_ids LIKE ?
      ORDER BY created_at DESC
    `),
    insert: db.prepare(`
      INSERT INTO topic_blocks (id, recording_id, context_ids, classification, duration, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `),
    delete: db.prepare('DELETE FROM topic_blocks WHERE id = ?'),
    deleteByRecording: db.prepare(
      'DELETE FROM topic_blocks WHERE recording_id = ?'
    ),
  };

  return {
    findById(id: string): DbTopicBlock | null {
      const row = stmts.findById.get(id);
      return (row as DbTopicBlock) ?? null;
    },

    findByRecording(recordingId: string): DbTopicBlock[] {
      return stmts.findByRecording.all(recordingId) as DbTopicBlock[];
    },

    findByContext(contextId: string): DbTopicBlock[] {
      // Simple LIKE search for the context ID in the JSON array string
      // NOTE: For more robust JSON searching, we could use SQLite's json_each if available.
      // Current implementation matches substrings, which is acceptable for UUIDv7 but not ideal.
      return stmts.findByContext.all(`%${contextId}%`) as DbTopicBlock[];
    },

    save(block: DbTopicBlockInsert): void {
      stmts.insert.run(
        block.id,
        block.recording_id,
        block.context_ids,
        block.classification,
        block.duration,
        nowISO()
      );
    },

    delete(id: string): void {
      stmts.delete.run(id);
    },

    deleteByRecording(recordingId: string): void {
      stmts.deleteByRecording.run(recordingId);
    },
  };
}
