/**
 * MLX Intelligence Adapter Tests
 *
 * Tests for Python path detection and auto-venv setup logic used to locate
 * (or create) the correct Python interpreter with mlx-vlm installed.
 */

import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock node:fs so we can control which paths "exist"
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

// Mock node:child_process so we don't actually spawn anything
vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({
    on: vi.fn(),
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    kill: vi.fn(),
  })),
}));

import { existsSync } from 'node:fs';
import { resolvePythonPath } from '../adapters/intelligence.mlx.adapter.js';
import { getPythonPath } from '../python-utils.js';

const mockExistsSync = vi.mocked(existsSync);

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

  it('returns project-local .venv python when it exists', () => {
    const localVenvPython = resolve(process.cwd(), '.venv', 'bin', 'python3');
    mockExistsSync.mockImplementation((p) => p === localVenvPython);
    expect(getPythonPath()).toBe(localVenvPython);
  });

  it('returns home .venv python when it exists and local .venv does not', () => {
    const homeVenvPython = resolve(homedir(), '.venv', 'bin', 'python3');
    mockExistsSync.mockImplementation((p) => p === homeVenvPython);
    expect(getPythonPath()).toBe(homeVenvPython);
  });

  it('prefers local .venv over home .venv', () => {
    const localVenvPython = resolve(process.cwd(), '.venv', 'bin', 'python3');
    const homeVenvPython = resolve(homedir(), '.venv', 'bin', 'python3');
    mockExistsSync.mockImplementation(
      (p) => p === localVenvPython || p === homeVenvPython
    );
    expect(getPythonPath()).toBe(localVenvPython);
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
  });

  afterEach(() => {
    for (const key of MANAGED_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
    vi.restoreAllMocks();
  });

  it('returns the explicit path immediately when ESCRIBANO_PYTHON_PATH is set', async () => {
    process.env.ESCRIBANO_PYTHON_PATH = '/my/python3';
    await expect(resolvePythonPath()).resolves.toBe('/my/python3');
  });

  it('returns the explicit path immediately when VIRTUAL_ENV is set', async () => {
    process.env.VIRTUAL_ENV = '/my/venv';
    await expect(resolvePythonPath()).resolves.toBe(
      resolve('/my/venv', 'bin', 'python3')
    );
  });

  it('falls through to managed venv python when nothing is configured', async () => {
    // Simulate: no explicit config, venv already exists, mlx-vlm already installed
    const venvPython = resolve(
      homedir(),
      '.escribano',
      'venv',
      'bin',
      'python3'
    );
    mockExistsSync.mockImplementation((p) => p === venvPython);

    // Mock spawn so the mlx-vlm probe exits with 0 (already installed)
    const { spawn } = await import('node:child_process');
    const mockSpawn = vi.mocked(spawn);
    mockSpawn.mockImplementation((_cmd, _args, _opts) => {
      const emitter = {
        on: vi.fn((event: string, cb: (code: number) => void) => {
          if (event === 'exit') cb(0);
          return emitter;
        }),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        kill: vi.fn(),
      };
      return emitter as never;
    });

    await expect(resolvePythonPath()).resolves.toBe(venvPython);
  });

  it('creates the managed venv when it does not exist', async () => {
    // beforeEach has mockExistsSync default to false, simulating a missing venv
    const venvDir = resolve(homedir(), '.escribano', 'venv');

    const { spawn } = await import('node:child_process');
    const mockSpawn = vi.mocked(spawn);
    mockSpawn.mockClear();

    // Set up spawn to call exit(0) for all calls so the async function resolves.
    mockSpawn.mockImplementation((_cmd, _args, _opts) => {
      const emitter = {
        on: vi.fn((event: string, cb: (code: number) => void) => {
          if (event === 'exit') cb(0);
          return emitter;
        }),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        kill: vi.fn(),
      };
      return emitter as never;
    });

    await resolvePythonPath();

    // Expect that we attempted to create a virtual environment in the managed directory
    expect(mockSpawn).toHaveBeenCalled();

    // Find the venv-creation call: command is python3 with -m venv <dir>
    const venvCall = mockSpawn.mock.calls.find(
      ([cmd, args]) =>
        typeof cmd === 'string' &&
        (cmd === 'python3' || cmd === 'python') &&
        Array.isArray(args) &&
        args.includes('-m') &&
        args.includes('venv')
    );
    expect(venvCall).toBeDefined();
    expect(venvCall?.[1]).toContain(venvDir);
  });

  it('installs mlx-vlm when the import probe fails', async () => {
    const venvPython = resolve(
      homedir(),
      '.escribano',
      'venv',
      'bin',
      'python3'
    );
    // Simulate: managed venv python exists
    mockExistsSync.mockImplementation((p) => p === venvPython);

    const { spawn } = await import('node:child_process');
    const mockSpawn = vi.mocked(spawn);
    mockSpawn.mockClear();

    let callIndex = 0;
    mockSpawn.mockImplementation((_cmd, _args, _opts) => {
      const thisCall = callIndex++;
      const emitter = {
        on: vi.fn((event: string, cb: (code: number) => void) => {
          if (event === 'exit') {
            // First call: import probe fails (non-zero exit)
            // All subsequent calls (ensurepip, pip install, ...): succeed
            cb(thisCall === 0 ? 1 : 0);
          }
          return emitter;
        }),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        kill: vi.fn(),
      };
      return emitter as never;
    });

    await expect(resolvePythonPath()).resolves.toBe(venvPython);

    expect(mockSpawn.mock.calls.length).toBeGreaterThanOrEqual(2);

    // Find the pip install call regardless of its position (robust to ensurepip being inserted)
    const installCall = mockSpawn.mock.calls.find(
      ([_cmd, args]) =>
        Array.isArray(args) &&
        args.includes('-m') &&
        args.includes('pip') &&
        args.includes('install') &&
        args.includes('mlx-vlm')
    );
    expect(installCall).toBeDefined();
    expect(installCall?.[1]).toEqual(
      expect.arrayContaining([
        '-m',
        'pip',
        'install',
        'mlx-vlm',
        'torch',
        'torchvision',
        'mlx-lm',
      ])
    );
  });
});
