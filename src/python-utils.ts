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
 * Get explicitly configured Python path.
 * Returns null when nothing is explicitly configured or found via well-known
 * conventions (active venv, uv project environment, local/home .venv directory).
 * Callers receiving null should fall through to ensureEscribanoVenv() for
 * zero-config auto-setup.
 *
 * Priority:
 * 1. ESCRIBANO_PYTHON_PATH env var (explicit override)
 * 2. Active virtual environment (VIRTUAL_ENV)
 * 3. UV_PROJECT_ENVIRONMENT (uv project-synced venv)
 * 4. Project-local .venv (created by `uv venv` in CWD)
 * 5. ~/.venv/bin/python3 (home-level venv)
 * 6. null — no environment detected; auto-venv will be created
 */
export function getPythonPath(): string | null {
  if (process.env.ESCRIBANO_PYTHON_PATH) {
    return process.env.ESCRIBANO_PYTHON_PATH;
  }
  if (process.env.VIRTUAL_ENV) {
    return resolve(process.env.VIRTUAL_ENV, 'bin', 'python3');
  }
  // UV_PROJECT_ENVIRONMENT: set by uv when running inside a project with `uv sync`
  if (process.env.UV_PROJECT_ENVIRONMENT) {
    return resolve(process.env.UV_PROJECT_ENVIRONMENT, 'bin', 'python3');
  }
  // Check project-local .venv (created by `uv venv` in the current working directory)
  const localVenv = resolve(process.cwd(), '.venv', 'bin', 'python3');
  if (existsSync(localVenv)) {
    return localVenv;
  }
  // Check common home-level venv (e.g., `uv venv ~/.venv`)
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
