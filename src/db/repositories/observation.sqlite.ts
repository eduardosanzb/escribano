/**
 * Observation Repository - SQLite Implementation
 */

import type Database from 'better-sqlite3';
import type {
  DbObservation,
  DbObservationInsert,
  ObservationRepository,
} from '../../0_types.js';
import { nowISO } from '../helpers.js';

export function createSqliteObservationRepository(
  db: Database.Database
): ObservationRepository {
  const stmts = {
    findById: db.prepare('SELECT * FROM observations WHERE id = ?'),
    findByRecording: db.prepare(
      'SELECT * FROM observations WHERE recording_id = ? ORDER BY timestamp ASC'
    ),
    findByRecordingAndType: db.prepare(
      'SELECT * FROM observations WHERE recording_id = ? AND type = ? ORDER BY timestamp ASC'
    ),
    findByContext: db.prepare(`
      SELECT o.* FROM observations o
      JOIN observation_contexts oc ON o.id = oc.observation_id
      WHERE oc.context_id = ?
      ORDER BY o.created_at DESC
    `),
    insert: db.prepare(`
      INSERT INTO observations (
        id, recording_id, type, timestamp, end_timestamp,
        image_path, ocr_text, vlm_description,
        text, audio_source, audio_type, embedding, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    delete: db.prepare('DELETE FROM observations WHERE id = ?'),
    deleteByRecording: db.prepare(
      'DELETE FROM observations WHERE recording_id = ?'
    ),
  };

  return {
    findById(id: string): DbObservation | null {
      const row = stmts.findById.get(id);
      return (row as DbObservation) ?? null;
    },

    findByRecording(recordingId: string): DbObservation[] {
      return stmts.findByRecording.all(recordingId) as DbObservation[];
    },

    findByRecordingAndType(
      recordingId: string,
      type: 'visual' | 'audio'
    ): DbObservation[] {
      return stmts.findByRecordingAndType.all(
        recordingId,
        type
      ) as DbObservation[];
    },

    findByContext(contextId: string): DbObservation[] {
      return stmts.findByContext.all(contextId) as DbObservation[];
    },

    save(observation: DbObservationInsert): void {
      const now = nowISO();
      stmts.insert.run(
        observation.id,
        observation.recording_id,
        observation.type,
        observation.timestamp,
        observation.end_timestamp,
        observation.image_path,
        observation.ocr_text,
        observation.vlm_description,
        observation.text,
        observation.audio_source,
        observation.audio_type,
        observation.embedding,
        now
      );
    },

    saveBatch(observations: DbObservationInsert[]): void {
      const now = nowISO();
      const insertMany = db.transaction((obsList: DbObservationInsert[]) => {
        for (const obs of obsList) {
          stmts.insert.run(
            obs.id,
            obs.recording_id,
            obs.type,
            obs.timestamp,
            obs.end_timestamp,
            obs.image_path,
            obs.ocr_text,
            obs.vlm_description,
            obs.text,
            obs.audio_source,
            obs.audio_type,
            obs.embedding,
            now
          );
        }
      });
      insertMany(observations);
    },

    updateEmbedding(id: string, embedding: number[]): void {
      const stmt = db.prepare(
        'UPDATE observations SET embedding = ? WHERE id = ?'
      );
      const buffer = Buffer.from(new Float32Array(embedding).buffer);
      stmt.run(buffer, id);
    },

    updateVLMDescription(id: string, description: string): void {
      const stmt = db.prepare(
        'UPDATE observations SET vlm_description = ? WHERE id = ?'
      );
      stmt.run(description, id);
    },

    delete(id: string): void {
      stmts.delete.run(id);
    },

    deleteByRecording(recordingId: string): void {
      stmts.deleteByRecording.run(recordingId);
    },
  };
}
