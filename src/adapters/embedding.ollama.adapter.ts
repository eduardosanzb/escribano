/**
 * Escribano - Embedding Adapter (Ollama)
 *
 * Implements EmbeddingService using Ollama REST /api/embed API
 */

import type { EmbeddingService, IntelligenceConfig } from '../0_types.js';

// Module-level cache for the discovered maximum batch size
// Starts aggressive (512), will shrink if Ollama returns 500 errors
let discoveredMaxBatchSize = 512;

const MIN_TEXT_LENGTH = 5;

export function createOllamaEmbeddingService(
  config: IntelligenceConfig
): EmbeddingService {
  const baseUrl = config.endpoint.replace('/api/chat', '');
  const model =
    process.env.ESCRIBANO_EMBED_MODEL ||
    config.embedding?.model ||
    'qwen3-embedding:0.6b';

  /**
   * Internal helper to call the Ollama /api/embed endpoint
   */
  async function callEmbedAPI(
    texts: string[],
    currentModel: string,
    currentBaseUrl: string
  ): Promise<number[][]> {
    const response = await fetch(`${currentBaseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: currentModel,
        input: texts,
        truncate: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Ollama embed error: ${response.status} ${response.statusText} - ${errorText.substring(0, 200)}`
      );
    }

    const data = await response.json();
    return data.embeddings;
  }

  /**
   * Adaptive batch processor that shrinks batch size on 500 errors
   */
  async function processBatchWithAdaptiveRetry(
    items: { index: number; text: string }[],
    currentModel: string,
    currentBaseUrl: string
  ): Promise<{ index: number; embedding: number[] }[]> {
    const results: { index: number; embedding: number[] }[] = [];
    let i = 0;

    while (i < items.length) {
      // Use the currently discovered safe batch size
      const currentBatchSize = Math.min(
        discoveredMaxBatchSize,
        items.length - i
      );
      const batch = items.slice(i, i + currentBatchSize);
      const batchTexts = batch.map((v) => v.text);

      let success = false;
      let attemptSize = currentBatchSize;
      let retries = 0;

      while (!success && attemptSize >= 1) {
        try {
          // Progress logging for large operations
          if (items.length > 50) {
            process.stdout.write(
              `\rEmbedding progress: ${Math.round((i / items.length) * 100)}% (${i}/${items.length})   `
            );
          }

          const embeddings = await callEmbedAPI(
            batchTexts.slice(0, attemptSize),
            currentModel,
            currentBaseUrl
          );

          // Success! Map results back
          for (let j = 0; j < embeddings.length; j++) {
            results.push({ index: batch[j].index, embedding: embeddings[j] });
          }

          // If we successfully processed a smaller size than requested,
          // we update the discovered limit
          if (attemptSize < currentBatchSize) {
            discoveredMaxBatchSize = Math.max(10, attemptSize);
          }

          i += attemptSize;
          success = true;
        } catch (error) {
          const is500 = (error as Error).message.includes('500');

          if (is500 && attemptSize > 1) {
            // Shrink batch size and retry
            attemptSize = Math.floor(attemptSize / 2);
            retries++;
            console.warn(
              `\n[Embedding] Batch failed, shrinking to ${attemptSize} (Attempt ${retries})...`
            );
            // Small delay before retry
            await new Promise((resolve) => setTimeout(resolve, 500 * retries));
          } else {
            // Non-recoverable error or reached min size
            console.error('\n[Embedding] Fatal error processing batch:', error);
            throw error;
          }
        }
      }
    }

    if (items.length > 50) process.stdout.write('\n');
    return results;
  }

  return {
    embed: async (
      text: string,
      taskType?: 'clustering' | 'retrieval'
    ): Promise<number[]> => {
      if (!text || text.trim().length < MIN_TEXT_LENGTH) {
        return [];
      }

      // qwen3-embedding supports instruction prefixes for better task-specific embeddings
      const prefix =
        taskType === 'clustering'
          ? 'Instruct: Cluster screen recording observations for semantic similarity\n'
          : '';

      const results = await callEmbedAPI([prefix + text], model, baseUrl);
      return results[0] || [];
    },

    embedBatch: async (
      texts: string[],
      taskType?: 'clustering' | 'retrieval'
    ): Promise<number[][]> => {
      // 1. Pre-filter empty/short texts and track original indices
      // Also apply instruction prefix if task is clustering
      const prefix =
        taskType === 'clustering'
          ? 'Instruct: Cluster screen recording observations for semantic similarity\n'
          : '';

      const validItems: { index: number; text: string }[] = [];
      for (let i = 0; i < texts.length; i++) {
        if (texts[i] && texts[i].trim().length >= MIN_TEXT_LENGTH) {
          validItems.push({ index: i, text: prefix + texts[i] });
        }
      }

      if (validItems.length === 0) {
        return new Array(texts.length).fill([]);
      }

      // 2. Process valid items using adaptive batching
      const embeddedResults = await processBatchWithAdaptiveRetry(
        validItems,
        model,
        baseUrl
      );

      // 3. Reconstruct full array in original order
      const finalEmbeddings: number[][] = new Array(texts.length).fill([]);
      for (const r of embeddedResults) {
        finalEmbeddings[r.index] = r.embedding;
      }

      return finalEmbeddings;
    },

    similarity: (a: number[], b: number[]): number => {
      if (a.length === 0 || b.length === 0) return 0;
      if (a.length !== b.length) {
        throw new Error(
          `Embedding dimensions mismatch: ${a.length} vs ${b.length}`
        );
      }

      let dotProduct = 0;
      let normA = 0;
      let normB = 0;

      for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
      }

      if (normA === 0 || normB === 0) return 0;
      return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    },

    centroid: (embeddings: number[][]): number[] => {
      const valid = embeddings.filter((e) => e.length > 0);
      if (valid.length === 0) return [];
      if (valid.length === 1) return valid[0];

      const dim = valid[0].length;
      const result = new Array(dim).fill(0);

      for (const emb of valid) {
        for (let i = 0; i < dim; i++) {
          result[i] += emb[i];
        }
      }

      for (let i = 0; i < dim; i++) {
        result[i] /= valid.length;
      }

      return result;
    },
  };
}
