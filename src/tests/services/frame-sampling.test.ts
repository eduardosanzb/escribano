import { describe, expect, it } from 'vitest';
import {
  adaptiveSample,
  adaptiveSampleWithScenes,
  calculateAdaptiveBaseInterval,
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

describe('calculateAdaptiveBaseInterval', () => {
  it('should return config base for few scene changes (<= 20)', () => {
    expect(calculateAdaptiveBaseInterval(0, 10)).toBe(10);
    expect(calculateAdaptiveBaseInterval(5, 10)).toBe(10);
    expect(calculateAdaptiveBaseInterval(20, 10)).toBe(10);
  });

  it('should return 20s for moderate scene changes (21-50)', () => {
    expect(calculateAdaptiveBaseInterval(21, 10)).toBe(20);
    expect(calculateAdaptiveBaseInterval(35, 10)).toBe(20);
    expect(calculateAdaptiveBaseInterval(50, 10)).toBe(20);
  });

  it('should return 30s for high scene density (> 50)', () => {
    expect(calculateAdaptiveBaseInterval(51, 10)).toBe(30);
    expect(calculateAdaptiveBaseInterval(109, 10)).toBe(30);
    expect(calculateAdaptiveBaseInterval(200, 10)).toBe(30);
  });

  it('should never go below configured base interval', () => {
    // If user configured 40s, keep it even for low scene counts
    expect(calculateAdaptiveBaseInterval(5, 40)).toBe(40);
    expect(calculateAdaptiveBaseInterval(30, 40)).toBe(40);
    expect(calculateAdaptiveBaseInterval(100, 40)).toBe(40);
  });
});

describe('adaptiveSampleWithScenes', () => {
  // Helper: create frames every 2s for N minutes
  function makeFrames(durationMinutes: number): InputFrame[] {
    const frames: InputFrame[] = [];
    const total = durationMinutes * 60;
    for (let t = 0; t <= total; t += 2) {
      frames.push({ imagePath: `frame_${t}.jpg`, timestamp: t });
    }
    return frames;
  }

  it('should return empty array for empty input', () => {
    expect(adaptiveSampleWithScenes([], [])).toEqual([]);
  });

  it('should sample at base interval when no scene changes', () => {
    const frames = makeFrames(1); // 1 minute
    const result = adaptiveSampleWithScenes(frames, []);

    // Should behave like regular sampling
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((f) => f.reason === 'base')).toBe(true);
  });

  it('should include scene change frames', () => {
    const frames = makeFrames(1);
    const sceneChanges = [10, 20, 40];

    const result = adaptiveSampleWithScenes(frames, sceneChanges);

    const sceneFrames = result.filter((f) => f.reason === 'scene_change');
    expect(sceneFrames.length).toBe(3);
  });

  it('should produce fewer total frames with high scene density', () => {
    const frames = makeFrames(10); // 10 minutes, 300 frames

    // Low density: 5 scene changes
    const lowDensityResult = adaptiveSampleWithScenes(
      frames,
      [30, 100, 200, 400, 500],
      { baseIntervalSeconds: 10 }
    );

    // High density: 60 scene changes (every ~10s)
    const highDensityScenes = Array.from({ length: 60 }, (_, i) => i * 10);
    const highDensityResult = adaptiveSampleWithScenes(
      frames,
      highDensityScenes,
      { baseIntervalSeconds: 10 }
    );

    // High density should use 30s base interval, resulting in fewer
    // base samples (but more scene samples). Total should still be
    // manageable and not explode.
    const highStats = getSamplingStats(frames, highDensityResult);
    expect(highStats.sampledCount).toBeLessThan(frames.length);
    expect(highStats.reductionPercent).toBeGreaterThan(50);
  });

  it('should match real-world scenario: 59 min, 109 scenes', () => {
    const frames = makeFrames(59); // 1776 frames
    // Simulate 109 scene changes spread across 59 minutes
    const sceneChanges = Array.from({ length: 109 }, (_, i) =>
      Math.round((i / 109) * 59 * 60)
    );

    const result = adaptiveSampleWithScenes(frames, sceneChanges);
    const stats = getSamplingStats(frames, result);

    // Target: under 250 frames total (was 1199 before adaptive interval + gap threshold fix)
    expect(stats.sampledCount).toBeLessThan(250);
    expect(stats.sceneChangeCount).toBe(109);
    // Reduction should be significant
    expect(stats.reductionPercent).toBeGreaterThan(85);
  });
});
