/**
 * Subject Repository - SQLite Implementation
 */

import type Database from 'better-sqlite3';
import type {
  DbSubject,
  DbSubjectInsert,
  DbTopicBlock,
  SubjectRepository,
} from '../../0_types.js';
import { nowISO } from '../helpers.js';

export function createSqliteSubjectRepository(
  db: Database.Database
): SubjectRepository {
  const stmts = {
    findById: db.prepare('SELECT * FROM subjects WHERE id = ?'),
    findByRecording: db.prepare(
      'SELECT * FROM subjects WHERE recording_id = ? ORDER BY created_at ASC'
    ),
    insert: db.prepare(`
      INSERT INTO subjects (id, recording_id, label, is_personal, duration, activity_breakdown, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertLink: db.prepare(`
      INSERT OR IGNORE INTO subject_topic_blocks (subject_id, topic_block_id)
      VALUES (?, ?)
    `),
    getTopicBlocks: db.prepare(`
      SELECT tb.* FROM topic_blocks tb
      INNER JOIN subject_topic_blocks stb ON tb.id = stb.topic_block_id
      WHERE stb.subject_id = ?
      ORDER BY tb.created_at ASC
    `),
    deleteByRecording: db.prepare(
      'DELETE FROM subjects WHERE recording_id = ?'
    ),
    deleteLinksByRecording: db.prepare(`
      DELETE FROM subject_topic_blocks 
      WHERE subject_id IN (SELECT id FROM subjects WHERE recording_id = ?)
    `),
  };

  const insertMany = db.transaction((subjects: DbSubjectInsert[]) => {
    for (const subject of subjects) {
      stmts.insert.run(
        subject.id,
        subject.recording_id,
        subject.label,
        subject.is_personal ? 1 : 0,
        subject.duration ?? 0,
        subject.activity_breakdown ?? null,
        subject.metadata ?? null,
        nowISO()
      );
    }
  });

  const linkMany = db.transaction(
    (links: Array<{ subjectId: string; topicBlockId: string }>) => {
      for (const link of links) {
        stmts.insertLink.run(link.subjectId, link.topicBlockId);
      }
    }
  );

  return {
    findById(id: string): DbSubject | null {
      const row = stmts.findById.get(id);
      return (row as DbSubject) ?? null;
    },

    findByRecording(recordingId: string): DbSubject[] {
      return stmts.findByRecording.all(recordingId) as DbSubject[];
    },

    save(subject: DbSubjectInsert): void {
      stmts.insert.run(
        subject.id,
        subject.recording_id,
        subject.label,
        subject.is_personal ? 1 : 0,
        subject.duration ?? 0,
        subject.activity_breakdown ?? null,
        subject.metadata ?? null,
        nowISO()
      );
    },

    saveBatch(subjects: DbSubjectInsert[]): void {
      insertMany(subjects);
    },

    linkTopicBlocksBatch(
      links: Array<{ subjectId: string; topicBlockId: string }>
    ): void {
      linkMany(links);
    },

    getTopicBlocks(subjectId: string): DbTopicBlock[] {
      return stmts.getTopicBlocks.all(subjectId) as DbTopicBlock[];
    },

    deleteByRecording(recordingId: string): void {
      stmts.deleteLinksByRecording.run(recordingId);
      stmts.deleteByRecording.run(recordingId);
    },
  };
}
