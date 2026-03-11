/**
 * Python Dependency Management for Escribano
 *
 * Centralized source of truth for Python package specifications used by:
 * - MLX adapter (runtime installation in managed venv)
 * - Prerequisites checker (doctor command)
 * - Config system (configurable package specs)
 *
 * This replaces hardcoded package lists scattered across the codebase.
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import {
  ESCRIBANO_HOME,
  ESCRIBANO_VENV,
  ESCRIBANO_VENV_PYTHON,
  getPythonPath,
} from './python-utils.js';

// ============================================================================
// Package Specifications
// ============================================================================

/**
 * Default Python packages required for Escribano.
 * These are split by use case to allow partial installation if needed.
 */
export const PYTHON_PACKAGES = {
  /**
   * Core VLM packages for frame analysis (MLX-VLM based)
   * ~2GB with 4-bit quantization
   */
  vlm: [
    'mlx-vlm>=0.9.0', // Vision-language model
    'mlx>=0.14.0', // MLX inference framework
    'mlx-lm>=0.9.0', // LLM support in MLX (shared with LLM)
  ] as const,

  /**
   * Core LLM packages for text generation (MLX-LM based)
   * Shared mlx-lm with VLM, but listed separately for clarity
   */
  llm: [
    'mlx-lm>=0.9.0', // LLM inference
    'mlx>=0.14.0', // MLX inference framework
  ] as const,

  /**
   * Optional dependencies (deprecated in V3, kept for reference)
   */
  deprecated: {
    embedding: ['sentence-transformers>=2.2.0'] as const,
    clustering: ['scikit-learn>=1.3.0'] as const,
  },
} as const;

/**
 * Get the list of all unique packages needed for the current mode.
 * Deduplicates mlx-lm which is needed by both VLM and LLM.
 */
export function getPythonPackagesToInstall(): string[] {
  const all = new Set<string>();

  // Always need VLM + LLM (both required for Escribano)
  for (const pkg of PYTHON_PACKAGES.vlm) {
    all.add(pkg);
  }
  for (const pkg of PYTHON_PACKAGES.llm) {
    all.add(pkg);
  }

  return Array.from(all);
}

/**
 * Get just the VLM packages (for checking if VLM is available)
 */
export function getVlmPackages(): string[] {
  return Array.from(PYTHON_PACKAGES.vlm);
}

/**
 * Get just the LLM packages (for checking if LLM is available)
 */
export function getLlmPackages(): string[] {
  return Array.from(PYTHON_PACKAGES.llm);
}

// ============================================================================
// Installation
// ============================================================================

export interface InstallOptions {
  pythonPath?: string; // Defaults to getPythonPath()
  packages?: string[]; // Defaults to getPythonPackagesToInstall()
  upgradeExisting?: boolean; // Use --upgrade flag
  verbose?: boolean;
}

/**
 * Install Python packages into the specified environment.
 *
 * Priority for pythonPath:
 * 1. Explicit pythonPath option
 * 2. getPythonPath() result (checks managed venv, active env, etc.)
 * 3. Falls back to 'python3' system command
 */
export function installPythonPackages(options: InstallOptions = {}): {
  success: boolean;
  pythonPath: string;
  output?: string;
  error?: string;
} {
  const pythonPath = options.pythonPath || getPythonPath() || 'python3';
  const packages = options.packages || getPythonPackagesToInstall();
  const upgradeFlag = options.upgradeExisting ? '--upgrade' : '';

  try {
    const cmd =
      `"${pythonPath}" -m pip install ${upgradeFlag} ${packages.join(' ')}`.trim();

    if (options.verbose) {
      console.log(`[Python] Installing: ${cmd}`);
    }

    const output = execSync(cmd, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 300000, // 5 minutes for pip install
    });

    return {
      success: true,
      pythonPath,
      output,
    };
  } catch (error) {
    return {
      success: false,
      pythonPath,
      error: (error as Error).message,
    };
  }
}

// ============================================================================
// Managed Venv Setup (Zero-Config)
// ============================================================================

/**
 * Ensure the managed venv exists and has all required packages installed.
 *
 * This is called on first use of MLX functionality. If the venv doesn't exist,
 * it's created and packages are installed. If it exists but packages are missing,
 * packages are installed into it.
 *
 * Returns the path to python3 in the managed venv.
 */
export function ensureEscribanoVenv(): string {
  const venvExists = existsSync(ESCRIBANO_VENV_PYTHON);
  const packagesReady =
    venvExists && checkCorePackagesInstalled(ESCRIBANO_VENV_PYTHON);

  // Already exists with all required packages?
  if (packagesReady) {
    return ESCRIBANO_VENV_PYTHON;
  }

  // Create venv if it doesn't exist
  if (!venvExists) {
    console.log(
      `[VLM] First-time setup: creating Python environment at ${ESCRIBANO_VENV}`
    );

    try {
      // Create .escribano directory if it doesn't exist
      if (!existsSync(ESCRIBANO_HOME)) {
        mkdirSync(ESCRIBANO_HOME, { recursive: true });
      }

      // Create venv using system python3
      execSync(`python3 -m venv "${ESCRIBANO_VENV}"`, {
        encoding: 'utf-8',
        stdio: 'inherit',
      });
    } catch (error) {
      throw new Error(
        `Failed to create managed venv: ${(error as Error).message}`
      );
    }
  } else {
    console.log(
      `[VLM] Managed venv exists but packages are missing; installing...`
    );
  }

  console.log(
    `[VLM] Installing mlx-vlm into ${ESCRIBANO_VENV} (this may take a few minutes)...`
  );

  // Install packages into the venv
  const result = installPythonPackages({
    pythonPath: ESCRIBANO_VENV_PYTHON,
    verbose: true,
  });

  if (!result.success) {
    throw new Error(`Failed to install packages: ${result.error}`);
  }

  console.log('[VLM] mlx-vlm installed successfully.');
  return ESCRIBANO_VENV_PYTHON;
}

// ============================================================================
// Package Checking
// ============================================================================

/**
 * Check if a specific Python package is installed in the given environment.
 */
export function checkPythonPackageInstalled(
  packageName: string,
  pythonPath?: string
): boolean {
  const python = pythonPath || getPythonPath() || 'python3';

  try {
    execSync(`"${python}" -c "import ${packageName.split(/[>=<]/)[0]}"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if all core packages (VLM + LLM) are installed.
 */
export function checkCorePackagesInstalled(pythonPath?: string): boolean {
  const python = pythonPath || getPythonPath() || 'python3';

  const coreModules = ['mlx_vlm', 'mlx_lm', 'mlx'];
  for (const module of coreModules) {
    if (!checkPythonPackageInstalled(module, python)) {
      return false;
    }
  }

  return true;
}

// ============================================================================
// Pip Command Detection (for prerequisite display)
// ============================================================================

/**
 * Detect the best pip command available on the system.
 * Used by prerequisites checker to show install hints.
 * MLX-only (audio deps are managed separately via uv run).
 */
export function detectPipCommand(): string {
  // Check for uv first (fastest, recommended)
  try {
    execSync('uv --version', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 3000,
    });
    return 'uv pip install mlx-vlm mlx-lm';
  } catch {}

  // Check for pip3
  try {
    execSync('pip3 --version', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 3000,
    });
    return 'pip3 install mlx-vlm mlx-lm';
  } catch {}

  // Check for pip
  try {
    execSync('pip --version', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 3000,
    });
    return 'pip install mlx-vlm mlx-lm';
  } catch {}

  // Fallback: python3 -m pip
  return 'python3 -m pip install mlx-vlm mlx-lm';
}
