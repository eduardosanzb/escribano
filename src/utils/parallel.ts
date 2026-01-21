/**
 * Parallel Map Utility
 *
 * Executes async operations with bounded concurrency.
 * Results are returned in the same order as input items.
 */

export async function parallelMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  if (items.length === 0) return [];

  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const actualConcurrency = Math.max(1, concurrency);

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await fn(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from(
    { length: Math.min(actualConcurrency, items.length) },
    worker
  );
  await Promise.all(workers);
  return results;
}

/**
 * Chunk an array into smaller arrays of specified size
 */
export function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
