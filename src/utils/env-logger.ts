/**
 * Environment Variable Logger
 *
 * Parses .env.example to extract default values and descriptions,
 * then logs all ESCRIBANO_* environment variables with comparisons
 * to their defaults. Only logs when ESCRIBANO_VERBOSE=true.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface EnvVar {
  name: string;
  defaultValue: string;
  description: string;
}

const SECRET_VARS = ['ESCRIBANO_OUTLINE_TOKEN'];

/**
 * Parse .env.example file to extract variable names, defaults, and descriptions.
 * Returns empty array if file not found.
 */
function parseEnvExample(): EnvVar[] {
  const envExamplePath = resolve(process.cwd(), '.env.example');

  let content: string;
  try {
    content = readFileSync(envExamplePath, 'utf-8');
  } catch {
    // File not found or unreadable
    return [];
  }

  const vars: EnvVar[] = [];
  const lines = content.split('\n');
  let currentDescription: string[] = [];

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Skip empty lines - reset description
    if (trimmedLine === '') {
      currentDescription = [];
      continue;
    }

    // Comment line
    if (trimmedLine.startsWith('#')) {
      const commentContent = trimmedLine.slice(1).trim();

      // Skip section headers (pattern: # ===)
      if (commentContent.startsWith('===')) {
        currentDescription = [];
        continue;
      }

      // Skip deprecated section marker
      if (commentContent.toLowerCase().includes('deprecated')) {
        currentDescription = [];
        continue;
      }

      // Accumulate description
      currentDescription.push(commentContent);
      continue;
    }

    // Variable line (contains =)
    if (trimmedLine.includes('=')) {
      const eqIndex = trimmedLine.indexOf('=');
      const name = trimmedLine.slice(0, eqIndex).trim();
      const value = trimmedLine.slice(eqIndex + 1).trim();

      // Skip if name starts with # (deprecated/commented)
      if (name.startsWith('#')) {
        currentDescription = [];
        continue;
      }

      // Only track ESCRIBANO_* variables
      if (name.startsWith('ESCRIBANO_')) {
        vars.push({
          name,
          defaultValue: value,
          description: currentDescription.join(' '),
        });
      }

      currentDescription = [];
    }
  }

  return vars;
}

/**
 * Check if a variable should be masked (secret).
 */
function isSecretVar(name: string): boolean {
  return SECRET_VARS.includes(name);
}

/**
 * Format value for display, masking secrets if needed.
 */
function formatValue(value: string, isSecret: boolean): string {
  if (value === 'not set') {
    return 'not set';
  }

  if (isSecret && value !== 'not set' && value !== '') {
    return '***';
  }

  if (value === '') {
    return '(empty)';
  }

  return value;
}

/**
 * Main logging function. Only runs when ESCRIBANO_VERBOSE=true.
 */
export function logEnvironmentVariables(): void {
  if (process.env.ESCRIBANO_VERBOSE !== 'true') {
    return;
  }

  const envVars = parseEnvExample();

  if (envVars.length === 0) {
    console.log('\n=== Environment Variables ===');
    console.log('  (Could not parse .env.example)\n');
    return;
  }

  // Build list of vars with their current values
  const varsWithValues = envVars.map((varDef) => {
    const currentValue = process.env[varDef.name] ?? 'not set';
    const isCustom =
      currentValue !== varDef.defaultValue && currentValue !== 'not set';

    return {
      ...varDef,
      currentValue,
      isCustom,
      isSecret: isSecretVar(varDef.name),
    };
  });

  // Sort alphabetically by name
  varsWithValues.sort((a, b) => a.name.localeCompare(b.name));

  // Log output
  console.log('\n=== Environment Variables ===\n');

  for (const varDef of varsWithValues) {
    const marker = varDef.isCustom ? ' [CUSTOM]' : '';
    const displayCurrent = formatValue(varDef.currentValue, varDef.isSecret);
    const displayDefault = formatValue(varDef.defaultValue, false);

    console.log(`  ${varDef.name}${marker}`);
    console.log(`    Current: ${displayCurrent}`);
    console.log(`    Default: ${displayDefault}`);

    if (varDef.description) {
      // Wrap description to fit nicely (max ~60 chars per line)
      const wrappedDesc = wrapText(varDef.description, 58);
      for (const line of wrappedDesc) {
        console.log(`    ${line}`);
      }
    }

    console.log('');
  }
}

/**
 * Wrap text to specified width.
 */
function wrapText(text: string, width: number): string[] {
  if (text.length <= width) {
    return [text];
  }

  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (`${currentLine} ${word}`.trim().length <= width) {
      currentLine = currentLine ? `${currentLine} ${word}` : word;
    } else {
      if (currentLine) {
        lines.push(currentLine);
      }
      currentLine = word;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}
