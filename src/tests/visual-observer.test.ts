/**
 * Visual Observer Integration Tests
 */

import { describe, expect, it, vi } from 'vitest';
import type {
  IntelligenceService,
  Recording,
  StorageService,
  Transcript,
  TranscriptionService,
  VideoService,
  VisualIndex,
} from '../0_types.js';
import { processSession } from '../actions/process-session.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: vi.fn().mockResolvedValue(undefined),
  };
});

// Mock data
const mockRecording: Recording = {
  id: 'test-recording-123',
  source: {
    type: 'cap',
    originalPath: '/tmp/test.cap',
  },
  videoPath: '/tmp/test.mp4',
  audioMicPath: '/tmp/mic.wav',
  audioSystemPath: null,
  duration: 60,
  capturedAt: new Date(),
};

// Note: Transcript mock not used in current test setup
// const _mockTranscript: Transcript = {
//   fullText: 'Hello world',
//   segments: [{ id: '1', start: 0, end: 5, text: 'Hello world' }],
//   language: 'en',
//   duration: 60,
// };

const mockVisualIndex: VisualIndex = {
  frames: [
    {
      index: 0,
      timestamp: 0,
      imagePath: '/tmp/frame_0.jpg',
      ocrText: 'def foo(): pass',
      clusterId: 0,
      changeScore: 0,
    },
  ],
  clusters: [
    {
      id: 0,
      heuristicLabel: 'code-editor',
      timeRange: [0, 60],
      frameCount: 1,
      representativeIdx: 0,
      avgOcrCharacters: 15,
      mediaIndicators: [],
    },
  ],
  processingTime: { ocrMs: 100, clipMs: 100, totalMs: 200 },
};

// Mock for describeImages() - returns array of parsed VLM results (not VisualDescriptions)
const mockVlmResults = [
  {
    index: 0,
    timestamp: 0,
    imagePath: '/tmp/frame_0.jpg',
    activity: 'coding',
    description: 'User is writing python code',
    apps: ['VSCode'],
    topics: ['python', 'programming'],
  },
];

const mockStorageService: StorageService = {
  saveSession: vi.fn().mockResolvedValue(undefined),
  loadSession: vi.fn().mockResolvedValue(null),
  listSessions: vi.fn().mockResolvedValue([]),
  saveArtifact: vi.fn().mockResolvedValue(undefined),
  loadArtifacts: vi.fn().mockResolvedValue([]),
};

describe('Visual Observer Pipeline', () => {
  it('should process session with visual intelligence', async () => {
    // Mock services
    const mockTranscriber: TranscriptionService = {
      transcribe: vi.fn().mockResolvedValue({
        fullText: '',
        segments: [],
        language: 'en',
        duration: 0,
      }),
      transcribeSegment: vi.fn().mockResolvedValue(''),
    };

    const mockVideoService: VideoService = {
      extractFramesAtTimestamps: vi
        .fn()
        .mockResolvedValue(['/tmp/frame_0.jpg']),
      extractFramesAtInterval: vi
        .fn()
        .mockResolvedValue([{ imagePath: '/tmp/frame_0.jpg', timestamp: 0 }]),
      extractFramesAtTimestampsBatch: vi
        .fn()
        .mockResolvedValue([{ imagePath: '/tmp/frame_0.jpg', timestamp: 0 }]),
      getMetadata: vi
        .fn()
        .mockResolvedValue({ duration: 60, width: 1920, height: 1080 }),
      runVisualIndexing: vi.fn().mockResolvedValue(mockVisualIndex),
      detectSceneChanges: vi.fn().mockResolvedValue([]),
    };

    const mockIntelligenceService: IntelligenceService = {
      classify: vi.fn(),
      classifySegment: vi.fn(),
      extractMetadata: vi.fn(),
      generate: vi.fn(),
      describeImages: vi.fn().mockResolvedValue(mockVlmResults),
      embedText: vi.fn(),
      extractTopics: vi.fn(),
      generateText: vi.fn().mockResolvedValue('Mock generated summary'),
    };

    const session = await processSession(
      mockRecording,
      mockTranscriber,
      mockVideoService,
      mockStorageService,
      mockIntelligenceService
    );

    expect(session.id).toBe(mockRecording.id);
    expect(session.visualLogs).toHaveLength(1);
    expect(session.visualLogs[0].entries).toHaveLength(1);

    const entry = session.visualLogs[0].entries[0];
    expect(entry.description).toBe('User is writing python code');
    expect(entry.heuristicLabel).toBe('code-editor');
    expect(entry.ocrSummary).toContain('def foo()');
  });

  it('should skip VLM when discriminator rules say so', async () => {
    // Case: Rich audio transcript overlaps with cluster
    const richTranscript: Transcript = {
      fullText: 'I am writing a long explanation of this code for 60 seconds.',
      segments: [
        {
          id: '1',
          start: 0,
          end: 60,
          text: 'I am writing a long explanation of this code for 60 seconds.',
        },
      ],
      language: 'en',
      duration: 60,
    };

    // Cluster with high OCR density and audio overlap
    const denseIndex: VisualIndex = {
      ...mockVisualIndex,
      clusters: [
        {
          ...mockVisualIndex.clusters[0],
          avgOcrCharacters: 2000, // High density
        },
      ],
    };

    const mockTranscriber: TranscriptionService = {
      transcribe: vi.fn().mockResolvedValue(richTranscript),
      transcribeSegment: vi.fn().mockResolvedValue(''),
    };

    const mockVideoService: VideoService = {
      // biome-ignore lint/suspicious/noExplicitAny: mock
      ...(vi.fn() as any), // Other methods mocked as needed
      extractFramesAtTimestamps: vi.fn(),
      extractFramesAtInterval: vi
        .fn()
        .mockResolvedValue([{ imagePath: '/tmp/f.jpg', timestamp: 0 }]),
      runVisualIndexing: vi.fn().mockResolvedValue(denseIndex),
    };

    const mockIntelligenceService: IntelligenceService = {
      classify: vi.fn(),
      classifySegment: vi.fn(),
      extractMetadata: vi.fn(),
      generate: vi.fn(),
      describeImages: vi.fn(), // Should NOT be called
      embedText: vi.fn(),
      extractTopics: vi.fn(),
      generateText: vi.fn().mockResolvedValue('Mock generated summary'),
    };

    const session = await processSession(
      mockRecording,
      mockTranscriber,
      mockVideoService,
      mockStorageService,
      mockIntelligenceService
    );

    expect(mockIntelligenceService.describeImages).not.toHaveBeenCalled();
    expect(session.visualLogs[0].entries[0].description).toBeUndefined();
  });
});
