export * from './ocr.js';

/**
 * Convert SQLite BLOB buffer to number array.
 */
export function bufferToEmbedding(buffer: Buffer): number[] {
  const float32 = new Float32Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.length / 4
  );
  return Array.from(float32);
}
