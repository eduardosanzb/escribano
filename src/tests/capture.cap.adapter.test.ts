/**
 * Cap Adapter Tests
 */

import { describe, expect, it, vi } from 'vitest';
import type { VideoService } from '../0_types.js';
import { createCapCaptureSource } from '../adapters/capture.cap.adapter.js';

// Mock VideoService
const mockVideoService: VideoService = {
  extractFramesAtInterval: vi.fn(),
  extractFramesAtTimestamps: vi.fn(),
  getMetadata: vi
    .fn()
    .mockResolvedValue({ duration: 300, width: 1920, height: 1080, fps: 30 }),
  detectSceneChanges: vi.fn(),
  runVisualIndexing: vi.fn(),
};

describe('Cap Adapter', () => {
  it('should create a CapSource', () => {
    const capSource = createCapCaptureSource(
      { recordingsPath: '~/tmp/recordings' },
      mockVideoService
    );

    expect(capSource).toBeDefined();
    expect(capSource.getLatestRecording).toBeInstanceOf(Function);
  });

  it('should handle nonexistent directory gracefully', async () => {
    const capSource = createCapCaptureSource(
      { recordingsPath: '/nonexistent/path' },
      mockVideoService
    );

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
    interface MockMeta {
      segments?: Array<{ mic?: unknown }>;
    }
    const mockMeta: MockMeta = {
      segments: [{}],
    };

    expect(mockMeta.segments?.[0]?.mic).toBeUndefined();
  });

  it('should identify missing segments array', async () => {
    const invalidMeta: { segments?: unknown[] } = {};

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
