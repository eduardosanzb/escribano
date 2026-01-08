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
  maxRetries: 3,
  timeout: 30000,
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
        }),
      },
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => JSON.parse(mockResponse),
    } as unknown as typeof fetch);

    const service = createIntelligenceService(mockConfig);
    const result = await service.classify(mockTranscript);

    expect(result.type).toBe('debugging');
    expect(result.confidence).toBe(0.95);
    expect(result.entities).toHaveLength(2);
    expect(result.entities[0].type).toBe('error');
    expect(result.entities[0].segmentId).toBe('seg-0');
  });

  it('should throw on generate() - not implemented', async () => {
    const service = createIntelligenceService(mockConfig);

    await expect(
      service.generate(mockTranscript.fullText, { transcript: mockTranscript })
    ).rejects.toThrow('generate() not implemented - Milestone 3');
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
              type: 'meeting',
              confidence: 0.8,
              entities: [],
            }),
          },
        }),
      } as unknown as typeof fetch;
    });

    const service = createIntelligenceService(mockConfig);
    const result = await service.classify(mockTranscript);

    expect(attempts).toBe(3);
    expect(result.type).toBe('meeting');
  });

  it('should handle fetch errors correctly', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    } as unknown as typeof fetch);

    const service = createIntelligenceService(mockConfig);

    await expect(service.classify(mockTranscript)).rejects.toThrow(
      'Classification failed after 3 retries'
    );
  });
});
