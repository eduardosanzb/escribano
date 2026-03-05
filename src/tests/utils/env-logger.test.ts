import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock fs module
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

// Mock process.env
const originalEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  // Reset process.env
  process.env = { ...originalEnv };
});

// Import after mocking
const { logEnvironmentVariables } = await import('../../utils/env-logger.js');

describe('Environment Variable Logger', () => {
  describe('parseEnvExample', () => {
    it('parses simple variable with description', async () => {
      const mockContent = `# Enable verbose logging
ESCRIBANO_VERBOSE=false`;

      vi.mocked(readFileSync).mockReturnValue(mockContent);

      // Call the function indirectly via logEnvironmentVariables
      process.env.ESCRIBANO_VERBOSE = 'true';

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logEnvironmentVariables();

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls
        .map((call) => call.join(' '))
        .join('\n');
      expect(output).toContain('ESCRIBANO_VERBOSE');
      expect(output).toContain('Enable verbose logging');

      consoleSpy.mockRestore();
    });

    it('skips section headers', async () => {
      const mockContent = `# === Frame Extraction ===
# Output frame width
ESCRIBANO_FRAME_WIDTH=1024`;

      vi.mocked(readFileSync).mockReturnValue(mockContent);
      process.env.ESCRIBANO_VERBOSE = 'true';

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logEnvironmentVariables();

      const output = consoleSpy.mock.calls
        .map((call) => call.join(' '))
        .join('\n');
      expect(output).toContain('ESCRIBANO_FRAME_WIDTH');
      expect(output).toContain('Output frame width');
      expect(output).not.toContain('Frame Extraction');

      consoleSpy.mockRestore();
    });

    it('skips commented/deprecated variables', async () => {
      const mockContent = `# Active variable
ESCRIBANO_VERBOSE=false
# ESCRIBANO_DEPRECATED=value`;

      vi.mocked(readFileSync).mockReturnValue(mockContent);
      process.env.ESCRIBANO_VERBOSE = 'true';

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logEnvironmentVariables();

      const output = consoleSpy.mock.calls
        .map((call) => call.join(' '))
        .join('\n');
      expect(output).toContain('ESCRIBANO_VERBOSE');
      expect(output).not.toContain('ESCRIBANO_DEPRECATED');

      consoleSpy.mockRestore();
    });

    it('skips non-ESCRIBANO variables', async () => {
      const mockContent = `ESCRIBANO_VERBOSE=false
OTHER_VAR=value`;

      vi.mocked(readFileSync).mockReturnValue(mockContent);
      process.env.ESCRIBANO_VERBOSE = 'true';

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logEnvironmentVariables();

      const output = consoleSpy.mock.calls
        .map((call) => call.join(' '))
        .join('\n');
      expect(output).toContain('ESCRIBANO_VERBOSE');
      expect(output).not.toContain('OTHER_VAR');

      consoleSpy.mockRestore();
    });

    it('handles empty file gracefully', async () => {
      vi.mocked(readFileSync).mockReturnValue('');
      process.env.ESCRIBANO_VERBOSE = 'true';

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logEnvironmentVariables();

      const output = consoleSpy.mock.calls
        .map((call) => call.join(' '))
        .join('\n');
      expect(output).toContain('Environment Variables');

      consoleSpy.mockRestore();
    });

    it('handles file not found gracefully', async () => {
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error('ENOENT');
      });
      process.env.ESCRIBANO_VERBOSE = 'true';

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logEnvironmentVariables();

      const output = consoleSpy.mock.calls
        .map((call) => call.join(' '))
        .join('\n');
      expect(output).toContain('Could not parse .env.example');

      consoleSpy.mockRestore();
    });
  });

  describe('logEnvironmentVariables', () => {
    it('does not log when ESCRIBANO_VERBOSE is false', () => {
      process.env.ESCRIBANO_VERBOSE = 'false';

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logEnvironmentVariables();

      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('does not log when ESCRIBANO_VERBOSE is not set', () => {
      delete process.env.ESCRIBANO_VERBOSE;

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logEnvironmentVariables();

      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('logs when ESCRIBANO_VERBOSE is true', () => {
      const mockContent = 'ESCRIBANO_VERBOSE=false';
      vi.mocked(readFileSync).mockReturnValue(mockContent);
      process.env.ESCRIBANO_VERBOSE = 'true';

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logEnvironmentVariables();

      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('marks custom values with [CUSTOM]', () => {
      const mockContent = `# Default batch size
ESCRIBANO_VLM_BATCH_SIZE=2`;

      vi.mocked(readFileSync).mockReturnValue(mockContent);
      process.env.ESCRIBANO_VERBOSE = 'true';
      process.env.ESCRIBANO_VLM_BATCH_SIZE = '8';

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logEnvironmentVariables();

      const output = consoleSpy.mock.calls
        .map((call) => call.join(' '))
        .join('\n');
      expect(output).toContain('[CUSTOM]');
      expect(output).toContain('Current: 8');
      expect(output).toContain('Default: 2');

      consoleSpy.mockRestore();
    });

    it('does not mark default values', () => {
      const mockContent = `# Default batch size
ESCRIBANO_VLM_BATCH_SIZE=2`;

      vi.mocked(readFileSync).mockReturnValue(mockContent);
      process.env.ESCRIBANO_VERBOSE = 'true';
      process.env.ESCRIBANO_VLM_BATCH_SIZE = '2';

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logEnvironmentVariables();

      const output = consoleSpy.mock.calls
        .map((call) => call.join(' '))
        .join('\n');
      expect(output).not.toContain('[CUSTOM]');

      consoleSpy.mockRestore();
    });

    it('masks secret tokens', () => {
      const mockContent = `ESCRIBANO_OUTLINE_TOKEN=`;

      vi.mocked(readFileSync).mockReturnValue(mockContent);
      process.env.ESCRIBANO_VERBOSE = 'true';
      process.env.ESCRIBANO_OUTLINE_TOKEN = 'secret-api-key-123';

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logEnvironmentVariables();

      const output = consoleSpy.mock.calls
        .map((call) => call.join(' '))
        .join('\n');
      expect(output).toContain('***');
      expect(output).not.toContain('secret-api-key-123');

      consoleSpy.mockRestore();
    });

    it('does not mask non-secret values', () => {
      const mockContent = `ESCRIBANO_VLM_BATCH_SIZE=2`;

      vi.mocked(readFileSync).mockReturnValue(mockContent);
      process.env.ESCRIBANO_VERBOSE = 'true';
      process.env.ESCRIBANO_VLM_BATCH_SIZE = '8';

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logEnvironmentVariables();

      const output = consoleSpy.mock.calls
        .map((call) => call.join(' '))
        .join('\n');
      expect(output).toContain('8');
      expect(output).not.toContain('***');

      consoleSpy.mockRestore();
    });

    it('shows "not set" for undefined variables', () => {
      const mockContent = `ESCRIBANO_VLM_BATCH_SIZE=2`;

      vi.mocked(readFileSync).mockReturnValue(mockContent);
      process.env.ESCRIBANO_VERBOSE = 'true';
      delete process.env.ESCRIBANO_VLM_BATCH_SIZE;

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logEnvironmentVariables();

      const output = consoleSpy.mock.calls
        .map((call) => call.join(' '))
        .join('\n');
      expect(output).toContain('not set');

      consoleSpy.mockRestore();
    });

    it('shows "(empty)" for empty default values', () => {
      const mockContent = `ESCRIBANO_OUTLINE_TOKEN=`;

      vi.mocked(readFileSync).mockReturnValue(mockContent);
      process.env.ESCRIBANO_VERBOSE = 'true';

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logEnvironmentVariables();

      const output = consoleSpy.mock.calls
        .map((call) => call.join(' '))
        .join('\n');
      expect(output).toContain('(empty)');

      consoleSpy.mockRestore();
    });

    it('sorts variables alphabetically', () => {
      const mockContent = `ESCRIBANO_ZEBRA=1
ESCRIBANO_ALPHA=2
ESCRIBANO_MIDDLE=3`;

      vi.mocked(readFileSync).mockReturnValue(mockContent);
      process.env.ESCRIBANO_VERBOSE = 'true';

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logEnvironmentVariables();

      const output = consoleSpy.mock.calls
        .map((call) => call.join(' '))
        .join('\n');
      const alphaIndex = output.indexOf('ESCRIBANO_ALPHA');
      const middleIndex = output.indexOf('ESCRIBANO_MIDDLE');
      const zebraIndex = output.indexOf('ESCRIBANO_ZEBRA');

      expect(alphaIndex).toBeLessThan(middleIndex);
      expect(middleIndex).toBeLessThan(zebraIndex);

      consoleSpy.mockRestore();
    });

    it('includes multi-line descriptions', () => {
      const mockContent = `# First line of description
# Second line of description
ESCRIBANO_VERBOSE=false`;

      vi.mocked(readFileSync).mockReturnValue(mockContent);
      process.env.ESCRIBANO_VERBOSE = 'true';

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logEnvironmentVariables();

      const output = consoleSpy.mock.calls
        .map((call) => call.join(' '))
        .join('\n');
      expect(output).toContain('First line of description');
      expect(output).toContain('Second line of description');

      consoleSpy.mockRestore();
    });
  });

  describe('text wrapping', () => {
    it('wraps long descriptions to fit width', () => {
      const longDescription =
        'This is a very long description that should be wrapped across multiple lines to fit within the specified width limit for better readability in the console output';
      const mockContent = `# ${longDescription}
ESCRIBANO_VERBOSE=false`;

      vi.mocked(readFileSync).mockReturnValue(mockContent);
      process.env.ESCRIBANO_VERBOSE = 'true';

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logEnvironmentVariables();

      // The description should appear in the output
      const output = consoleSpy.mock.calls
        .map((call) => call.join(' '))
        .join('\n');
      expect(output).toContain('very long description');

      consoleSpy.mockRestore();
    });
  });
});
