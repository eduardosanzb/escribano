import { describe, expect, it, vi } from 'vitest';
import { chunkArray, parallelMap } from '../../utils/parallel.js';

describe('parallelMap', () => {
  it('should process items and return results in order', async () => {
    const items = [1, 2, 3, 4, 5];
    const fn = async (n: number) => n * 2;
    const results = await parallelMap(items, fn, 2);
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it('should respect concurrency limits', async () => {
    const items = [100, 100, 100, 100];
    let activeCount = 0;
    let maxActive = 0;

    const fn = async (ms: number) => {
      activeCount++;
      maxActive = Math.max(maxActive, activeCount);
      await new Promise((resolve) => setTimeout(resolve, ms));
      activeCount--;
      return ms;
    };

    const concurrency = 2;
    await parallelMap(items, fn, concurrency);

    expect(maxActive).toBeLessThanOrEqual(concurrency);
  });

  it('should handle empty input array', async () => {
    const results = await parallelMap([], async (x) => x, 2);
    expect(results).toEqual([]);
  });

  it('should handle concurrency <= 0 by defaulting to 1', async () => {
    const items = [1, 2, 3];
    const fn = vi.fn(async (x) => x);

    const results0 = await parallelMap(items, fn, 0);
    expect(results0).toEqual([1, 2, 3]);

    const resultsNeg = await parallelMap(items, fn, -5);
    expect(resultsNeg).toEqual([1, 2, 3]);
  });

  it('should propagate errors and stop processing', async () => {
    const items = [1, 2, 3, 4, 5];
    const fn = async (n: number) => {
      if (n === 3) throw new Error('Failed');
      return n;
    };

    await expect(parallelMap(items, fn, 2)).rejects.toThrow('Failed');
  });
});

describe('chunkArray', () => {
  it('should split array into chunks', () => {
    const items = [1, 2, 3, 4, 5];
    expect(chunkArray(items, 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkArray(items, 5)).toEqual([[1, 2, 3, 4, 5]]);
    expect(chunkArray(items, 10)).toEqual([[1, 2, 3, 4, 5]]);
  });

  it('should handle empty array', () => {
    expect(chunkArray([], 2)).toEqual([]);
  });
});
