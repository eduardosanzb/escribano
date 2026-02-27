/**
 * Artifact Repository - SQLite Implementation
 */

import type Database from 'better-sqlite3';
import type {
  ArtifactRepository,
  DbArtifact,
  DbArtifactInsert,
  DbSubject,
} from '../../0_types.js';
import { nowISO } from '../helpers.js';

export function createSqliteArtifactRepository(
  db: Database.Database
): ArtifactRepository {
  const stmts = {
    findById: db.prepare('SELECT * FROM artifacts WHERE id = ?'),
    findByType: db.prepare(
      'SELECT * FROM artifacts WHERE type = ? ORDER BY created_at DESC'
    ),
    findByBlock: db.prepare(`
      SELECT * FROM artifacts 
      WHERE source_block_ids LIKE ?
      ORDER BY created_at DESC
    `),
    findByContext: db.prepare(`
      SELECT * FROM artifacts 
      WHERE source_context_ids LIKE ?
      ORDER BY created_at DESC
    `),
    findByRecording: db.prepare(`
      SELECT * FROM artifacts 
      WHERE recording_id = ?
      ORDER BY created_at DESC
    `),
    insert: db.prepare(`
      INSERT INTO artifacts (
        id, recording_id, type, content, format, source_block_ids, source_context_ids, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    update: db.prepare(`
      UPDATE artifacts SET content = ?, updated_at = ? WHERE id = ?
    `),
    delete: db.prepare('DELETE FROM artifacts WHERE id = ?'),
    deleteByRecording: db.prepare(
      'DELETE FROM artifacts WHERE recording_id = ?'
    ),
    linkSubject: db.prepare(`
      INSERT OR IGNORE INTO artifact_subjects (artifact_id, subject_id)
      VALUES (?, ?)
    `),
    findSubjectsByArtifact: db.prepare(`
      SELECT s.* FROM subjects s
      INNER JOIN artifact_subjects asubj ON asubj.subject_id = s.id
      WHERE asubj.artifact_id = ?
      ORDER BY s.created_at ASC
    `),
  };

  return {
    findById(id: string): DbArtifact | null {
      const row = stmts.findById.get(id);
      return (row as DbArtifact) ?? null;
    },

    findByType(type: string): DbArtifact[] {
      return stmts.findByType.all(type) as DbArtifact[];
    },

    findByBlock(blockId: string): DbArtifact[] {
      return stmts.findByBlock.all(`%${blockId}%`) as DbArtifact[];
    },

    findByContext(contextId: string): DbArtifact[] {
      return stmts.findByContext.all(`%${contextId}%`) as DbArtifact[];
    },

    findByRecording(recordingId: string): DbArtifact[] {
      return stmts.findByRecording.all(recordingId) as DbArtifact[];
    },

    save(artifact: DbArtifactInsert): void {
      const now = nowISO();
      stmts.insert.run(
        artifact.id,
        artifact.recording_id ?? null,
        artifact.type,
        artifact.content,
        artifact.format,
        artifact.source_block_ids,
        artifact.source_context_ids,
        now,
        now
      );
    },

    update(id: string, content: string): void {
      stmts.update.run(content, nowISO(), id);
    },

    delete(id: string): void {
      stmts.delete.run(id);
    },

    deleteByRecording(recordingId: string): void {
      stmts.deleteByRecording.run(recordingId);
    },

    linkSubjects(artifactId: string, subjectIds: string[]): void {
      for (const subjectId of subjectIds) {
        stmts.linkSubject.run(artifactId, subjectId);
      }
    },

    findSubjectsByArtifact(artifactId: string): DbSubject[] {
      return stmts.findSubjectsByArtifact.all(artifactId) as DbSubject[];
    },
  };
}
