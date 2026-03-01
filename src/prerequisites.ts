/**
 * Prerequisite Checker for Escribano CLI
 *
 * Checks for required dependencies and provides install instructions
 */

import { execSync } from 'node:child_process';

export interface PrerequisiteResult {
  name: string;
  found: boolean;
  version?: string;
  installCommand?: string;
  notes?: string;
}

const LLM_MODEL_TIERS = [
  { model: 'qwen3.5:27b', tier: 4, minRamGB: 32, label: 'best' },
  { model: 'qwen3:14b', tier: 3, minRamGB: 20, label: 'very good' },
  { model: 'qwen3:8b', tier: 2, minRamGB: 10, label: 'good' },
  { model: 'qwen3:4b', tier: 1, minRamGB: 6, label: 'minimum' },
] as const;

const PREREQUISITES: PrerequisiteResult[] = [
  {
    name: 'Node.js',
    found: false,
    installCommand: 'brew install node',
    notes: 'Requires Node.js 20+',
  },
  {
    name: 'ffmpeg',
    found: false,
    installCommand: 'brew install ffmpeg',
    notes: 'Required for video processing and scene detection',
  },
  {
    name: 'whisper-cli',
    found: false,
    installCommand: 'brew install whisper-cpp',
    notes: 'Required for audio transcription',
  },
  {
    name: 'ollama',
    found: false,
    installCommand: 'brew install ollama',
    notes: 'Required for LLM summary generation',
  },
  {
    name: 'ollama (running)',
    found: false,
    installCommand: 'ollama serve',
    notes: 'Ollama server must be running',
  },
  {
    name: 'LLM model',
    found: false,
    installCommand: 'ollama pull qwen3:8b',
    notes: 'Any of: qwen3.5:27b, qwen3:14b, qwen3:8b, qwen3:4b',
  },
  {
    name: 'Python 3',
    found: false,
    installCommand: 'brew install python3',
    notes: 'Required for MLX-VLM frame analysis',
  },
  {
    name: 'mlx-vlm',
    found: false,
    installCommand: 'pip install mlx-vlm',
    notes: 'VLM library for frame analysis (Apple Silicon)',
  },
];

function checkCommand(
  command: string,
  args: string[] = ['--version']
): { found: boolean; version?: string } {
  try {
    const output = execSync(`${command} ${args.join(' ')}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    });
    const version = output.split('\n')[0].trim().slice(0, 50);
    return { found: true, version };
  } catch {
    return { found: false };
  }
}

function checkOllamaRunning(): boolean {
  try {
    execSync('curl -s http://localhost:11434/api/tags', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

function getInstalledOllamaModels(): string[] {
  try {
    const output = execSync('ollama list', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    });
    const lines = output.split('\n').slice(1);
    return lines
      .map((line) => line.split(/\s+/)[0])
      .filter((m) => m && m.length > 0);
  } catch {
    return [];
  }
}

function checkLLMModels(): {
  found: boolean;
  foundModels: string[];
  bestAvailable: string | null;
  installCommand: string;
} {
  const installed = getInstalledOllamaModels();
  const foundModels: string[] = [];
  let bestAvailable: string | null = null;
  let bestTier = 0;

  for (const tier of LLM_MODEL_TIERS) {
    const found = installed.some((m) => m.startsWith(tier.model.split(':')[0]));
    if (found) {
      foundModels.push(tier.model);
      if (tier.tier > bestTier) {
        bestTier = tier.tier;
        bestAvailable = tier.model;
      }
    }
  }

  return {
    found: foundModels.length > 0,
    foundModels,
    bestAvailable,
    installCommand: 'ollama pull qwen3:8b',
  };
}

function checkPythonPackage(packageName: string): boolean {
  try {
    execSync(`python3 -c "import ${packageName}"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

export function checkPrerequisites(): PrerequisiteResult[] {
  const results: PrerequisiteResult[] = [];

  for (const prereq of PREREQUISITES) {
    const result = { ...prereq };

    switch (prereq.name) {
      case 'Node.js': {
        const check = checkCommand('node', ['--version']);
        result.found = check.found;
        result.version = check.version;
        break;
      }
      case 'ffmpeg': {
        const check = checkCommand('ffmpeg', ['-version']);
        result.found = check.found;
        result.version = check.version?.split(' ')[2];
        break;
      }
      case 'whisper-cli': {
        const check = checkCommand('whisper-cli', ['--version']);
        result.found = check.found;
        result.version = check.version;
        break;
      }
      case 'ollama': {
        const check = checkCommand('ollama', ['--version']);
        result.found = check.found;
        result.version = check.version;
        break;
      }
      case 'ollama (running)': {
        result.found = checkOllamaRunning();
        break;
      }
      case 'LLM model': {
        const check = checkLLMModels();
        result.found = check.found;
        if (check.bestAvailable) {
          result.version = check.bestAvailable;
          result.notes = `Found: ${check.foundModels.join(', ')}`;
        }
        break;
      }
      case 'Python 3': {
        const check = checkCommand('python3', ['--version']);
        result.found = check.found;
        result.version = check.version;
        break;
      }
      case 'mlx-vlm': {
        result.found = checkPythonPackage('mlx_vlm');
        break;
      }
    }

    results.push(result);
  }

  return results;
}

export function printDoctorResults(results: PrerequisiteResult[]): void {
  console.log('Checking prerequisites...\n');

  const missing: PrerequisiteResult[] = [];

  for (const result of results) {
    const icon = result.found ? '✓' : '✗';
    const version = result.version ? ` (${result.version})` : '';
    console.log(`${icon} ${result.name}${version}`);

    if (!result.found) {
      missing.push(result);
      if (result.installCommand) {
        console.log(`  → Install: ${result.installCommand}`);
      }
    } else if (result.notes) {
      console.log(`  ${result.notes}`);
    }
  }

  console.log('');

  if (missing.length === 0) {
    console.log('✓ All prerequisites satisfied. Ready to process recordings.');
  } else {
    console.log(
      `Missing ${missing.length} prerequisite${missing.length > 1 ? 's' : ''}.`
    );
    console.log('Run the install commands above and try again.');
  }
}

export function hasMissingPrerequisites(
  results: PrerequisiteResult[]
): boolean {
  return results.some((r) => !r.found);
}
