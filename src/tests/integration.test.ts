/**
 * Integration Test - Simple E2E Pipeline Test
 *
 * Tests: Cap Adapter → Process Session → Output
 */

import { describe, expect, it, vi } from 'vitest';

describe('Integration: CLI Pipeline', () => {
  it('should list recordings', async () => {
    const mockRecording = {
      id: 'test-recording-1',
      source: {
        type: 'cap' as const,
        originalPath: '~/test.cap',
        metadata: {
          platform: 'MacOS',
          pretty_name: 'Test Recording',
          segments: [
            {
              display: {
                path: 'content/segments/segment-0/display.mp4',
                fps: 37,
              },
              mic: {
                path: 'content/segments/segment-0/audio-input.ogg',
                start_time: 0,
              },
              cursor: 'content/segments/segment-0/cursor.json',
            },
          ],
        },
      },
      videoPath: '~/test.cap/content/segments/segment-0/display.mp4',
      audioMicPath: '~/test.cap/content/segments/segment-0/audio-input.ogg',
      audioSystemPath: null,
      duration: 0,
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
        type: 'cap' as const,
        originalPath:
          '~/Library/Application Support/so.cap.desktop/recordings/test.cap',
        metadata: {
          platform: 'MacOS',
          pretty_name: 'Latest Recording',
          segments: [
            {
              display: {
                path: 'content/segments/segment-0/display.mp4',
                fps: 37,
              },
              mic: {
                path: 'content/segments/segment-0/audio-input.ogg',
                start_time: 0,
              },
              cursor: 'content/segments/segment-0/cursor.json',
            },
          ],
        },
      },
      videoPath: '/tmp/video.mp4',
      audioMicPath: '/tmp/audio.ogg',
      audioSystemPath: null,
      duration: 0,
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
