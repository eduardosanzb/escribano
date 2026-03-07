/**
 * Shared Python path resolution utilities for Escribano.
 *
 * Used by both the MLX adapter (runtime) and the prerequisites checker (doctor).
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

/** Escribano's managed Python environment — created automatically on first use. */
export const ESCRIBANO_HOME = resolve(homedir(), '.escribano');
export const ESCRIBANO_VENV = resolve(ESCRIBANO_HOME, 'venv');
export const ESCRIBANO_VENV_PYTHON = resolve(ESCRIBANO_VENV, 'bin', 'python3');

/**
 * Check if a path is inside the current working directory (project-local).
 * Used to skip VIRTUAL_ENV/UV_PROJECT_ENVIRONMENT that are dev venvs for
 * the project itself, not suitable as Escribano's Python runtime.
 */
function isInsideCwd(path: string): boolean {
  const absPath = resolve(path);
  const cwd = process.cwd();
  return absPath.startsWith(cwd + '/') || absPath.startsWith(cwd + '\\');
}

/**
 * Get explicitly configured Python path.
 * Returns null when nothing is explicitly configured or found via well-known
 * conventions (active venv, uv project environment, local/home .venv directory).
 * Callers receiving null should fall through to ensureEscribanoVenv() for
 * zero-config auto-setup.
 *
 * Priority:
 * 1. ESCRIBANO_PYTHON_PATH env var (explicit override)
 * 2. ~/.escribano/venv (managed venv, if it exists — preferred once created)
 * 3. Active virtual environment (VIRTUAL_ENV, unless inside CWD)
 * 4. UV_PROJECT_ENVIRONMENT (uv project-synced venv, unless inside CWD)
 * 5. Project-local .venv (created by `uv venv` in CWD)
 * 6. ~/.venv/bin/python3 (home-level venv)
 * 7. null — no environment detected; auto-venv will be created
 */
export function getPythonPath(): string | null {
  // 1. Explicit override always wins
  if (process.env.ESCRIBANO_PYTHON_PATH) {
    return process.env.ESCRIBANO_PYTHON_PATH;
  }

  // 2. Escribano's managed venv — preferred once it exists
  if (existsSync(ESCRIBANO_VENV_PYTHON)) {
    return ESCRIBANO_VENV_PYTHON;
  }

  // 3. Active virtual environment (skip if it's a project-local dev venv)
  if (process.env.VIRTUAL_ENV && !isInsideCwd(process.env.VIRTUAL_ENV)) {
    return resolve(process.env.VIRTUAL_ENV, 'bin', 'python3');
  }

  // 4. UV_PROJECT_ENVIRONMENT (skip if inside CWD)
  if (
    process.env.UV_PROJECT_ENVIRONMENT &&
    !isInsideCwd(process.env.UV_PROJECT_ENVIRONMENT)
  ) {
    return resolve(process.env.UV_PROJECT_ENVIRONMENT, 'bin', 'python3');
  }

  // 5. Project-local .venv (created by `uv venv` in the current working directory)
  const localVenv = resolve(process.cwd(), '.venv', 'bin', 'python3');
  if (existsSync(localVenv)) {
    return localVenv;
  }

  // 6. Home-level venv (e.g., `uv venv ~/.venv`)
  const uvHomeVenv = resolve(homedir(), '.venv', 'bin', 'python3');
  if (existsSync(uvHomeVenv)) {
    return uvHomeVenv;
  }

  return null;
}

/**
 * Get the best Python path for synchronous prerequisite checks (e.g., `escribano doctor`).
 * Checks the managed venv if it already exists. Does NOT create or install anything.
 *
 * Priority: explicit config → managed ~/.escribano/venv (if it exists) → system python3
 */
export function getEffectivePythonPathSync(): string {
  const explicit = getPythonPath();
  if (explicit) return explicit;
  if (existsSync(ESCRIBANO_VENV_PYTHON)) return ESCRIBANO_VENV_PYTHON;
  return 'python3';
}
