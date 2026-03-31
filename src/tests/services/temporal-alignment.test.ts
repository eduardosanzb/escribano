import { describe, expect, it } from 'vitest';
import type { DbObservation } from '../../db/types.js';
import type { Segment } from '../../services/activity-segmentation.js';
import {
  alignAudioToSegments,
  getAlignmentStats,
} from '../../services/temporal-alignment.js';

// =============================================================================
// Factory helpers
// =============================================================================

function createObservation(
  overrides: Partial<DbObservation> = {}
): DbObservation {
  return {
    id: 'obs-1',
    recording_id: 'rec-1',
    type: 'audio',
    timestamp: 0,
    end_timestamp: null,
    image_path: null,
    ocr_text: null,
    vlm_description: null,
    vlm_raw_response: null,
    activity_type: null,
    apps: null,
    topics: null,
    text: null,
    audio_source: 'mic',
    audio_type: null,
    embedding: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function createSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    id: 'seg-1',
    recordingId: 'rec-1',
    activityType: 'coding',
    startTime: 0,
    endTime: 60,
    duration: 60,
    observationIds: [],
    keyDescription: 'Writing code in VS Code',
    apps: ['VS Code'],
    topics: ['typescript'],
    ...overrides,
  };
}

// =============================================================================
// alignAudioToSegments
// =============================================================================

describe('alignAudioToSegments', () => {
  it('should return empty array for empty segments', () => {
    const result = alignAudioToSegments([], []);
    expect(result).toEqual([]);
  });

  it('should return segments with empty transcripts when no audio observations', () => {
    const segments = [createSegment()];
    const result = alignAudioToSegments(segments, []);

    expect(result).toHaveLength(1);
    expect(result[0].transcripts).toEqual([]);
    expect(result[0].combinedTranscript).toBe('');
  });

  it('should attach audio observation that overlaps one segment', () => {
    const segments = [
      createSegment({ id: 'seg-1', startTime: 0, endTime: 60 }),
      createSegment({ id: 'seg-2', startTime: 60, endTime: 120 }),
    ];

    const audio = createObservation({
      id: 'obs-1',
      type: 'audio',
      timestamp: 10,
      end_timestamp: 30,
      text: 'Hello world',
      audio_source: 'mic',
    });

    const result = alignAudioToSegments(segments, [audio]);

    expect(result[0].transcripts).toHaveLength(1);
    expect(result[0].transcripts[0].text).toBe('Hello world');
    expect(result[0].transcripts[0].source).toBe('mic');
    // Second segment should not have the transcript
    expect(result[1].transcripts).toHaveLength(0);
  });

  it('should attach audio observation to both segments when it overlaps both', () => {
    const segments = [
      createSegment({ id: 'seg-1', startTime: 0, endTime: 30 }),
      createSegment({ id: 'seg-2', startTime: 30, endTime: 60 }),
    ];

    // Observation spans from 20 to 40, overlapping both segments by >= 1s
    const audio = createObservation({
      id: 'obs-1',
      type: 'audio',
      timestamp: 20,
      end_timestamp: 40,
      text: 'Crossing boundary',
      audio_source: 'mic',
    });

    const result = alignAudioToSegments(segments, [audio]);

    // Overlap with seg-1: 20..30 = 10s → attached
    expect(result[0].transcripts).toHaveLength(1);
    // Overlap with seg-2: 30..40 = 10s → attached
    expect(result[1].transcripts).toHaveLength(1);
    expect(result[0].transcripts[0].text).toBe('Crossing boundary');
    expect(result[1].transcripts[0].text).toBe('Crossing boundary');
  });

  it('should exclude audio observation with overlap below default 1s threshold', () => {
    const segments = [
      createSegment({ id: 'seg-1', startTime: 0, endTime: 10 }),
    ];

    // Observation overlaps by only 0.5s (9.5 to 10)
    const audio = createObservation({
      id: 'obs-1',
      type: 'audio',
      timestamp: 9.5,
      end_timestamp: 20,
      text: 'Tiny overlap',
      audio_source: 'mic',
    });

    const result = alignAudioToSegments(segments, [audio]);

    expect(result[0].transcripts).toHaveLength(0);
  });

  it('should include audio observation when overlap equals exactly the default threshold (1s)', () => {
    const segments = [
      createSegment({ id: 'seg-1', startTime: 0, endTime: 10 }),
    ];

    // Observation overlaps exactly 1s (9 to 10)
    const audio = createObservation({
      id: 'obs-1',
      type: 'audio',
      timestamp: 9,
      end_timestamp: 20,
      text: 'Exact threshold',
      audio_source: 'mic',
    });

    const result = alignAudioToSegments(segments, [audio]);

    expect(result[0].transcripts).toHaveLength(1);
    expect(result[0].transcripts[0].text).toBe('Exact threshold');
  });

  it('should respect custom minOverlapSeconds config', () => {
    const segments = [
      createSegment({ id: 'seg-1', startTime: 0, endTime: 60 }),
    ];

    // 3s overlap — passes default (1s) but fails custom (5s)
    const audio = createObservation({
      id: 'obs-1',
      type: 'audio',
      timestamp: 57,
      end_timestamp: 65,
      text: 'Short overlap',
      audio_source: 'mic',
    });

    const resultDefault = alignAudioToSegments(segments, [audio]);
    expect(resultDefault[0].transcripts).toHaveLength(1);

    const resultCustom = alignAudioToSegments(segments, [audio], {
      minOverlapSeconds: 5,
    });
    expect(resultCustom[0].transcripts).toHaveLength(0);
  });

  it('should attach both mic and system audio, ordered chronologically', () => {
    const segments = [
      createSegment({ id: 'seg-1', startTime: 0, endTime: 120 }),
    ];

    const systemAudio = createObservation({
      id: 'obs-system',
      type: 'audio',
      timestamp: 60,
      end_timestamp: 90,
      text: 'System audio later',
      audio_source: 'system',
    });

    const micAudio = createObservation({
      id: 'obs-mic',
      type: 'audio',
      timestamp: 10,
      end_timestamp: 40,
      text: 'Mic audio first',
      audio_source: 'mic',
    });

    const result = alignAudioToSegments(segments, [systemAudio, micAudio]);

    expect(result[0].transcripts).toHaveLength(2);
    // Should be ordered chronologically (mic at t=10 before system at t=60)
    expect(result[0].transcripts[0].source).toBe('mic');
    expect(result[0].transcripts[0].text).toBe('Mic audio first');
    expect(result[0].transcripts[1].source).toBe('system');
    expect(result[0].transcripts[1].text).toBe('System audio later');
  });

  it('should produce correct combinedTranscript with [MIC] and [SYSTEM] prefixes', () => {
    const segments = [
      createSegment({ id: 'seg-1', startTime: 0, endTime: 120 }),
    ];

    const micAudio = createObservation({
      id: 'obs-mic',
      type: 'audio',
      timestamp: 10,
      end_timestamp: 40,
      text: 'Hello from mic',
      audio_source: 'mic',
    });

    const systemAudio = createObservation({
      id: 'obs-system',
      type: 'audio',
      timestamp: 60,
      end_timestamp: 90,
      text: 'Hello from system',
      audio_source: 'system',
    });

    const result = alignAudioToSegments(segments, [micAudio, systemAudio]);

    expect(result[0].combinedTranscript).toBe(
      '[MIC] Hello from mic\n[SYSTEM] Hello from system'
    );
  });

  it('should use default 5s end_timestamp when end_timestamp is null', () => {
    const segments = [
      createSegment({ id: 'seg-1', startTime: 0, endTime: 60 }),
    ];

    // No end_timestamp → defaults to timestamp + 5 = 5s, so overlap is 5s
    const audio = createObservation({
      id: 'obs-1',
      type: 'audio',
      timestamp: 0,
      end_timestamp: null,
      text: 'No end timestamp',
      audio_source: 'mic',
    });

    const result = alignAudioToSegments(segments, [audio]);

    expect(result[0].transcripts).toHaveLength(1);
    expect(result[0].transcripts[0].text).toBe('No end timestamp');
  });

  it('should ignore non-audio observations', () => {
    const segments = [createSegment({ startTime: 0, endTime: 60 })];

    const visual = createObservation({
      id: 'obs-visual',
      type: 'visual',
      timestamp: 10,
      end_timestamp: 30,
      text: null,
      audio_source: null,
    });

    const result = alignAudioToSegments(segments, [visual]);

    expect(result[0].transcripts).toHaveLength(0);
  });

  it('should ignore audio observations with null or empty text', () => {
    const segments = [createSegment({ startTime: 0, endTime: 60 })];

    const nullText = createObservation({
      id: 'obs-null',
      type: 'audio',
      timestamp: 10,
      end_timestamp: 30,
      text: null,
      audio_source: 'mic',
    });

    const emptyText = createObservation({
      id: 'obs-empty',
      type: 'audio',
      timestamp: 10,
      end_timestamp: 30,
      text: '   ',
      audio_source: 'mic',
    });

    const result = alignAudioToSegments(segments, [nullText, emptyText]);

    expect(result[0].transcripts).toHaveLength(0);
  });

  it('should preserve all segment fields in enriched output', () => {
    const segment = createSegment({
      id: 'seg-preserve',
      recordingId: 'rec-preserve',
      activityType: 'meeting',
      startTime: 5,
      endTime: 50,
      duration: 45,
      observationIds: ['o1', 'o2'],
      keyDescription: 'Team meeting in Zoom',
      apps: ['Zoom'],
      topics: ['planning'],
    });

    const result = alignAudioToSegments([segment], []);

    expect(result[0].id).toBe('seg-preserve');
    expect(result[0].recordingId).toBe('rec-preserve');
    expect(result[0].activityType).toBe('meeting');
    expect(result[0].startTime).toBe(5);
    expect(result[0].endTime).toBe(50);
    expect(result[0].duration).toBe(45);
    expect(result[0].observationIds).toEqual(['o1', 'o2']);
    expect(result[0].keyDescription).toBe('Team meeting in Zoom');
    expect(result[0].apps).toEqual(['Zoom']);
    expect(result[0].topics).toEqual(['planning']);
  });
});

// =============================================================================
// getAlignmentStats
// =============================================================================

describe('getAlignmentStats', () => {
  it('should return zeros for empty enriched segments', () => {
    const stats = getAlignmentStats([]);

    expect(stats.totalSegments).toBe(0);
    expect(stats.segmentsWithAudio).toBe(0);
    expect(stats.totalTranscriptSegments).toBe(0);
    expect(stats.micTranscriptCount).toBe(0);
    expect(stats.systemTranscriptCount).toBe(0);
    expect(stats.avgTranscriptsPerSegment).toBe(0);
  });

  it('should count totalSegments correctly', () => {
    const segments = [
      createSegment({ id: 'seg-1' }),
      createSegment({ id: 'seg-2' }),
      createSegment({ id: 'seg-3' }),
    ];

    const enriched = alignAudioToSegments(segments, []);
    const stats = getAlignmentStats(enriched);

    expect(stats.totalSegments).toBe(3);
  });

  it('should count segmentsWithAudio correctly', () => {
    const segments = [
      createSegment({ id: 'seg-1', startTime: 0, endTime: 60 }),
      createSegment({ id: 'seg-2', startTime: 60, endTime: 120 }),
      createSegment({ id: 'seg-3', startTime: 120, endTime: 180 }),
    ];

    // Only overlaps with seg-1
    const audio = createObservation({
      id: 'obs-1',
      type: 'audio',
      timestamp: 10,
      end_timestamp: 30,
      text: 'Only first segment',
      audio_source: 'mic',
    });

    const enriched = alignAudioToSegments(segments, [audio]);
    const stats = getAlignmentStats(enriched);

    expect(stats.totalSegments).toBe(3);
    expect(stats.segmentsWithAudio).toBe(1);
  });

  it('should count totalTranscriptSegments as sum of all transcripts across all segments', () => {
    const segments = [
      createSegment({ id: 'seg-1', startTime: 0, endTime: 60 }),
      createSegment({ id: 'seg-2', startTime: 60, endTime: 120 }),
    ];

    // Two audio obs, each overlaps both segments (timestamp spans across boundary)
    const audio1 = createObservation({
      id: 'obs-1',
      type: 'audio',
      timestamp: 20,
      end_timestamp: 80,
      text: 'Spans both',
      audio_source: 'mic',
    });

    const audio2 = createObservation({
      id: 'obs-2',
      type: 'audio',
      timestamp: 30,
      end_timestamp: 90,
      text: 'Also spans both',
      audio_source: 'system',
    });

    const enriched = alignAudioToSegments(segments, [audio1, audio2]);
    const stats = getAlignmentStats(enriched);

    // Each segment gets 2 transcripts → total = 4
    expect(stats.totalTranscriptSegments).toBe(4);
  });

  it('should count mic vs system transcripts separately', () => {
    const segments = [
      createSegment({ id: 'seg-1', startTime: 0, endTime: 120 }),
    ];

    const mic1 = createObservation({
      id: 'mic-1',
      type: 'audio',
      timestamp: 10,
      end_timestamp: 30,
      text: 'Mic one',
      audio_source: 'mic',
    });

    const mic2 = createObservation({
      id: 'mic-2',
      type: 'audio',
      timestamp: 40,
      end_timestamp: 60,
      text: 'Mic two',
      audio_source: 'mic',
    });

    const system1 = createObservation({
      id: 'sys-1',
      type: 'audio',
      timestamp: 70,
      end_timestamp: 90,
      text: 'System one',
      audio_source: 'system',
    });

    const enriched = alignAudioToSegments(segments, [mic1, mic2, system1]);
    const stats = getAlignmentStats(enriched);

    expect(stats.micTranscriptCount).toBe(2);
    expect(stats.systemTranscriptCount).toBe(1);
  });

  it('should calculate avgTranscriptsPerSegment correctly', () => {
    const segments = [
      createSegment({ id: 'seg-1', startTime: 0, endTime: 60 }),
      createSegment({ id: 'seg-2', startTime: 60, endTime: 120 }),
    ];

    // One transcript only in seg-1 → avg = 0.5
    const audio = createObservation({
      id: 'obs-1',
      type: 'audio',
      timestamp: 10,
      end_timestamp: 30,
      text: 'Only first',
      audio_source: 'mic',
    });

    const enriched = alignAudioToSegments(segments, [audio]);
    const stats = getAlignmentStats(enriched);

    expect(stats.avgTranscriptsPerSegment).toBe(0.5);
  });

  it('should return avgTranscriptsPerSegment of 0 when no segments', () => {
    const stats = getAlignmentStats([]);
    expect(stats.avgTranscriptsPerSegment).toBe(0);
  });
});
