/**
 * Escribano - Intelligence Adapter (Ollama)
 *
 * Implements IntelligenceService using Ollama REST API
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type Classification,
  classificationSchema,
  type IntelligenceConfig,
  type IntelligenceService,
  type Transcript,
} from '../0_types.js';

export function createIntelligenceService(
  config: IntelligenceConfig
): IntelligenceService {
  return {
    classify: (transcript) => classifyWithOllama(transcript, config),
    generate: async () => {
      throw new Error('generate() not implemented - Milestone 3');
    },
  };
}

async function checkOllamaHealth(): Promise<void> {
  try {
    const response = await fetch('http://localhost:11434/api/tags');

    if (!response.ok) {
      throw new Error('Ollama API not accessible');
    }

    const data = await response.json();
    console.log('✓ Ollama is running and accessible');
    console.log(`  Available models: ${data.models?.length || 0}`);
  } catch (error) {
    console.error('✗ Ollama is not running or not accessible');
    console.error('  Error:', (error as Error).message);
    console.error('');
    console.error('Please start Ollama:');
    console.error('  brew install ollama');
    console.error('  ollama pull qwen3:32b');
    console.error('  ollama serve');
    console.error('');
    throw new Error('Ollama service required for classification');
  }
}

async function classifyWithOllama(
  transcript: Transcript,
  config: IntelligenceConfig
): Promise<Classification> {
  await checkOllamaHealth();
  const prompt = loadClassifyPrompt(transcript);
  const response = await callOllama(prompt, config);
  const parsed = JSON.parse(response);
  return classificationSchema.parse(parsed);
}

function loadClassifyPrompt(transcript: Transcript): string {
  const promptPath = join(process.cwd(), 'prompts', 'classify.md');
  let prompt = readFileSync(promptPath, 'utf-8');

  const segmentsText = transcript.segments
    .map((seg) => `[seg-${seg.id}] [${seg.start}s - ${seg.end}s] ${seg.text}`)
    .join('\n');

  prompt = prompt.replace('{{TRANSCRIPT_FULL_TEXT}}', transcript.fullText);
  prompt = prompt.replace('{{TRANSCRIPT_SEGMENTS}}', segmentsText);

  return prompt;
}

async function callOllama(
  prompt: string,
  config: IntelligenceConfig
): Promise<string> {
  const { endpoint, model, maxRetries, timeout } = config;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content: prompt,
            },
          ],
          stream: false,
          format: 'json',
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(
          `Ollama API error: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json();
      return data.message.content;
    } catch (error) {
      lastError = error as Error;

      if (error instanceof Error && error.name === 'AbortError') {
        console.log(
          `Attempt ${attempt}/${maxRetries}: Request timed out, retrying...`
        );
      } else {
        console.log(
          `Attempt ${attempt}/${maxRetries}: Request failed, retrying...`
        );
      }

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  throw new Error(
    `Classification failed after ${maxRetries} retries: ${lastError?.message}`
  );
}
