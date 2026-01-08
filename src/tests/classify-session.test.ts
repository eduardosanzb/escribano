/**
 * Classify Session Action Tests
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntelligenceService, Session } from '../0_types.js';
import { classifySession } from '../actions/classify-session.js';

const mockTranscript = {
  fullText: 'This is a debugging session about authentication errors.',
  segments: [
    {
      id: 'seg-0',
      start: 0,
      end: 5,
      text: 'I fixed the authentication bug.',
    },
    {
      id: 'seg-1',
      start: 5,
      end: 10,
      text: 'Used JWT tokens for security.',
    },
  ],
  language: 'en',
  duration: 10,
};

const mockSession: Session = {
  id: 'session-123',
  recording: {
    id: 'rec-123',
    source: {
      type: 'cap',
      originalPath: '/test/path',
    },
    videoPath: '/test/video.mp4',
    audioPath: '/test/audio.mp3',
    duration: 10,
    capturedAt: new Date('2026-01-08'),
  },
  transcript: mockTranscript,
  status: 'transcribed',
  type: null,
  classification: null,
  createdAt: new Date('2026-01-08'),
  updatedAt: new Date('2026-01-08'),
};

const mockClassificationResult = {
  type: 'debugging',
  confidence: 0.95,
  entities: [
    {
      id: 'entity-1',
      type: 'error',
      value: 'authentication bug',
      segmentId: 'seg-0',
      timestamp: 0,
    },
    {
      id: 'entity-2',
      type: 'technology',
      value: 'JWT',
      segmentId: 'seg-1',
      timestamp: 5,
    },
  ],
};

const mockClassify = vi.fn().mockResolvedValue(mockClassificationResult);
const mockGenerate = vi
  .fn()
  .mockRejectedValue(new Error('generate() not implemented - Milestone 3'));

const mockIntelligence: IntelligenceService = {
  classify: mockClassify,
  generate: mockGenerate,
};

describe('classifySession', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should throw error without transcript', async () => {
    const sessionWithoutTranscript = { ...mockSession, transcript: null };

    await expect(
      classifySession(sessionWithoutTranscript, mockIntelligence)
    ).rejects.toThrow('Cannot classify session without transcript');
  });

  it('should classify session and update status', async () => {
    const result = await classifySession(mockSession, mockIntelligence);

    expect(result.status).toBe('classified');
    expect(result.type).toBe('debugging');
    expect(result.classification).toBeDefined();
    if (result.classification) {
      expect(result.classification.type).toBe('debugging');
      expect(result.classification.confidence).toBe(0.95);
      expect(result.classification.entities).toHaveLength(2);
    }
  });

  it('should not mutate original session', async () => {
    const originalStatus = mockSession.status;
    const originalUpdatedAt = mockSession.updatedAt;

    await classifySession(mockSession, mockIntelligence);

    expect(mockSession.status).toBe(originalStatus);
    expect(mockSession.updatedAt).toBe(originalUpdatedAt);
  });

  it('should call intelligence.classify with transcript', async () => {
    await classifySession(mockSession, mockIntelligence);

    expect(mockClassify).toHaveBeenCalledWith(mockTranscript);
  });
});
