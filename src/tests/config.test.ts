import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// NOTE: loadConfig() caches results in a module-level variable (cachedConfig).
// We must reset modules before each test so each test gets a fresh cache.

describe('loadConfig', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe('default values', () => {
    it('returns default frameWidth of 1024 when no env var is set', async () => {
      vi.stubEnv('ESCRIBANO_FRAME_WIDTH', undefined as unknown as string);
      const { loadConfig } = await import('../config.js');
      const config = loadConfig();
      // RAM-aware default: 1024 for >=16GB, 768 for <16GB
      // Just verify it is a valid number (not NaN) and one of the two possible defaults
      expect(typeof config.frameWidth).toBe('number');
      expect([768, 1024]).toContain(config.frameWidth);
    });

    it('returns default vlmBatchSize of 2', async () => {
      const { loadConfig } = await import('../config.js');
      const config = loadConfig();
      expect(config.vlmBatchSize).toBe(2);
    });

    it('returns default sceneThreshold of 0.4', async () => {
      const { loadConfig } = await import('../config.js');
      const config = loadConfig();
      expect(config.sceneThreshold).toBe(0.4);
    });

    it('returns default verbose of false', async () => {
      const { loadConfig } = await import('../config.js');
      const config = loadConfig();
      expect(config.verbose).toBe(false);
    });

    it('returns default llmBackend of mlx', async () => {
      const { loadConfig } = await import('../config.js');
      const config = loadConfig();
      expect(config.llmBackend).toBe('mlx');
    });

    it('returns default sampleInterval of 10', async () => {
      const { loadConfig } = await import('../config.js');
      const config = loadConfig();
      expect(config.sampleInterval).toBe(10);
    });

    it('returns default vlmMaxTokens of 2000', async () => {
      const { loadConfig } = await import('../config.js');
      const config = loadConfig();
      expect(config.vlmMaxTokens).toBe(2000);
    });
  });

  describe('env var overrides', () => {
    it('ESCRIBANO_FRAME_WIDTH overrides frameWidth', async () => {
      vi.stubEnv('ESCRIBANO_FRAME_WIDTH', '1280');
      const { loadConfig } = await import('../config.js');
      const config = loadConfig();
      expect(config.frameWidth).toBe(1280);
    });

    it('ESCRIBANO_VLM_BATCH_SIZE overrides vlmBatchSize', async () => {
      vi.stubEnv('ESCRIBANO_VLM_BATCH_SIZE', '4');
      const { loadConfig } = await import('../config.js');
      const config = loadConfig();
      expect(config.vlmBatchSize).toBe(4);
    });

    it('ESCRIBANO_SCENE_THRESHOLD overrides sceneThreshold', async () => {
      vi.stubEnv('ESCRIBANO_SCENE_THRESHOLD', '0.7');
      const { loadConfig } = await import('../config.js');
      const config = loadConfig();
      expect(config.sceneThreshold).toBe(0.7);
    });
  });

  describe('boolean parsing', () => {
    it('ESCRIBANO_VERBOSE=true sets verbose to true', async () => {
      vi.stubEnv('ESCRIBANO_VERBOSE', 'true');
      const { loadConfig } = await import('../config.js');
      const config = loadConfig();
      expect(config.verbose).toBe(true);
    });

    it('ESCRIBANO_VERBOSE=false sets verbose to false', async () => {
      vi.stubEnv('ESCRIBANO_VERBOSE', 'false');
      const { loadConfig } = await import('../config.js');
      const config = loadConfig();
      expect(config.verbose).toBe(false);
    });

    it('ESCRIBANO_DEBUG_VLM=true sets debugVlm to true', async () => {
      vi.stubEnv('ESCRIBANO_DEBUG_VLM', 'true');
      const { loadConfig } = await import('../config.js');
      const config = loadConfig();
      expect(config.debugVlm).toBe(true);
    });

    it('ESCRIBANO_SKIP_LLM=true sets skipLlm to true', async () => {
      vi.stubEnv('ESCRIBANO_SKIP_LLM', 'true');
      const { loadConfig } = await import('../config.js');
      const config = loadConfig();
      expect(config.skipLlm).toBe(true);
    });
  });

  describe('backend selection', () => {
    it('ESCRIBANO_LLM_BACKEND=ollama sets llmBackend to ollama', async () => {
      vi.stubEnv('ESCRIBANO_LLM_BACKEND', 'ollama');
      const { loadConfig } = await import('../config.js');
      const config = loadConfig();
      expect(config.llmBackend).toBe('ollama');
    });

    it('ESCRIBANO_LLM_BACKEND=mlx sets llmBackend to mlx', async () => {
      vi.stubEnv('ESCRIBANO_LLM_BACKEND', 'mlx');
      const { loadConfig } = await import('../config.js');
      const config = loadConfig();
      expect(config.llmBackend).toBe('mlx');
    });
  });

  describe('invalid values', () => {
    it('ESCRIBANO_FRAME_WIDTH=abc falls back to default (not NaN)', async () => {
      vi.stubEnv('ESCRIBANO_FRAME_WIDTH', 'abc');
      const { loadConfig } = await import('../config.js');
      const config = loadConfig();
      // Should fall back to RAM-aware default (768 or 1024), never NaN
      expect(Number.isNaN(config.frameWidth)).toBe(false);
      expect([768, 1024]).toContain(config.frameWidth);
    });

    it('ESCRIBANO_VLM_BATCH_SIZE=xyz falls back to default 2', async () => {
      vi.stubEnv('ESCRIBANO_VLM_BATCH_SIZE', 'xyz');
      const { loadConfig } = await import('../config.js');
      const config = loadConfig();
      expect(config.vlmBatchSize).toBe(2);
    });

    it('ESCRIBANO_SCENE_THRESHOLD=notanumber falls back to default 0.4', async () => {
      vi.stubEnv('ESCRIBANO_SCENE_THRESHOLD', 'notanumber');
      const { loadConfig } = await import('../config.js');
      const config = loadConfig();
      expect(config.sceneThreshold).toBe(0.4);
    });
  });
});
