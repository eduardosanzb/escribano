import { describe, expect, it } from 'vitest';
import { TimeRange } from '../../domain/time-range.js';

describe('TimeRange Value Object', () => {
  describe('overlapDuration', () => {
    it('should return 0 when there is no overlap', () => {
      const overlap = TimeRange.overlapDuration([0, 10], [20, 30]);
      expect(overlap).toBe(0);
    });

    it('should calculate partial overlap correctly', () => {
      // Overlap between [0, 10] and [5, 15] is [5, 10] = 5 seconds
      const overlap = TimeRange.overlapDuration([0, 10], [5, 15]);
      expect(overlap).toBe(5);
    });

    it('should handle range fully contained within another', () => {
      const overlap = TimeRange.overlapDuration([0, 100], [10, 20]);
      expect(overlap).toBe(10);
    });

    it('should handle segments fully contained within range', () => {
      const overlap = TimeRange.overlapDuration([0, 10], [2, 8]);
      expect(overlap).toBe(6);
    });
  });

  describe('create', () => {
    it('should throw for negative values', () => {
      expect(() => TimeRange.create(-1, 10)).toThrow();
    });

    it('should throw for end < start', () => {
      expect(() => TimeRange.create(10, 5)).toThrow();
    });
  });
});
