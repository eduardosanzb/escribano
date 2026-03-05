/**
 * MLX Intelligence Adapter Tests
 *
 * Tests for Python path detection logic used to locate the correct Python
 * interpreter with mlx-vlm installed (supports multiple uv setups).
 */

import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock node:fs so we can control which paths "exist"
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
  unlinkSync: vi.fn(),
}));

import { existsSync } from 'node:fs';
import { getPythonPath } from '../adapters/intelligence.mlx.adapter.js';

const mockExistsSync = vi.mocked(existsSync);

describe('getPythonPath', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset env and mocks before each test
    for (const key of Object.keys(process.env)) {
      if (
        key === 'ESCRIBANO_PYTHON_PATH' ||
        key === 'VIRTUAL_ENV' ||
        key === 'UV_PROJECT_ENVIRONMENT'
      ) {
        delete process.env[key];
      }
    }
    mockExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    // Restore original env
    process.env.ESCRIBANO_PYTHON_PATH = originalEnv.ESCRIBANO_PYTHON_PATH;
    process.env.VIRTUAL_ENV = originalEnv.VIRTUAL_ENV;
    process.env.UV_PROJECT_ENVIRONMENT = originalEnv.UV_PROJECT_ENVIRONMENT;
  });

  it('should return ESCRIBANO_PYTHON_PATH when set (highest priority)', () => {
    process.env.ESCRIBANO_PYTHON_PATH = '/custom/python3';
    expect(getPythonPath()).toBe('/custom/python3');
  });

  it('should return VIRTUAL_ENV python when set', () => {
    process.env.VIRTUAL_ENV = '/home/user/myenv';
    expect(getPythonPath()).toBe(resolve('/home/user/myenv', 'bin', 'python3'));
  });

  it('should prefer ESCRIBANO_PYTHON_PATH over VIRTUAL_ENV', () => {
    process.env.ESCRIBANO_PYTHON_PATH = '/explicit/python3';
    process.env.VIRTUAL_ENV = '/some/venv';
    expect(getPythonPath()).toBe('/explicit/python3');
  });

  it('should return UV_PROJECT_ENVIRONMENT python when set', () => {
    process.env.UV_PROJECT_ENVIRONMENT = '/project/.venv';
    expect(getPythonPath()).toBe(resolve('/project/.venv', 'bin', 'python3'));
  });

  it('should prefer VIRTUAL_ENV over UV_PROJECT_ENVIRONMENT', () => {
    process.env.VIRTUAL_ENV = '/active/venv';
    process.env.UV_PROJECT_ENVIRONMENT = '/project/.venv';
    expect(getPythonPath()).toBe(resolve('/active/venv', 'bin', 'python3'));
  });

  it('should return project-local .venv python when it exists', () => {
    const localVenvPython = resolve(process.cwd(), '.venv', 'bin', 'python3');
    mockExistsSync.mockImplementation((p) => p === localVenvPython);
    expect(getPythonPath()).toBe(localVenvPython);
  });

  it('should return home .venv python when it exists and local .venv does not', () => {
    const homeVenvPython = resolve(homedir(), '.venv', 'bin', 'python3');
    mockExistsSync.mockImplementation((p) => p === homeVenvPython);
    expect(getPythonPath()).toBe(homeVenvPython);
  });

  it('should prefer local .venv over home .venv', () => {
    const localVenvPython = resolve(process.cwd(), '.venv', 'bin', 'python3');
    const homeVenvPython = resolve(homedir(), '.venv', 'bin', 'python3');
    mockExistsSync.mockImplementation(
      (p) => p === localVenvPython || p === homeVenvPython
    );
    expect(getPythonPath()).toBe(localVenvPython);
  });

  it('should fall back to system python3 when nothing else is found', () => {
    mockExistsSync.mockReturnValue(false);
    expect(getPythonPath()).toBe('python3');
  });
});
