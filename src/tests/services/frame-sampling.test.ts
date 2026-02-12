import { describe, expect, it } from 'vitest';
import {
  adaptiveSample,
  getSamplingStats,
  type InputFrame,
} from '../../services/frame-sampling.js';

describe('adaptiveSample', () => {
  it('should return empty array for empty input', () => {
    const result = adaptiveSample([]);
    expect(result).toEqual([]);
  });

  it('should sample at base interval', () => {
    // Create frames every 2 seconds for 60 seconds
    const frames: InputFrame[] = [];
    for (let t = 0; t <= 60; t += 2) {
      frames.push({ imagePath: `frame_${t}.jpg`, timestamp: t });
    }

    const result = adaptiveSample(frames, { baseIntervalSeconds: 10 });

    // Should get frames at 0, 10, 20, 30, 40, 50, 60 = 7 frames
    expect(result.length).toBe(7);
    expect(result.every((f) => f.reason === 'base')).toBe(true);
    expect(result.map((f) => f.timestamp)).toEqual([0, 10, 20, 30, 40, 50, 60]);
  });

  it('should fill gaps larger than threshold', () => {
    // Create frames with a gap
    const frames: InputFrame[] = [
      { imagePath: 'frame_0.jpg', timestamp: 0 },
      { imagePath: 'frame_2.jpg', timestamp: 2 },
      { imagePath: 'frame_4.jpg', timestamp: 4 },
      // Gap from 4 to 30 seconds
      { imagePath: 'frame_30.jpg', timestamp: 30 },
      { imagePath: 'frame_32.jpg', timestamp: 32 },
    ];

    const result = adaptiveSample(frames, {
      baseIntervalSeconds: 10,
      gapThresholdSeconds: 15,
      gapFillIntervalSeconds: 5,
    });

    // Base samples: 0, 30
    // Gap detected: 30 - 0 = 30 > 15
    // Gap fill should add samples between 0 and 30
    expect(result.length).toBeGreaterThan(2);
    expect(result.some((f) => f.reason === 'gap_fill')).toBe(true);
  });

  it('should not fill gaps smaller than threshold', () => {
    const frames: InputFrame[] = [];
    for (let t = 0; t <= 30; t += 2) {
      frames.push({ imagePath: `frame_${t}.jpg`, timestamp: t });
    }

    const result = adaptiveSample(frames, {
      baseIntervalSeconds: 10,
      gapThresholdSeconds: 15,
    });

    // Gap between samples is 10s, which is < 15s threshold
    expect(result.every((f) => f.reason === 'base')).toBe(true);
  });

  it('should handle unsorted input', () => {
    const frames: InputFrame[] = [
      { imagePath: 'frame_20.jpg', timestamp: 20 },
      { imagePath: 'frame_0.jpg', timestamp: 0 },
      { imagePath: 'frame_10.jpg', timestamp: 10 },
    ];

    const result = adaptiveSample(frames, { baseIntervalSeconds: 10 });

    expect(result.map((f) => f.timestamp)).toEqual([0, 10, 20]);
  });
});

describe('getSamplingStats', () => {
  it('should calculate correct statistics', () => {
    const original: InputFrame[] = Array.from({ length: 100 }, (_, i) => ({
      imagePath: `frame_${i}.jpg`,
      timestamp: i * 2,
    }));

    const sampled = adaptiveSample(original, { baseIntervalSeconds: 10 });
    const stats = getSamplingStats(original, sampled);

    expect(stats.originalCount).toBe(100);
    expect(stats.sampledCount).toBeLessThan(100);
    expect(stats.reductionPercent).toBeGreaterThan(0);
  });
});
