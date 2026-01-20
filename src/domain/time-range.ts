/**
 * Escribano - TimeRange Value Object
 */

import { z } from 'zod';

export const timeRangeSchema = z.tuple([z.number(), z.number()]);
export type TimeRange = z.infer<typeof timeRangeSchema>;

export const TimeRange = {
  create: (start: number, end: number): TimeRange => {
    if (start < 0 || end < 0) {
      throw new Error(
        `Invalid time range: [${start}, ${end}]. Values must be non-negative.`
      );
    }
    if (end < start) {
      throw new Error(
        `Invalid time range: [${start}, ${end}]. End must be greater than or equal to start.`
      );
    }
    return [start, end];
  },

  duration: (range: TimeRange): number => range[1] - range[0],

  overlaps: (a: TimeRange, b: TimeRange): boolean => {
    return a[0] < b[1] && b[0] < a[1];
  },

  overlapDuration: (a: TimeRange, b: TimeRange): number => {
    if (!TimeRange.overlaps(a, b)) return 0;
    const start = Math.max(a[0], b[0]);
    const end = Math.min(a[1], b[1]);
    return end - start;
  },

  format: (range: TimeRange): string => {
    const fmt = (s: number) => {
      const mins = Math.floor(s / 60);
      const secs = Math.floor(s % 60);
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    };
    return `${fmt(range[0])} → ${fmt(range[1])}`;
  },

  contains: (range: TimeRange, timestamp: number): boolean => {
    return timestamp >= range[0] && timestamp <= range[1];
  },
};
