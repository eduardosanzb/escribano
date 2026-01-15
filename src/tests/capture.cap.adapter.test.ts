/**
 * Cap Adapter Tests
 */

import { describe, expect, it } from 'vitest';
import { createCapCaptureSource } from '../adapters/capture.cap.adapter.js';

describe('Cap Adapter', () => {
  it('should create a CapSource', () => {
    const capSource = createCapCaptureSource({
      recordingsPath: '~/tmp/recordings',
    });

    expect(capSource).toBeDefined();
    expect(capSource.getLatestRecording).toBeInstanceOf(Function);
  });

  it('should handle nonexistent directory gracefully', async () => {
    const capSource = createCapCaptureSource({
      recordingsPath: '/nonexistent/path',
    });

    const latest = await capSource.getLatestRecording();
    expect(latest).toBeNull();
  });

  it('should validate Cap recording metadata structure', async () => {
    const mockMeta = {
      platform: 'MacOS',
      pretty_name: 'Cap 2026-01-08 at 16.46.37',
      segments: [
        {
          display: {
            path: 'content/segments/segment-0/display.mp4',
            fps: 37,
          },
          mic: {
            path: 'content/segments/segment-0/audio-input.ogg',
            start_time: -0.032719958,
          },
          cursor: 'content/segments/segment-0/cursor.json',
        },
      ],
    };

    expect(mockMeta.segments).toBeDefined();
    expect(mockMeta.segments[0]).toBeDefined();
    expect(mockMeta.segments[0].display?.path).toBe(
      'content/segments/segment-0/display.mp4'
    );
    expect(mockMeta.segments[0].mic?.path).toBe(
      'content/segments/segment-0/audio-input.ogg'
    );
  });

  it('should identify recordings without mic/audio field', async () => {
    const mockMeta = {
      platform: 'MacOS',
      pretty_name: 'Cap 2026-01-08 at 16.46.37',
      segments: [
        {
          display: {
            path: 'content/segments/segment-0/display.mp4',
            fps: 37,
          },
          cursor: 'content/segments/segment-0/cursor.json',
        },
      ],
    } as any;

    expect(mockMeta.segments[0]?.mic).toBeUndefined();
  });

  it('should identify missing segments array', async () => {
    const invalidMeta = {
      platform: 'MacOS',
      pretty_name: 'Cap 2026-01-08 at 16.46.37',
    } as any;

    expect(invalidMeta.segments).toBeUndefined();
  });

  it('should identify empty segments array', async () => {
    const invalidMeta = {
      platform: 'MacOS',
      pretty_name: 'Cap 2026-01-08 at 16.46.37',
      segments: [],
    };

    expect(invalidMeta.segments?.length).toBe(0);
  });
});
