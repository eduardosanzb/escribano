/**
 * MLX Intelligence Adapter Tests
 *
 * Tests for Python path detection and auto-venv setup logic used to locate
 * (or create) the correct Python interpreter with mlx-vlm installed.
 */

import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock fs so we can control which paths "exist"
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
}));

import { existsSync } from 'node:fs';
import { resolvePythonPath } from '../adapters/intelligence.mlx.adapter.js';
import { getPythonPath } from '../python-utils.js';

// Mock python-deps to control venv behavior
vi.mock('../python-deps.js', () => ({
  ensureEscribanoVenv: vi.fn(),
}));

import { ensureEscribanoVenv as ensurePythonVenv } from '../python-deps.js';

const mockExistsSync = vi.mocked(existsSync);
const mockEnsurePythonVenv = vi.mocked(ensurePythonVenv);

// Keys cleared/restored around each test
const MANAGED_KEYS = [
  'ESCRIBANO_PYTHON_PATH',
  'VIRTUAL_ENV',
  'UV_PROJECT_ENVIRONMENT',
] as const;

describe('getPythonPath', () => {
  const saved: Partial<Record<string, string>> = {};

  beforeEach(() => {
    for (const key of MANAGED_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    mockExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    for (const key of MANAGED_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
    mockExistsSync.mockReset();
  });

  it('returns ESCRIBANO_PYTHON_PATH when set (highest priority)', () => {
    process.env.ESCRIBANO_PYTHON_PATH = '/custom/python3';
    expect(getPythonPath()).toBe('/custom/python3');
  });

  it('returns VIRTUAL_ENV python when set', () => {
    process.env.VIRTUAL_ENV = '/home/user/myenv';
    expect(getPythonPath()).toBe(resolve('/home/user/myenv', 'bin', 'python3'));
  });

  it('prefers ESCRIBANO_PYTHON_PATH over VIRTUAL_ENV', () => {
    process.env.ESCRIBANO_PYTHON_PATH = '/explicit/python3';
    process.env.VIRTUAL_ENV = '/some/venv';
    expect(getPythonPath()).toBe('/explicit/python3');
  });

  it('returns UV_PROJECT_ENVIRONMENT python when set', () => {
    process.env.UV_PROJECT_ENVIRONMENT = '/project/.venv';
    expect(getPythonPath()).toBe(resolve('/project/.venv', 'bin', 'python3'));
  });

  it('prefers VIRTUAL_ENV over UV_PROJECT_ENVIRONMENT', () => {
    process.env.VIRTUAL_ENV = '/active/venv';
    process.env.UV_PROJECT_ENVIRONMENT = '/project/.venv';
    expect(getPythonPath()).toBe(resolve('/active/venv', 'bin', 'python3'));
  });

  it('returns null when nothing is explicitly configured (triggers auto-venv)', () => {
    mockExistsSync.mockReturnValue(false);
    expect(getPythonPath()).toBeNull();
  });
});

describe('resolvePythonPath', () => {
  const saved: Partial<Record<string, string>> = {};

  beforeEach(() => {
    for (const key of MANAGED_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    mockExistsSync.mockReturnValue(false);
    mockEnsurePythonVenv.mockClear();
  });

  afterEach(() => {
    for (const key of MANAGED_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
    mockExistsSync.mockReset();
    vi.restoreAllMocks();
  });

  it('returns the explicit path immediately when ESCRIBANO_PYTHON_PATH is set', async () => {
    process.env.ESCRIBANO_PYTHON_PATH = '/my/python3';
    await expect(resolvePythonPath()).resolves.toBe('/my/python3');
    // Should not call ensurePythonVenv when explicit path is set
    expect(mockEnsurePythonVenv).not.toHaveBeenCalled();
  });

  it('returns the explicit path immediately when VIRTUAL_ENV is set', async () => {
    process.env.VIRTUAL_ENV = '/my/venv';
    await expect(resolvePythonPath()).resolves.toBe(
      resolve('/my/venv', 'bin', 'python3')
    );
    // Should not call ensurePythonVenv when explicit path is set
    expect(mockEnsurePythonVenv).not.toHaveBeenCalled();
  });

  it('delegates to ensurePythonVenv when nothing is configured', async () => {
    const managedPython = resolve(
      homedir(),
      '.escribano',
      'venv',
      'bin',
      'python3'
    );
    mockEnsurePythonVenv.mockResolvedValue(managedPython);

    await expect(resolvePythonPath()).resolves.toBe(managedPython);
    expect(mockEnsurePythonVenv).toHaveBeenCalledOnce();
  });

  it('propagates errors from ensurePythonVenv', async () => {
    const testError = new Error('Failed to set up Python environment');
    mockEnsurePythonVenv.mockRejectedValue(testError);

    await expect(resolvePythonPath()).rejects.toThrow(testError);
    expect(mockEnsurePythonVenv).toHaveBeenCalledOnce();
  });
});
