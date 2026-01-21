/**
 * Database Helpers
 *
 * Utilities for ID generation, embedding conversion, etc.
 */

import { uuidv7 } from 'uuidv7';

/**
 * Generate a time-sortable unique ID (UUIDv7)
 */
export function generateId(): string {
  return uuidv7();
}

/**
 * Convert Float32Array embedding to Buffer for SQLite BLOB storage
 */
export function embeddingToBlob(embedding: number[]): Buffer {
  const float32 = new Float32Array(embedding);
  return Buffer.from(float32.buffer);
}

/**
 * Convert SQLite BLOB back to number array
 */
export function blobToEmbedding(blob: Buffer): number[] {
  const float32 = new Float32Array(
    blob.buffer,
    blob.byteOffset,
    blob.length / 4
  );
  return Array.from(float32);
}

/**
 * Compute cosine similarity between two embeddings
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

/**
 * Get current ISO8601 timestamp for SQLite
 */
export function nowISO(): string {
  return new Date().toISOString();
}
