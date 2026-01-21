/**
 * Escribano - Embedding Adapter (Ollama)
 *
 * Implements EmbeddingService using Ollama REST API
 */

import type {
  EmbeddingConfig,
  EmbeddingService,
  IntelligenceConfig,
} from '../0_types.js';

export function createOllamaEmbeddingService(
  config: IntelligenceConfig
): EmbeddingService {
  const baseUrl = config.endpoint.replace('/api/chat', '');
  const model =
    process.env.ESCRIBANO_EMBED_MODEL ||
    config.embedding?.model ||
    'qwen3-embedding:0.6b';

  return {
    embed: async (
      text: string,
      taskType?: 'clustering' | 'retrieval'
    ): Promise<number[]> => {
      // qwen3-embedding supports instruction prefixes for better task-specific embeddings
      const prefix =
        taskType === 'clustering'
          ? 'Instruct: Cluster screen recording observations for semantic similarity\n'
          : '';

      const response = await fetch(`${baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt: prefix + text,
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Ollama embedding error: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json();
      return data.embedding;
    },

    embedBatch: async (
      texts: string[],
      taskType?: 'clustering' | 'retrieval'
    ): Promise<number[][]> => {
      // Ollama doesn't support batch embeddings in a single call yet,
      // so we do them sequentially to avoid overwhelming the server.
      const embeddings: number[][] = [];
      const service = createOllamaEmbeddingService(config);
      for (const text of texts) {
        embeddings.push(await service.embed(text, taskType));
      }
      return embeddings;
    },

    similarity: (a: number[], b: number[]): number => {
      if (a.length !== b.length) {
        throw new Error(
          `Embedding dimensions mismatch: ${a.length} vs ${b.length}`
        );
      }

      // Cosine similarity for normalized vectors is just the dot product
      let dotProduct = 0;
      let normA = 0;
      let normB = 0;

      for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
      }

      const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
      return similarity;
    },

    centroid: (embeddings: number[][]): number[] => {
      if (embeddings.length === 0) return [];
      if (embeddings.length === 1) return embeddings[0];

      const dim = embeddings[0].length;
      const result = new Array(dim).fill(0);

      for (const emb of embeddings) {
        for (let i = 0; i < dim; i++) {
          result[i] += emb[i];
        }
      }

      for (let i = 0; i < dim; i++) {
        result[i] /= embeddings.length;
      }

      return result;
    },
  };
}
