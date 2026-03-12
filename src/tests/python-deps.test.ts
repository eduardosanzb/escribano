/**
 * Tests for Python Dependency Management
 *
 * Covers the self-heal behavior of ensureEscribanoVenv and package detection.
 */

import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock fs and child_process
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import {
  checkCorePackagesInstalled,
  checkPythonPackageInstalled,
  detectPipCommand,
  ensureEscribanoVenv,
  getPythonPackagesToInstall,
} from '../python-deps.js';

const mockExistsSync = vi.mocked(existsSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockExecSync = vi.mocked(execSync);

const ESCRIBANO_VENV_PYTHON = resolve(
  homedir(),
  '.escribano',
  'venv',
  'bin',
  'python3'
);

describe('getPythonPackagesToInstall', () => {
  it('returns deduplicated MLX packages only (no audio)', () => {
    const packages = getPythonPackagesToInstall();
    expect(packages).toContain('mlx-vlm>=0.9.0');
    expect(packages).toContain('mlx-lm>=0.9.0');
    expect(packages).toContain('mlx>=0.14.0');
    // Should not contain audio packages
    expect(packages).not.toContain('torch>=2.0.0');
    expect(packages).not.toContain('torchaudio>=2.0.0');
  });
});

describe('checkPythonPackageInstalled', () => {
  beforeEach(() => {
    mockExecSync.mockReset();
  });

  it('returns true when import succeeds', () => {
    mockExecSync.mockReturnValue('');
    expect(checkPythonPackageInstalled('mlx_vlm', '/path/to/python3')).toBe(
      true
    );
  });

  it('returns false when import fails', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('ModuleNotFoundError');
    });
    expect(checkPythonPackageInstalled('mlx_vlm', '/path/to/python3')).toBe(
      false
    );
  });

  it('maps hyphenated package names to valid Python module names', () => {
    mockExecSync.mockReturnValue('');
    checkPythonPackageInstalled('mlx-vlm>=0.9.0', '/path/to/python3');
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('import mlx_vlm'),
      expect.any(Object)
    );
  });
});

describe('checkCorePackagesInstalled', () => {
  beforeEach(() => {
    mockExecSync.mockReset();
  });

  it('returns true when all core modules are importable', () => {
    mockExecSync.mockReturnValue('');
    expect(checkCorePackagesInstalled('/path/to/python3')).toBe(true);
    expect(mockExecSync).toHaveBeenCalledTimes(3); // mlx_vlm, mlx_lm, mlx
  });

  it('returns false when any core module is missing', () => {
    mockExecSync
      .mockReturnValueOnce('') // mlx_vlm OK
      .mockImplementation(() => {
        throw new Error('ModuleNotFoundError');
      });
    expect(checkCorePackagesInstalled('/path/to/python3')).toBe(false);
  });
});

describe('detectPipCommand', () => {
  beforeEach(() => {
    mockExecSync.mockReset();
  });

  it('returns uv command when uv is available', () => {
    mockExecSync.mockReturnValue('uv 0.1.0');
    expect(detectPipCommand()).toBe('uv pip install mlx-vlm mlx mlx-lm');
  });

  it('returns pip3 command when pip3 is available', () => {
    mockExecSync
      .mockImplementationOnce(() => {
        throw new Error('uv not found');
      })
      .mockReturnValue('pip 23.0');
    expect(detectPipCommand()).toBe('pip3 install mlx-vlm mlx mlx-lm');
  });

  it('returns pip command as fallback', () => {
    mockExecSync
      .mockImplementationOnce(() => {
        throw new Error('uv not found');
      })
      .mockImplementationOnce(() => {
        throw new Error('pip3 not found');
      })
      .mockReturnValue('pip 23.0');
    expect(detectPipCommand()).toBe('pip install mlx-vlm mlx mlx-lm');
  });

  it('returns python3 -m pip as final fallback', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('not found');
    });
    expect(detectPipCommand()).toBe(
      'python3 -m pip install mlx-vlm mlx mlx-lm'
    );
  });
});

describe('ensureEscribanoVenv', () => {
  beforeEach(() => {
    mockExistsSync.mockReset();
    mockMkdirSync.mockReset();
    mockExecSync.mockReset();
  });

  it('returns early when venv exists and packages are installed', () => {
    // venv exists
    mockExistsSync.mockReturnValue(true);
    // packages installed (all 3 imports succeed)
    mockExecSync.mockReturnValue('');

    const result = ensureEscribanoVenv();
    expect(result).toBe(ESCRIBANO_VENV_PYTHON);
    // Should not create venv or install packages
    expect(mockMkdirSync).not.toHaveBeenCalled();
  });

  it('installs packages when venv exists but packages are missing', () => {
    // venv exists
    mockExistsSync.mockReturnValue(true);
    // packages missing (first import fails)
    mockExecSync
      .mockImplementationOnce(() => {
        throw new Error('ModuleNotFoundError');
      })
      .mockReturnValue(''); // pip install succeeds

    const result = ensureEscribanoVenv();
    expect(result).toBe(ESCRIBANO_VENV_PYTHON);
    // Should install packages
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('pip install'),
      expect.any(Object)
    );
  });

  it('creates venv and installs packages when neither exists', () => {
    // venv does not exist initially, then exists after creation
    mockExistsSync
      .mockReturnValueOnce(false) // ESCRIBANO_VENV_PYTHON check
      .mockReturnValueOnce(false) // ESCRIBANO_HOME check
      .mockReturnValue(true); // subsequent checks
    // venv creation and package installation succeed
    mockExecSync.mockReturnValue('');

    const result = ensureEscribanoVenv();
    expect(result).toBe(ESCRIBANO_VENV_PYTHON);
    // Should create directory
    expect(mockMkdirSync).toHaveBeenCalled();
    // Should create venv
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('python3 -m venv'),
      expect.any(Object)
    );
    // Should install packages
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('pip install'),
      expect.any(Object)
    );
  });

  it('throws when venv creation fails', () => {
    mockExistsSync.mockReturnValue(false);
    mockExecSync.mockImplementation(() => {
      throw new Error('venv creation failed');
    });

    expect(() => ensureEscribanoVenv()).toThrow(
      'Failed to create managed venv'
    );
  });

  it('throws when package installation fails', () => {
    // venv exists but packages missing
    mockExistsSync.mockReturnValue(true);
    mockExecSync
      .mockImplementationOnce(() => {
        throw new Error('ModuleNotFoundError');
      })
      .mockImplementation(() => {
        throw new Error('pip install failed');
      });

    expect(() => ensureEscribanoVenv()).toThrow('Failed to install packages');
  });
});
