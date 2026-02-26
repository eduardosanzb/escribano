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
    name: 'qwen3:32b model',
    found: false,
    installCommand: 'ollama pull qwen3:32b',
    notes: 'LLM model for summary generation',
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

function checkOllamaModel(model: string): boolean {
  try {
    const output = execSync('ollama list', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    });
    return output.includes(model);
  } catch {
    return false;
  }
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
      case 'qwen3:32b model': {
        result.found = checkOllamaModel('qwen3:32b');
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
