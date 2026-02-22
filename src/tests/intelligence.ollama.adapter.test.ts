/**
 * Intelligence Adapter Tests
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntelligenceConfig, Transcript } from '../0_types.js';
import { createOllamaIntelligenceService } from '../adapters/intelligence.ollama.adapter.js';

// Mock node:fs
vi.mock('node:fs', () => ({
  readFileSync: vi.fn((path: string) => {
    if (path.includes('.jpg') || path.includes('.png')) {
      return Buffer.from('fake-image-data');
    }
    if (path.includes('.md')) {
      return '{{TRANSCRIPT_ALL}} {{TRANSCRIPT_SEGMENTS}} {{VISUAL_LOG}} {{CLASSIFICATION_SUMMARY}} {{METADATA}} {{LANGUAGE}} {{SPEAKERS}} {{KEY_MOMENTS}} {{ACTION_ITEMS}} {{TECHNICAL_TERMS}} {{CODE_SNIPPETS}}';
    }
    return '';
  }),
}));

const mockConfig: IntelligenceConfig = {
  provider: 'ollama',
  endpoint: 'http://localhost:11434/v1/chat/completions',
  model: 'qwen3:32b',
  generationModel: 'qwen2.5:72b',
  visionModel: 'minicpm-v:8b',
  maxRetries: 3,
  timeout: 30000,
  keepAlive: '10m',
  maxContextSize: 131072,
  embedding: {
    model: 'nomic-embed-text',
    similarityThreshold: 0.75,
  },
};

const mockTranscript: Transcript = {
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

describe('IntelligenceService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should create an intelligence service', () => {
    const service = createOllamaIntelligenceService(mockConfig);
    expect(service).toBeDefined();
    expect(service.classify).toBeInstanceOf(Function);
    expect(service.classifySegment).toBeInstanceOf(Function);
    expect(service.generate).toBeInstanceOf(Function);
    expect(service.describeImages).toBeInstanceOf(Function);
  });

  it('should describe images', async () => {
    const mockResponse = JSON.stringify({
      message: {
        content: JSON.stringify({
          descriptions: [
            { index: 0, summary: 'A cat sitting on a mat' },
            { index: 1, summary: 'A dog chasing a ball' },
          ],
        }),
      },
      done: true,
      done_reason: 'stop',
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => JSON.parse(mockResponse),
    } as unknown as typeof fetch);

    const service = createOllamaIntelligenceService(mockConfig);
    const result = await service.describeImages([
      { imagePath: '/path/to/cat.jpg', timestamp: 10 },
      { imagePath: '/path/to/dog.jpg', timestamp: 20 },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].description).toBe('A cat sitting on a mat');
    expect(result[1].description).toBe('A dog chasing a ball');
  });

  it('should classify a debugging session', async () => {
    const mockResponse = JSON.stringify({
      message: {
        content: JSON.stringify({
          meeting: 10,
          debugging: 90,
          tutorial: 15,
          learning: 20,
          working: 5,
        }),
      },
      done: true,
      done_reason: 'stop',
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => JSON.parse(mockResponse),
    } as unknown as typeof fetch);

    const service = createOllamaIntelligenceService(mockConfig);
    const result = await service.classify(mockTranscript);

    expect(result.debugging).toBe(90);
    expect(result.meeting).toBe(10);
    expect(result.tutorial).toBe(15);
    expect(result.learning).toBe(20);
    expect(result.working).toBe(5);
  });

  it('should retry on API failures', async () => {
    let attempts = 0;
    global.fetch = vi.fn().mockImplementation(async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error('API timeout');
      }
      return {
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify({
              meeting: 80,
              debugging: 10,
              tutorial: 5,
              learning: 15,
              working: 5,
            }),
          },
          done: true,
          done_reason: 'stop',
        }),
      };
    });

    const service = createOllamaIntelligenceService(mockConfig);
    const result = await service.classify(mockTranscript);

    expect(attempts).toBe(3);
    expect(result.meeting).toBe(80);
  });

  it('should handle fetch errors correctly', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    } as unknown as typeof fetch);

    const service = createOllamaIntelligenceService(mockConfig);

    await expect(service.classify(mockTranscript)).rejects.toThrow(
      'Request failed after 3 retries'
    );
  });
});
