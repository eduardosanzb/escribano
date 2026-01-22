/**
 * Cluster Repository - SQLite Implementation
 */

import type Database from 'better-sqlite3';
import type {
  ClusterRepository,
  DbCluster,
  DbClusterInsert,
  DbObservation,
} from '../../0_types.js';
import { nowISO } from '../helpers.js';

export function createSqliteClusterRepository(
  db: Database.Database
): ClusterRepository {
  const stmts = {
    findById: db.prepare('SELECT * FROM clusters WHERE id = ?'),
    findByRecording: db.prepare(
      'SELECT * FROM clusters WHERE recording_id = ? ORDER BY start_timestamp ASC'
    ),
    findByRecordingAndType: db.prepare(
      'SELECT * FROM clusters WHERE recording_id = ? AND type = ? ORDER BY start_timestamp ASC'
    ),
    insert: db.prepare(`
      INSERT INTO clusters (id, recording_id, type, start_timestamp, end_timestamp, observation_count, centroid, classification, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    linkObservation: db.prepare(`
      INSERT OR REPLACE INTO observation_clusters (observation_id, cluster_id, distance)
      VALUES (?, ?, ?)
    `),
    getObservations: db.prepare(`
      SELECT o.* FROM observations o
      JOIN observation_clusters oc ON o.id = oc.observation_id
      WHERE oc.cluster_id = ?
      ORDER BY o.timestamp ASC
    `),
    updateClassification: db.prepare(
      'UPDATE clusters SET classification = ? WHERE id = ?'
    ),
    updateCentroid: db.prepare('UPDATE clusters SET centroid = ? WHERE id = ?'),
    saveMerge: db.prepare(`
      INSERT OR REPLACE INTO cluster_merges (visual_cluster_id, audio_cluster_id, similarity_score, merge_reason)
      VALUES (?, ?, ?, ?)
    `),
    getMergedAudioClusters: db.prepare(`
      SELECT c.* FROM clusters c
      JOIN cluster_merges cm ON c.id = cm.audio_cluster_id
      WHERE cm.visual_cluster_id = ?
    `),
    delete: db.prepare('DELETE FROM clusters WHERE id = ?'),
    deleteByRecording: db.prepare(
      'DELETE FROM clusters WHERE recording_id = ?'
    ),
  };

  const insertBatch = db.transaction((clusters: DbClusterInsert[]) => {
    for (const c of clusters) {
      stmts.insert.run(
        c.id,
        c.recording_id,
        c.type,
        c.start_timestamp,
        c.end_timestamp,
        c.observation_count,
        c.centroid,
        c.classification,
        c.metadata,
        nowISO()
      );
    }
  });

  const linkBatch = db.transaction(
    (
      links: Array<{
        observationId: string;
        clusterId: string;
        distance?: number;
      }>
    ) => {
      for (const link of links) {
        stmts.linkObservation.run(
          link.observationId,
          link.clusterId,
          link.distance ?? null
        );
      }
    }
  );

  return {
    findById(id) {
      return (stmts.findById.get(id) as DbCluster) ?? null;
    },
    findByRecording(recordingId) {
      return stmts.findByRecording.all(recordingId) as DbCluster[];
    },
    findByRecordingAndType(recordingId, type) {
      return stmts.findByRecordingAndType.all(recordingId, type) as DbCluster[];
    },
    save(cluster) {
      stmts.insert.run(
        cluster.id,
        cluster.recording_id,
        cluster.type,
        cluster.start_timestamp,
        cluster.end_timestamp,
        cluster.observation_count,
        cluster.centroid,
        cluster.classification,
        cluster.metadata,
        nowISO()
      );
    },
    saveBatch(clusters) {
      insertBatch(clusters);
    },
    linkObservation(obsId, clusterId, distance) {
      stmts.linkObservation.run(obsId, clusterId, distance ?? null);
    },
    linkObservationsBatch(links) {
      linkBatch(links);
    },
    getObservations(clusterId) {
      return stmts.getObservations.all(clusterId) as DbObservation[];
    },
    updateClassification(id, classification) {
      stmts.updateClassification.run(classification, id);
    },
    updateCentroid(id, centroid) {
      stmts.updateCentroid.run(
        Buffer.from(new Float32Array(centroid).buffer),
        id
      );
    },
    saveMerge(visualId, audioId, similarity, reason) {
      stmts.saveMerge.run(visualId, audioId, similarity, reason);
    },
    getMergedAudioClusters(visualId) {
      return stmts.getMergedAudioClusters.all(visualId) as DbCluster[];
    },
    delete(id) {
      stmts.delete.run(id);
    },
    deleteByRecording(recordingId) {
      stmts.deleteByRecording.run(recordingId);
    },
  };
}
