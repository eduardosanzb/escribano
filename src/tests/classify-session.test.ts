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
    audioMicPath: '/test/audio.mp3',
    audioSystemPath: null,
    duration: 10,
    capturedAt: new Date('2026-01-08'),
  },
  transcripts: [
    {
      source: 'mic',
      transcript: mockTranscript,
    },
  ],
  status: 'transcribed',
  classification: null,
  metadata: null,
  artifacts: [],
  createdAt: new Date('2026-01-08'),
  updatedAt: new Date('2026-01-08'),
};

const mockClassificationResult = {
  meeting: 10,
  debugging: 90,
  tutorial: 15,
  learning: 20,
  working: 5,
};

const mockClassify = vi.fn();
const mockExtractMetadata = vi.fn().mockResolvedValue({
  speakers: [],
  keyMoments: [],
  actionItems: [],
  technicalTerms: [],
  codeSnippets: [],
});
const mockGenerate = vi.fn();

const mockIntelligence: IntelligenceService = {
  classify: mockClassify,
  extractMetadata: mockExtractMetadata,
  generate: mockGenerate,
};

describe('classifySession', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockClassify.mockResolvedValue(mockClassificationResult);
  });

  it('should throw error without transcripts', async () => {
    const sessionWithoutTranscripts = { ...mockSession, transcripts: [] };

    await expect(
      classifySession(sessionWithoutTranscripts, mockIntelligence)
    ).rejects.toThrow('Cannot classify session without transcripts');
  });

  it('should classify session and update status', async () => {
    const result = await classifySession(mockSession, mockIntelligence);

    expect(result.status).toBe('classified');
    expect(result.classification).toBeDefined();
    if (result.classification) {
      expect(result.classification.debugging).toBe(90);
      expect(result.classification.meeting).toBe(10);
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

    expect(mockClassify).toHaveBeenCalled();
    // Since we only have one transcript, it should be called with the original
    expect(mockClassify).toHaveBeenCalledWith(mockTranscript);
  });

  it('should interleave multiple transcripts', async () => {
    const sessionWithMultipleTranscripts: Session = {
      ...mockSession,
      transcripts: [
        { source: 'mic', transcript: mockTranscript },
        {
          source: 'system',
          transcript: {
            ...mockTranscript,
            segments: [
              {
                id: 'seg-sys-0',
                start: 3,
                end: 4,
                text: 'Error notification sound',
              },
            ],
            fullText: 'Error notification sound',
          },
        },
      ],
    };

    await classifySession(sessionWithMultipleTranscripts, mockIntelligence);

    expect(mockClassify).toHaveBeenCalled();
    const calledWith = mockClassify.mock.calls[0][0];
    // Should have interleaved the transcripts
    expect(calledWith.fullText).toContain('[00:00 MIC]');
    expect(calledWith.fullText).toContain('[00:03 SYSTEM]');
  });
});
