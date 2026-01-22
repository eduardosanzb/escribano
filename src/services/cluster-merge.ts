/**
 * Escribano - Cluster Merge Service
 *
 * Merges audio clusters with visual clusters based on classification similarity.
 * Many-to-many: one audio cluster can merge with multiple visual clusters.
 */

import type { DbCluster, EmbeddingService } from '../0_types.js';
import type { ExtractedSignals } from './signal-extraction.js';

export interface ClusterWithSignals {
  cluster: DbCluster;
  signals: ExtractedSignals;
  centroid: number[];
}

export interface MergeResult {
  visualClusterId: string;
  audioClusterId: string;
  similarityScore: number;
  mergeReason:
    | 'shared_topic'
    | 'shared_app'
    | 'shared_project'
    | 'centroid_similarity';
}

const MERGE_THRESHOLD = 0.6; // Minimum similarity for merge

/**
 * Find all valid merges between visual and audio clusters.
 * Returns many-to-many: each audio cluster can merge with multiple visual clusters.
 */
export function findClusterMerges(
  visualClusters: ClusterWithSignals[],
  audioClusters: ClusterWithSignals[],
  embeddingService: EmbeddingService
): MergeResult[] {
  const merges: MergeResult[] = [];

  for (const audio of audioClusters) {
    for (const visual of visualClusters) {
      const result = computeMerge(visual, audio, embeddingService);
      if (result) {
        merges.push(result);
      }
    }
  }

  return merges;
}

function computeMerge(
  visual: ClusterWithSignals,
  audio: ClusterWithSignals,
  embeddingService: EmbeddingService
): MergeResult | null {
  // Check shared topics
  const sharedTopics = visual.signals.topics.filter((t) =>
    audio.signals.topics.some(
      (at) =>
        t.toLowerCase().includes(at.toLowerCase()) ||
        at.toLowerCase().includes(t.toLowerCase())
    )
  );
  if (sharedTopics.length > 0) {
    return {
      visualClusterId: visual.cluster.id,
      audioClusterId: audio.cluster.id,
      similarityScore: 1.0,
      mergeReason: 'shared_topic',
    };
  }

  // Check shared apps
  const sharedApps = visual.signals.apps.filter((a) =>
    audio.signals.apps.includes(a)
  );
  if (sharedApps.length > 0) {
    return {
      visualClusterId: visual.cluster.id,
      audioClusterId: audio.cluster.id,
      similarityScore: 0.9,
      mergeReason: 'shared_app',
    };
  }

  // Check shared projects
  const sharedProjects = visual.signals.projects.filter((p) =>
    audio.signals.projects.includes(p)
  );
  if (sharedProjects.length > 0) {
    return {
      visualClusterId: visual.cluster.id,
      audioClusterId: audio.cluster.id,
      similarityScore: 0.85,
      mergeReason: 'shared_project',
    };
  }

  // Fallback: centroid similarity
  if (visual.centroid.length > 0 && audio.centroid.length > 0) {
    const similarity = embeddingService.similarity(
      visual.centroid,
      audio.centroid
    );
    if (similarity >= MERGE_THRESHOLD) {
      return {
        visualClusterId: visual.cluster.id,
        audioClusterId: audio.cluster.id,
        similarityScore: similarity,
        mergeReason: 'centroid_similarity',
      };
    }
  }

  return null;
}
