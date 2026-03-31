import { describe, expect, it } from 'vitest';
import { TimeRange } from '../../domain/time-range.js';

describe('TimeRange Value Object', () => {
  describe('create', () => {
    it('should return a valid range tuple', () => {
      expect(TimeRange.create(0, 10)).toEqual([0, 10]);
    });

    it('should throw for negative start value', () => {
      expect(() => TimeRange.create(-1, 10)).toThrow(
        'Values must be non-negative'
      );
    });

    it('should throw when end is less than start', () => {
      expect(() => TimeRange.create(10, 5)).toThrow(
        'End must be greater than or equal to start'
      );
    });

    it('should allow zero-length range (start equals end)', () => {
      expect(TimeRange.create(5, 5)).toEqual([5, 5]);
    });
  });

  describe('duration', () => {
    it('should return the difference between end and start', () => {
      expect(TimeRange.duration([0, 10])).toBe(10);
    });
  });

  describe('overlaps', () => {
    it('should return true when ranges partially overlap', () => {
      expect(TimeRange.overlaps([0, 10], [5, 15])).toBe(true);
    });

    it('should return false when ranges only touch at a boundary', () => {
      expect(TimeRange.overlaps([0, 10], [10, 20])).toBe(false);
    });

    it('should return false when ranges do not overlap', () => {
      expect(TimeRange.overlaps([0, 10], [11, 20])).toBe(false);
    });
  });

  describe('overlapDuration', () => {
    it('should calculate partial overlap correctly', () => {
      expect(TimeRange.overlapDuration([0, 10], [5, 15])).toBe(5);
    });

    it('should return 0 when there is no overlap', () => {
      expect(TimeRange.overlapDuration([0, 10], [20, 30])).toBe(0);
    });
  });

  describe('format', () => {
    it('should format a range as "m:ss → m:ss"', () => {
      expect(TimeRange.format([65, 130])).toBe('1:05 → 2:10');
    });
  });

  describe('contains', () => {
    it('should return true when timestamp is within the range', () => {
      expect(TimeRange.contains([0, 10], 5)).toBe(true);
    });

    it('should return true for the inclusive start boundary', () => {
      expect(TimeRange.contains([0, 10], 0)).toBe(true);
    });

    it('should return true for the inclusive end boundary', () => {
      expect(TimeRange.contains([0, 10], 10)).toBe(true);
    });

    it('should return false when timestamp is outside the range', () => {
      expect(TimeRange.contains([0, 10], 11)).toBe(false);
    });
  });
});
