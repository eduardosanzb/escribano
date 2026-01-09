/**
 * Intelligence Adapter Tests
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntelligenceConfig, Transcript } from '../0_types.js';
import { createIntelligenceService } from '../adapters/intelligence.adapter.js';

const mockConfig: IntelligenceConfig = {
  provider: 'ollama',
  endpoint: 'http://localhost:11434/v1/chat/completions',
  model: 'qwen3:32b',
  generationModel: 'qwen2.5:72b',
  maxRetries: 3,
  timeout: 30000,
  keepAlive: '10m',
  maxContextSize: 131072,
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
    const service = createIntelligenceService(mockConfig);
    expect(service).toBeDefined();
    expect(service.classify).toBeInstanceOf(Function);
    expect(service.generate).toBeInstanceOf(Function);
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

    const service = createIntelligenceService(mockConfig);
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

    const service = createIntelligenceService(mockConfig);
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

    const service = createIntelligenceService(mockConfig);

    await expect(service.classify(mockTranscript)).rejects.toThrow(
      'Request failed after 3 retries'
    );
  });
});
