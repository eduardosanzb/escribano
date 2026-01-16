import { describe, expect, it } from 'vitest';
import type { TaggedTranscript } from '../../0_types.js';
import { calculateAudioOverlap } from '../../actions/process-session.js';

describe('processSession actions', () => {
  describe('calculateAudioOverlap', () => {
    it('should return 0 when there are no transcripts', () => {
      const overlap = calculateAudioOverlap([0, 10], []);
      expect(overlap).toBe(0);
    });

    it('should return 0 when there is no overlap', () => {
      const transcripts: TaggedTranscript[] = [
        {
          source: 'mic',
          transcript: {
            fullText: 'hello',
            segments: [{ id: '0', start: 20, end: 30, text: 'hello' }],
            language: 'en',
            duration: 10,
          },
        },
      ];
      const overlap = calculateAudioOverlap([0, 10], transcripts);
      expect(overlap).toBe(0);
    });

    it('should calculate partial overlap correctly', () => {
      const transcripts: TaggedTranscript[] = [
        {
          source: 'mic',
          transcript: {
            fullText: 'hello',
            segments: [{ id: '0', start: 5, end: 15, text: 'hello' }],
            language: 'en',
            duration: 10,
          },
        },
      ];
      // Overlap between [0, 10] and [5, 15] is [5, 10] = 5 seconds
      const overlap = calculateAudioOverlap([0, 10], transcripts);
      expect(overlap).toBe(5);
    });

    it('should handle multiple segments and sources', () => {
      const transcripts: TaggedTranscript[] = [
        {
          source: 'mic',
          transcript: {
            fullText: 'hello world',
            segments: [
              { id: '0', start: 0, end: 5, text: 'hello' },
              { id: '1', start: 15, end: 20, text: 'world' },
            ],
            language: 'en',
            duration: 20,
          },
        },
        {
          source: 'system',
          transcript: {
            fullText: 'ding',
            segments: [{ id: '2', start: 8, end: 12, text: 'ding' }],
            language: 'en',
            duration: 20,
          },
        },
      ];
      // Target range [0, 20]
      // Segment 1: [0, 5] -> 5s
      // Segment 2: [15, 20] -> 5s
      // Segment 3: [8, 12] -> 4s
      // Total: 14s
      const overlap = calculateAudioOverlap([0, 20], transcripts);
      expect(overlap).toBe(14);
    });

    it('should handle segments fully contained within range', () => {
      const transcripts: TaggedTranscript[] = [
        {
          source: 'mic',
          transcript: {
            fullText: 'hello',
            segments: [{ id: '0', start: 2, end: 8, text: 'hello' }],
            language: 'en',
            duration: 10,
          },
        },
      ];
      const overlap = calculateAudioOverlap([0, 10], transcripts);
      expect(overlap).toBe(6);
    });

    it('should handle range fully contained within segment', () => {
      const transcripts: TaggedTranscript[] = [
        {
          source: 'mic',
          transcript: {
            fullText: 'hello',
            segments: [{ id: '0', start: 0, end: 100, text: 'hello' }],
            language: 'en',
            duration: 100,
          },
        },
      ];
      const overlap = calculateAudioOverlap([10, 20], transcripts);
      expect(overlap).toBe(10);
    });
  });
});
