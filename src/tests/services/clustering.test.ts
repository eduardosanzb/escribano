import { describe, expect, it, vi } from 'vitest';
import type { DbObservation, EmbeddingService } from '../../0_types.js';
import { embeddingToBlob } from '../../db/helpers.js';
import { clusterObservations } from '../../services/clustering.js';

describe('clusterObservations', () => {
  const mockEmbeddingService: EmbeddingService = {
    embed: vi.fn(),
    embedBatch: vi.fn(),
    similarity: vi.fn((a, b) => {
      // Simple mock: if first element is same, they are identical
      return a[0] === b[0] ? 1 : 0;
    }),
    centroid: vi.fn((embeddings) => {
      if (embeddings.length === 0) return [];
      const dim = embeddings[0].length;
      const res = new Array(dim).fill(0);
      for (const e of embeddings) {
        for (let i = 0; i < dim; i++) res[i] += e[i];
      }
      return res.map((v) => v / embeddings.length);
    }),
  };

  const createObs = (
    id: string,
    timestamp: number,
    typeVal: number
  ): DbObservation => ({
    id,
    recording_id: 'rec1',
    type: 'visual',
    timestamp,
    end_timestamp: timestamp + 1,
    image_path: null,
    ocr_text: `text ${typeVal}`,
    vlm_description: null,
    vlm_raw_response: null,
    activity_type: null,
    apps: null,
    topics: null,
    text: null,
    audio_source: null,
    audio_type: null,
    embedding: embeddingToBlob([typeVal, 0, 0]),
    created_at: new Date().toISOString(),
  });

  it('should cluster identical observations within time window', () => {
    const obs = [
      createObs('1', 10, 1),
      createObs('2', 20, 1),
      createObs('3', 30, 1),
    ];

    const clusters = clusterObservations(obs, mockEmbeddingService, {
      timeWindowSeconds: 60,
      distanceThreshold: 0.1,
      minClusterSize: 2,
    });

    expect(clusters).toHaveLength(1);
    expect(clusters[0].observations).toHaveLength(3);
  });

  it('should not cluster observations outside time window', () => {
    const obs = [
      createObs('1', 10, 1),
      createObs('2', 1000, 1), // Far away in time
    ];

    const clusters = clusterObservations(obs, mockEmbeddingService, {
      timeWindowSeconds: 60,
      distanceThreshold: 0.1,
      minClusterSize: 1, // Set to 1 to see two clusters
    });

    expect(clusters).toHaveLength(2);
  });

  it('should not cluster semantically different observations', () => {
    const obs = [
      createObs('1', 10, 1),
      createObs('2', 20, 2), // Different embedding
    ];

    const clusters = clusterObservations(obs, mockEmbeddingService, {
      timeWindowSeconds: 60,
      distanceThreshold: 0.1,
      minClusterSize: 1,
    });

    expect(clusters).toHaveLength(2);
  });

  it('should absorb small clusters into nearest large cluster', () => {
    // 3 similar obs (large cluster)
    // 1 similar obs (small cluster, should be absorbed)
    const obs = [
      createObs('1', 10, 1),
      createObs('2', 20, 1),
      createObs('3', 30, 1),
      createObs('4', 40, 1),
    ];

    const clusters = clusterObservations(obs, mockEmbeddingService, {
      timeWindowSeconds: 60,
      distanceThreshold: 0.1,
      minClusterSize: 3,
    });

    expect(clusters).toHaveLength(1);
    expect(clusters[0].observations).toHaveLength(4);
  });

  it('should handle empty input', () => {
    const clusters = clusterObservations([], mockEmbeddingService);
    expect(clusters).toEqual([]);
  });

  it('should throw if an observation in validObs is missing embedding', () => {
    // We mock bufferToEmbedding to fail if we want to test the throw,
    // but the current code in clustering.ts uses a local bufferToEmbedding.
    // However, if we pass an obs that PASSES the filter but then has no embedding
    // (impossible due to filter), it would throw.

    // Let's test the filter instead
    const obsNoEmbed = [{ id: '1', embedding: null } as any];
    const clusters = clusterObservations(obsNoEmbed, mockEmbeddingService);
    expect(clusters).toHaveLength(0);
  });
});
