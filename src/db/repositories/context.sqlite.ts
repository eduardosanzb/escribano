/**
 * Context Repository - SQLite Implementation
 */

import type Database from 'better-sqlite3';
import type {
  ContextRepository,
  DbContext,
  DbContextInsert,
  DbObservationContext,
} from '../../0_types.js';
import { nowISO } from '../helpers.js';

export function createSqliteContextRepository(
  db: Database.Database
): ContextRepository {
  const stmts = {
    findById: db.prepare('SELECT * FROM contexts WHERE id = ?'),
    findByTypeAndName: db.prepare(
      'SELECT * FROM contexts WHERE type = ? AND name = ?'
    ),
    findAll: db.prepare('SELECT * FROM contexts ORDER BY created_at DESC'),
    insert: db.prepare(`
      INSERT INTO contexts (id, type, name, metadata, created_at)
      VALUES (?, ?, ?, ?, ?)
    `),
    insertOrIgnore: db.prepare(`
      INSERT OR IGNORE INTO contexts (id, type, name, metadata, created_at)
      VALUES (?, ?, ?, ?, ?)
    `),
    linkObservation: db.prepare(`
      INSERT OR REPLACE INTO observation_contexts (observation_id, context_id, confidence)
      VALUES (?, ?, ?)
    `),
    unlinkObservation: db.prepare(`
      DELETE FROM observation_contexts WHERE observation_id = ? AND context_id = ?
    `),
    getObservationLinks: db.prepare(`
      SELECT * FROM observation_contexts WHERE context_id = ?
    `),
    getObservationLinksByObservation: db.prepare(`
      SELECT * FROM observation_contexts WHERE observation_id = ?
    `),
    getLinksByRecording: db.prepare(`
      SELECT oc.* FROM observation_contexts oc
      JOIN observations o ON oc.observation_id = o.id
      WHERE o.recording_id = ?
    `),
    delete: db.prepare('DELETE FROM contexts WHERE id = ?'),
  };

  return {
    findById(id: string): DbContext | null {
      const row = stmts.findById.get(id);
      return (row as DbContext) ?? null;
    },

    findByTypeAndName(type: string, name: string): DbContext | null {
      const row = stmts.findByTypeAndName.get(type, name);
      return (row as DbContext) ?? null;
    },

    findAll(): DbContext[] {
      return stmts.findAll.all() as DbContext[];
    },

    save(context: DbContextInsert): void {
      stmts.insert.run(
        context.id,
        context.type,
        context.name,
        context.metadata,
        nowISO()
      );
    },

    saveOrIgnore(context: DbContextInsert): void {
      stmts.insertOrIgnore.run(
        context.id,
        context.type,
        context.name,
        context.metadata,
        nowISO()
      );
    },

    linkObservation(
      observationId: string,
      contextId: string,
      confidence = 1.0
    ): void {
      stmts.linkObservation.run(observationId, contextId, confidence);
    },

    unlinkObservation(observationId: string, contextId: string): void {
      stmts.unlinkObservation.run(observationId, contextId);
    },

    getObservationLinks(contextId: string): DbObservationContext[] {
      return stmts.getObservationLinks.all(contextId) as DbObservationContext[];
    },

    getObservationLinksByObservation(
      observationId: string
    ): DbObservationContext[] {
      return stmts.getObservationLinksByObservation.all(
        observationId
      ) as DbObservationContext[];
    },

    getLinksByRecording(recordingId: string): DbObservationContext[] {
      return stmts.getLinksByRecording.all(
        recordingId
      ) as DbObservationContext[];
    },

    delete(id: string): void {
      stmts.delete.run(id);
    },
  };
}
