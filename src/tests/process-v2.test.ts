/**
 * Process Recording V2 Tests
 */

import { describe, expect, it, vi } from 'vitest';
import type {
  IntelligenceService,
  Repositories,
  TranscriptionService,
  VideoService,
} from '../0_types.js';
import { processRecordingV2 } from '../actions/process-recording-v2.js';
import type { AudioPreprocessor } from '../adapters/audio.silero.adapter.js';

describe('processRecordingV2', () => {
  it('should call extractFramesAtInterval instead of extractFramesAtTimestamps during visual processing', async () => {
    // Mock Recording in DB
    const mockDbRecording = {
      id: 'rec-123',
      status: 'raw',
      processing_step: 'idle',
      video_path: '/tmp/test.mp4',
      audio_mic_path: null,
      audio_system_path: null,
      captured_at: new Date(),
      duration: 60,
    };

    const mockRepos = {
      recordings: {
        findById: vi.fn().mockReturnValue(mockDbRecording),
        updateStatus: vi.fn(),
      },
      observations: {
        saveBatch: vi.fn(),
      },
    } as unknown as Repositories;

    const mockVideoService = {
      extractFramesAtInterval: vi.fn().mockResolvedValue([
        { imagePath: '/tmp/f1.jpg', timestamp: 0 },
        { imagePath: '/tmp/f2.jpg', timestamp: 2 },
      ]),
      extractFramesAtTimestamps: vi.fn(),
      runVisualIndexing: vi.fn().mockResolvedValue({ frames: [] }),
    } as unknown as VideoService;

    const mockIntelligence = {
      describeImages: vi.fn().mockResolvedValue({ descriptions: [] }),
      embedText: vi.fn().mockResolvedValue([]),
    } as unknown as IntelligenceService;

    const mockPreprocessor = {
      extractSpeechSegments: vi
        .fn()
        .mockResolvedValue({ segments: [], tempDir: '/tmp' }),
      cleanup: vi.fn(),
    } as unknown as AudioPreprocessor;

    const mockTranscription = {} as TranscriptionService;

    await processRecordingV2('rec-123', mockRepos, {
      video: mockVideoService,
      intelligence: mockIntelligence,
      preprocessor: mockPreprocessor,
      transcription: mockTranscription,
    });

    // Verify correct function was called
    expect(mockVideoService.extractFramesAtInterval).toHaveBeenCalled();
    expect(mockVideoService.extractFramesAtTimestamps).not.toHaveBeenCalled();

    // Verify interval-based extraction was used with correct threshold
    expect(mockVideoService.extractFramesAtInterval).toHaveBeenCalledWith(
      '/tmp/test.mp4',
      0.3,
      expect.stringContaining('frames')
    );
  });
});
