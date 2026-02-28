/**
 * Tests for Activity Segmentation Service
 */

import { describe, expect, it } from 'vitest';
import type { DbObservation } from '../db/types.js';
import {
  getSegmentStats,
  type Segment,
  segmentByActivity,
} from './activity-segmentation.js';

describe('segmentByActivity', () => {
  const createObservation = (
    id: string,
    timestamp: number,
    vlmDescription: string | null,
    type: 'visual' | 'audio' = 'visual',
    duration: number = 10
  ): DbObservation => ({
    id,
    recording_id: 'test-recording',
    type,
    timestamp,
    end_timestamp: timestamp + duration,
    image_path: type === 'visual' ? `/path/${id}.png` : null,
    ocr_text: null,
    vlm_description: vlmDescription,
    vlm_raw_response: null,
    activity_type: null,
    apps: null,
    topics: null,
    text: null,
    audio_source: null,
    audio_type: null,
    embedding: null,
    created_at: new Date().toISOString(),
  });

  it('should group consecutive same-activity observations', () => {
    // Create longer observations (60s each) to avoid merging
    const observations = [
      createObservation(
        '1',
        0,
        'Debugging Python error in VSCode',
        'visual',
        60
      ),
      createObservation(
        '2',
        60,
        'Debugging stack trace in terminal',
        'visual',
        60
      ),
      createObservation('3', 120, 'Debugging the issue', 'visual', 60),
      createObservation('4', 180, 'Writing code in VSCode', 'visual', 60),
      createObservation('5', 240, 'Implementing new feature', 'visual', 60),
      createObservation(
        '6',
        300,
        'Reading documentation in Chrome',
        'visual',
        60
      ),
    ];

    const segments = segmentByActivity(observations);

    expect(segments).toHaveLength(3);
    expect(segments[0].activityType).toBe('debugging');
    expect(segments[0].observationIds).toEqual(['1', '2', '3']);
    expect(segments[1].activityType).toBe('coding');
    expect(segments[1].observationIds).toEqual(['4', '5']);
    expect(segments[2].activityType).toBe('reading');
    expect(segments[2].observationIds).toEqual(['6']);
  });

  it('should handle single observation segments', () => {
    const observations = [
      createObservation('1', 0, 'Debugging Python error'),
      createObservation('2', 10, 'Writing new function'),
      createObservation('3', 20, 'Reading documentation'),
    ];

    // Disable merging to test grouping logic directly
    const segments = segmentByActivity(observations, { minSegmentDuration: 0 });

    expect(segments).toHaveLength(3);
    segments.forEach((seg, i) => {
      expect(seg.observationIds).toHaveLength(1);
      expect(seg.observationIds[0]).toBe(String(i + 1));
    });
  });

  it('should merge short segments into longest neighbor', () => {
    // Create a scenario where middle segment is too short
    // First segment: 60s, Middle: 10s (will be merged), Last: 50s
    const observations = [
      createObservation('1', 0, 'Debugging error 1', 'visual', 10),
      createObservation('2', 10, 'Debugging error 2', 'visual', 10),
      createObservation('3', 20, 'Debugging error 3', 'visual', 10),
      createObservation('4', 30, 'Debugging error 4', 'visual', 10),
      createObservation('5', 40, 'Debugging error 5', 'visual', 10),
      createObservation('6', 50, 'Debugging error 6', 'visual', 10),
      // Short coding segment (10s) - will be merged into first debugging segment
      createObservation(
        '7',
        60,
        'Implementing new feature in VSCode',
        'visual',
        10
      ),
      // Second debugging segment is shorter (20s), should also be merged
      createObservation('8', 70, 'Debugging more', 'visual', 10),
      createObservation('9', 80, 'Debugging final', 'visual', 10),
    ];

    const segments = segmentByActivity(observations, {
      minSegmentDuration: 30,
    });

    // The coding segment (60-70s) is only 10s
    // After merging it into first debugging (now 70s), the second debugging (20s)
    // The coding segment (60-70s) is only 10s
    // After merging it into first debugging (now 70s), the second debugging (20s)
    // becomes the new shortest and gets merged too
    expect(segments).toHaveLength(1);
    expect(segments[0].activityType).toBe('debugging');
    // Should include all observations including the coding one
    expect(segments[0].observationIds).toHaveLength(9);
  });

  it('should extract apps and topics from observation fields', () => {
    const obs = createObservation(
      '1',
      0,
      'Debugging Python error in VSCode, working on escribano project'
    );
    obs.apps = JSON.stringify(['vscode']);
    obs.topics = JSON.stringify(['escribano']);

    const segments = segmentByActivity([obs]);

    expect(segments[0].apps).toContain('vscode');
    expect(segments[0].topics).toContain('escribano');
  });

  it('should filter out audio observations', () => {
    const observations = [
      createObservation('1', 0, 'Debugging error', 'visual'),
      createObservation('2', 10, 'This is audio transcript', 'audio'),
      createObservation('3', 20, 'Writing code', 'visual'),
    ];

    // Disable merging to test filtering logic
    const segments = segmentByActivity(observations, { minSegmentDuration: 0 });

    expect(segments).toHaveLength(2);
    expect(segments[0].activityType).toBe('debugging');
    expect(segments[1].activityType).toBe('coding');
  });

  it('should handle observations without VLM descriptions', () => {
    const observations = [
      createObservation('1', 0, 'Debugging error', 'visual', 60),
      // null observation is filtered out entirely
      createObservation('2', 60, null, 'visual', 60),
      createObservation('3', 120, 'Debugging more', 'visual', 60),
    ];

    // With longer durations and minSegmentDuration: 0, we get 2 debugging segments
    // (filtered out null creates a gap, not a segment)
    const segments = segmentByActivity(observations, { minSegmentDuration: 0 });

    // null observations are filtered out, so we only have the 2 debugging observations
    expect(segments.length).toBeGreaterThanOrEqual(1);
    expect(segments[0].activityType).toBe('debugging');
  });

  it('should sort observations by timestamp', () => {
    const observations = [
      createObservation('1', 30, 'Reading documentation'),
      createObservation('2', 0, 'Debugging error'),
      createObservation('3', 10, 'Writing code'),
    ];

    // Disable merging to test sorting
    const segments = segmentByActivity(observations, { minSegmentDuration: 0 });

    expect(segments[0].startTime).toBe(0);
    expect(segments[0].activityType).toBe('debugging');
    expect(segments[1].startTime).toBe(10);
    expect(segments[1].activityType).toBe('coding');
    expect(segments[2].startTime).toBe(30);
    expect(segments[2].activityType).toBe('reading');
  });

  it('should return empty array for empty observations', () => {
    const segments = segmentByActivity([]);
    expect(segments).toEqual([]);
  });

  it('should handle all other activities', () => {
    const observations = [
      createObservation('1', 0, 'Browsing Stack Overflow for solutions'),
      createObservation('2', 10, 'In Zoom meeting discussing project'),
      createObservation('3', 20, 'Reviewing pull request in GitHub'),
      createObservation('4', 30, 'Some generic unknown activity'),
    ];

    // Disable merging to test activity detection
    const segments = segmentByActivity(observations, { minSegmentDuration: 0 });

    expect(segments).toHaveLength(4);
    expect(segments[0].activityType).toBe('research');
    expect(segments[1].activityType).toBe('meeting');
    expect(segments[2].activityType).toBe('review');
    expect(segments[3].activityType).toBe('other');
  });
});

describe('getSegmentStats', () => {
  const createMockSegment = (
    activityType: string,
    duration: number
  ): Segment => ({
    id: `seg-${activityType}`,
    recordingId: 'test',
    activityType,
    startTime: 0,
    endTime: duration,
    duration,
    observationIds: [],
    keyDescription: '',
    apps: [],
    topics: [],
  });

  it('should calculate correct statistics', () => {
    const segments = [
      createMockSegment('debugging', 60),
      createMockSegment('coding', 120),
      createMockSegment('debugging', 45),
    ];

    const stats = getSegmentStats(segments);

    expect(stats.totalSegments).toBe(3);
    expect(stats.totalDuration).toBe(225);
    expect(stats.avgSegmentDuration).toBe(75);
    expect(stats.activityTypeCounts).toEqual({
      debugging: 2,
      coding: 1,
    });
  });

  it('should handle empty segments', () => {
    const stats = getSegmentStats([]);
    expect(stats.totalSegments).toBe(0);
    expect(stats.totalDuration).toBe(0);
    expect(stats.avgSegmentDuration).toBe(0);
  });
});
