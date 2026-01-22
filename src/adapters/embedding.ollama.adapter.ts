/**
 * Escribano - Embedding Adapter (Ollama)
 *
 * Simplified atomic worker for Ollama REST /api/embed API.
 * Batching and parallelism are handled by the pipeline, not here.
 */

import type {
  EmbeddingBatchOptions,
  EmbeddingService,
  IntelligenceConfig,
} from '../0_types.js';

const MIN_TEXT_LENGTH = 5;
const DEFAULT_TIMEOUT_MS = 600_000; // 10 minutes
const MAX_RETRIES = 3;

export function createOllamaEmbeddingService(
  config: IntelligenceConfig
): EmbeddingService {
  const baseUrl = config.endpoint.replace('/api/chat', '');
  const model =
    process.env.ESCRIBANO_EMBED_MODEL ||
    config.embedding?.model ||
    'qwen3-embedding:8b';

  /**
   * Call Ollama /api/embed endpoint with retry logic
   */
  async function callEmbedAPI(
    texts: string[],
    externalSignal?: AbortSignal
  ): Promise<number[][]> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        DEFAULT_TIMEOUT_MS
      );

      // Link external signal if provided
      if (externalSignal) {
        externalSignal.addEventListener('abort', () => controller.abort());
      }

      try {
        const response = await fetch(`${baseUrl}/api/embed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            input: texts,
            truncate: true,
            options: {
              num_ctx: 40000,
            },
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `Ollama embed error: ${response.status} ${response.statusText} - ${errorText.substring(0, 200)}`
          );
        }

        const data = await response.json();
        return data.embeddings;
      } catch (error) {
        lastError = error as Error;
        const isRetryable =
          lastError.message.includes('abort') ||
          lastError.message.includes('500') ||
          lastError.message.includes('ECONNRESET');

        if (isRetryable && attempt < MAX_RETRIES) {
          const delay = 2 ** attempt * 1000; // Exponential backoff
          console.warn(
            `[Embedding] Attempt ${attempt}/${MAX_RETRIES} failed, retrying in ${delay / 1000}s...`
          );
          await new Promise((r) => setTimeout(r, delay));
        } else {
          // If not retryable or max retries reached, don't just continue the loop
          break;
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }

    throw lastError || new Error('Embedding failed after retries');
  }

  return {
    embed: async (
      text: string,
      taskType?: 'clustering' | 'retrieval'
    ): Promise<number[]> => {
      if (!text || text.trim().length < MIN_TEXT_LENGTH) {
        return [];
      }

      const prefix =
        taskType === 'clustering'
          ? 'Instruct: Cluster screen recording observations for semantic similarity\n'
          : '';

      const results = await callEmbedAPI([prefix + text]);
      return results[0] || [];
    },

    embedBatch: async (
      texts: string[],
      taskType?: 'clustering' | 'retrieval',
      options?: EmbeddingBatchOptions
    ): Promise<number[][]> => {
      const prefix =
        taskType === 'clustering'
          ? 'Instruct: Cluster screen recording observations for semantic similarity\n'
          : '';

      // Filter valid texts and track indices
      const validItems: { index: number; text: string }[] = [];
      for (let i = 0; i < texts.length; i++) {
        if (texts[i] && texts[i].trim().length >= MIN_TEXT_LENGTH) {
          validItems.push({ index: i, text: prefix + texts[i] });
        }
      }

      if (validItems.length === 0) {
        return new Array(texts.length).fill([]);
      }

      // Single API call for this batch
      const textsToEmbed = validItems.map((v) => v.text);
      const embeddings = await callEmbedAPI(textsToEmbed, options?.signal);

      // Reconstruct full array in original order
      const finalEmbeddings: number[][] = new Array(texts.length).fill([]);
      for (let i = 0; i < validItems.length; i++) {
        finalEmbeddings[validItems[i].index] = embeddings[i] || [];
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
