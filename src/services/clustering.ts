/**
 * Escribano - Semantic Clustering Service
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ALGORITHM: Agglomerative Hierarchical Clustering with Time Constraints
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * WHAT IT DOES:
 * Groups observations into semantic clusters based on embedding similarity,
 * while respecting temporal constraints (observations far apart in time
 * shouldn't cluster together even if semantically similar).
 *
 * WHY AGGLOMERATIVE:
 * - No need to specify number of clusters upfront (unlike K-means)
 * - Natural hierarchical structure matches how work sessions evolve
 * - Can stop at any similarity threshold
 *
 * HOW IT WORKS:
 *
 * 1. INITIALIZATION
 *    - Start with N clusters, each containing one observation
 *    - Pre-compute all pairwise distances (1 - cosine_similarity)
 *    - Apply time constraint: if |timestamp_i - timestamp_j| > timeWindow,
 *      set distance to Infinity (can never merge)
 *
 * 2. ITERATIVE MERGING
 *    - Find the two closest clusters (single-linkage: min distance between any pair)
 *    - If closest distance > threshold → STOP (clusters are distinct enough)
 *    - Otherwise, merge them into one cluster
 *    - Repeat until no more merges possible
 *
 * 3. POST-PROCESSING
 *    - Small clusters (< minSize) are merged with their nearest neighbor
 *    - Prevents fragmentation from noise or outliers
 *
 * EXAMPLE:
 *
 *   Input: 10 observations with embeddings
 *
 *   Step 1: [1] [2] [3] [4] [5] [6] [7] [8] [9] [10]  (10 clusters)
 *   Step 2: [1,2] [3] [4] [5] [6] [7] [8] [9] [10]    (obs 1 & 2 merged)
 *   Step 3: [1,2] [3,4] [5] [6] [7] [8] [9] [10]      (obs 3 & 4 merged)
 *   ...
 *   Final:  [1,2,3,4] [5,6,7] [8,9,10]                (3 clusters)
 *
 * TIME CONSTRAINT VISUALIZATION:
 *
 *   Time:    0min ──────────────────────────── 60min
 *   Obs:     ●●●●●         ●●●●           ●●●●●●
 *            └─────┘       └────┘         └──────┘
 *            Cluster A     Cluster B      Cluster C
 *
 *   Even if B is semantically similar to A, they won't merge if
 *   the time gap exceeds timeWindowSeconds.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import type { DbObservation, EmbeddingService } from '../0_types.js';

export interface ClusteringConfig {
  /** Maximum time gap (seconds) between observations to allow direct clustering */
  timeWindowSeconds: number;
  /** Distance threshold for clustering (0-1, lower = tighter clusters) */
  distanceThreshold: number;
  /** Minimum observations per cluster */
  minClusterSize: number;
}

export interface ClusterResult {
  clusterId: string;
  observations: DbObservation[];
  centroid: number[];
  startTimestamp: number;
  endTimestamp: number;
}

const DEFAULT_CONFIG: ClusteringConfig = {
  timeWindowSeconds: 600, // 10 minutes
  distanceThreshold: 0.4, // 0.6 similarity threshold
  minClusterSize: 3,
};

/**
 * Main clustering function.
 *
 * @param observations - Observations to cluster (must have embeddings)
 * @param embeddingService - Service for computing similarity
 * @param config - Clustering parameters
 * @returns Array of clusters, sorted by start timestamp
 */
export function clusterObservations(
  observations: DbObservation[],
  embeddingService: EmbeddingService,
  config: Partial<ClusteringConfig> = {}
): ClusterResult[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Filter to observations with valid embeddings
  const validObs = observations.filter((obs) => obs.embedding?.length);
  if (validObs.length === 0) return [];

  // Parse embeddings from Buffer format
  const embeddings = validObs.map((obs) => bufferToEmbedding(obs.embedding!));

  // STEP 1: Initialize - each observation is its own cluster
  // Clusters are represented as arrays of indices into validObs
  let clusters: number[][] = validObs.map((_, index) => [index]);

  // STEP 2: Pre-compute distance matrix with time constraints
  const distances = computeDistanceMatrix(
    validObs,
    embeddings,
    embeddingService,
    cfg.timeWindowSeconds
  );

  // STEP 3: Agglomerative merging
  // Keep merging until no clusters are close enough
  let mergeCount = 0;
  const maxMerges = validObs.length; // Safety limit

  while (mergeCount < maxMerges) {
    const closest = findClosestClusterPair(clusters, distances);

    // Exit condition: no clusters are close enough to merge
    if (closest.distance > cfg.distanceThreshold) {
      break;
    }

    // Merge the two closest clusters
    clusters = mergeClusters(clusters, closest.indexA, closest.indexB);
    mergeCount++;
  }

  // STEP 4: Post-process - absorb small clusters
  clusters = absorbSmallClusters(clusters, distances, cfg.minClusterSize);

  // STEP 5: Build result objects
  return clusters
    .map((indices) =>
      buildClusterResult(indices, validObs, embeddings, embeddingService)
    )
    .sort((a, b) => a.startTimestamp - b.startTimestamp);
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Convert SQLite BLOB buffer to number array.
 */
function bufferToEmbedding(buffer: Buffer): number[] {
  const float32 = new Float32Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.length / 4
  );
  return Array.from(float32);
}

/**
 * Compute NxN distance matrix.
 * Distance = 1 - cosine_similarity (so 0 = identical, 1 = orthogonal)
 * Time-violating pairs get Infinity distance.
 */
function computeDistanceMatrix(
  observations: DbObservation[],
  embeddings: number[][],
  embeddingService: EmbeddingService,
  timeWindowSeconds: number
): number[][] {
  const n = observations.length;

  // Initialize with Infinity (no connection)
  const matrix: number[][] = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => Infinity)
  );

  // Fill in distances for valid pairs
  for (const [i, obsA] of observations.entries()) {
    matrix[i][i] = 0; // Self-distance is 0

    for (const [j, obsB] of observations.entries()) {
      if (j <= i) continue; // Only compute upper triangle

      // Time constraint check
      const timeDiff = Math.abs(obsA.timestamp - obsB.timestamp);
      if (timeDiff > timeWindowSeconds) {
        continue; // Leave as Infinity
      }

      // Compute semantic distance
      const similarity = embeddingService.similarity(
        embeddings[i],
        embeddings[j]
      );
      const distance = 1 - similarity;

      // Symmetric matrix
      matrix[i][j] = distance;
      matrix[j][i] = distance;
    }
  }

  return matrix;
}

/**
 * Find the two clusters with minimum distance (single-linkage).
 * Single-linkage = minimum distance between ANY pair of points from each cluster.
 */
function findClosestClusterPair(
  clusters: number[][],
  distances: number[][]
): { indexA: number; indexB: number; distance: number } {
  let minDistance = Infinity;
  let bestA = -1;
  let bestB = -1;

  for (const [i, clusterA] of clusters.entries()) {
    for (const [j, clusterB] of clusters.entries()) {
      if (j <= i) continue; // Only check each pair once

      const pairDistance = computeClusterDistance(
        clusterA,
        clusterB,
        distances
      );

      if (pairDistance < minDistance) {
        minDistance = pairDistance;
        bestA = i;
        bestB = j;
      }
    }
  }

  return { indexA: bestA, indexB: bestB, distance: minDistance };
}

/**
 * Single-linkage distance between two clusters.
 * Returns the minimum distance between any observation in A and any in B.
 */
function computeClusterDistance(
  clusterA: number[],
  clusterB: number[],
  distances: number[][]
): number {
  let minDist = Infinity;

  for (const i of clusterA) {
    for (const j of clusterB) {
      if (distances[i][j] < minDist) {
        minDist = distances[i][j];
      }
    }
  }

  return minDist;
}

/**
 * Merge two clusters by combining their observation indices.
 * Returns new cluster array with merged result.
 */
function mergeClusters(
  clusters: number[][],
  indexA: number,
  indexB: number
): number[][] {
  // Ensure indexA < indexB for consistent splicing
  const [smaller, larger] =
    indexA < indexB ? [indexA, indexB] : [indexB, indexA];

  const merged = [...clusters[smaller], ...clusters[larger]];

  return clusters
    .filter((_, index) => index !== smaller && index !== larger)
    .concat([merged]);
}

/**
 * Absorb clusters smaller than minSize into their nearest neighbor.
 */
function absorbSmallClusters(
  clusters: number[][],
  distances: number[][],
  minSize: number
): number[][] {
  const large = clusters.filter((c) => c.length >= minSize);
  const small = clusters.filter((c) => c.length < minSize);

  if (large.length === 0) {
    // All clusters are small - just return them
    return clusters;
  }

  // Merge each small cluster into nearest large cluster
  for (const smallCluster of small) {
    let nearestIndex = 0;
    let nearestDistance = Infinity;

    for (const [index, largeCluster] of large.entries()) {
      const dist = computeClusterDistance(
        smallCluster,
        largeCluster,
        distances
      );
      if (dist < nearestDistance) {
        nearestDistance = dist;
        nearestIndex = index;
      }
    }

    large[nearestIndex] = [...large[nearestIndex], ...smallCluster];
  }

  return large;
}

/**
 * Build a ClusterResult from observation indices.
 */
function buildClusterResult(
  indices: number[],
  observations: DbObservation[],
  embeddings: number[][],
  embeddingService: EmbeddingService
): ClusterResult {
  const clusterObs = indices.map((i) => observations[i]);
  const clusterEmbeddings = indices.map((i) => embeddings[i]);

  return {
    clusterId: `cluster-${Date.now()}`, // Placeholder, replaced with UUIDv7 later
    observations: clusterObs,
    centroid: embeddingService.centroid(clusterEmbeddings),
    startTimestamp: Math.min(...clusterObs.map((o) => o.timestamp)),
    endTimestamp: Math.max(
      ...clusterObs.map((o) => o.end_timestamp ?? o.timestamp)
    ),
  };
}
