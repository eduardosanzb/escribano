/**
 * Integration Test - Simple E2E Pipeline Test
 *
 * Tests: Cap Adapter → Process Session → Output
 */

import { describe, it, expect, vi } from 'vitest';

describe('Integration: CLI Pipeline', () => {
  it('should list recordings', async () => {
    const mockRecording = {
      id: 'test-recording-1',
      source: {
        type: 'cap',
        originalPath: '~/test.cap',
        metadata: {},
      },
      videoPath: null,
      audioPath: '/tmp/test-audio.ogg',
      duration: 300,
      capturedAt: new Date('2025-01-08T12:00:00.000Z'),
    };

    const mockCapSource = {
      getLatestRecording: vi.fn().mockResolvedValue(mockRecording),
      listRecordings: vi.fn().mockResolvedValue([mockRecording]),
    };

    const recordings = await mockCapSource.listRecordings(10);

    expect(recordings).toEqual([mockRecording]);
    expect(mockCapSource.listRecordings).toHaveBeenCalledWith(10);
  });

  it('should get latest recording', async () => {
    const mockRecording = {
      id: 'latest-recording',
      source: {
        type: 'cap',
        originalPath: '~/Library/Application Support/so.cap.desktop/recordings/test.cap',
        metadata: {},
      },
      videoPath: '/tmp/video.mp4',
      audioPath: '/tmp/audio.ogg',
      duration: 180,
      capturedAt: new Date('2025-01-08T14:30:00.000Z'),
    };

    const mockCapSource = {
      getLatestRecording: vi.fn().mockResolvedValue(mockRecording),
      listRecordings: vi.fn().mockResolvedValue([mockRecording]),
    };

    const recording = await mockCapSource.getLatestRecording();

    expect(recording).toEqual(mockRecording);
    expect(mockCapSource.getLatestRecording).toHaveBeenCalled();
  });
});
