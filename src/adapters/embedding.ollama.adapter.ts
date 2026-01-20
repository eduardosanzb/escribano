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
  const model = config.embedding?.model || 'nomic-embed-text';

  return {
    embed: async (text: string): Promise<number[]> => {
      const response = await fetch(`${baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt: text,
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

    embedBatch: async (texts: string[]): Promise<number[][]> => {
      // Ollama doesn't support batch embeddings in a single call yet,
      // so we do them sequentially to avoid overwhelming the server.
      const embeddings: number[][] = [];
      for (const text of texts) {
        embeddings.push(await createOllamaEmbeddingService(config).embed(text));
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
  };
}
