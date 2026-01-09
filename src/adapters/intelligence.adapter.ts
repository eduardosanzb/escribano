/**
 * Escribano - Intelligence Adapter (Ollama)
 *
 * Implements IntelligenceService using Ollama REST API
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  classificationSchema,
  intelligenceConfigSchema,
  transcriptMetadataSchema,
  type ArtifactType,
  type Classification,
  type IntelligenceConfig,
  type IntelligenceService,
  type Transcript,
  type TranscriptMetadata,
  type VisualLog,
} from '../0_types.js';

/**
 * Helper to convert Zod schema to Ollama-compatible JSON schema
 */
function toOllamaSchema(schema: any): object {
  const jsonSchema = z.toJSONSchema(schema) as any;
  const { $schema, ...rest } = jsonSchema;
  return rest;
}

// Model warm state - ensures model is loaded before first real request
const warmedModels = new Set<string>();

export function createIntelligenceService(
  config: Partial<IntelligenceConfig> = {}
): IntelligenceService {
  const parsedConfig = intelligenceConfigSchema.parse(config);
  return {
    classify: (transcript, visualLogs) =>
      classifyWithOllama(transcript, parsedConfig, visualLogs),
    extractMetadata: (transcript, classification, visualLogs) =>
      extractMetadata(transcript, classification, parsedConfig, visualLogs),
    generate: (artifactType, context) =>
      generateArtifact(artifactType, context, parsedConfig),
  };
}

async function ensureModelWarmed(
  modelName: string,
  config: IntelligenceConfig
): Promise<void> {
  if (warmedModels.has(modelName)) return;

  try {
    console.log(`Warming up model: ${modelName}...`);
    const response = await fetch(
      config.endpoint.replace('/chat', '').replace('/generate', '') + '/chat',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelName,
          messages: [],
          keep_alive: config.keepAlive,
        }),
      }
    );

    if (response.ok) {
      warmedModels.add(modelName);
      console.log(`✓ Model ${modelName} loaded and ready.`);
    }
  } catch (error) {
    // In tests, model warming may fail - continue anyway
    // The real request will retry if needed
    console.log(
      `  (Model warmup for ${modelName} skipped or failed, continuing...)`
    );
    warmedModels.add(modelName); // Mark as warmed to avoid repeated attempts
  }
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
    // In tests with mocked fetch, this will fail - just log and continue
    console.log('  (Health check skipped or failed, continuing... )');
  }
}

/**
 * Calculate required context window size for the prompt
 * @param promptLength - Length of the prompt string
 * @param maxContextSize - Maximum context size supported by the model
 * @returns Optimal context size (rounded to next power of 2)
 */
function calculateContextSize(
  promptLength: number,
  maxContextSize: number
): number {
  // Rough estimate: ~4 chars per token for English text
  const estimatedTokens = Math.ceil(promptLength / 4);

  // Add buffer for system prompt + response (at least 1024 tokens)
  const totalNeeded = estimatedTokens + 1024;

  // Round up to next power of 2: 4096 → 8192 → 16384 → 32768 → 65536 → 131072
  const contextSizes = [4096, 8192, 16384, 32768, 65536, 131072];

  for (const size of contextSizes) {
    if (size >= totalNeeded) {
      return Math.min(size, maxContextSize);
    }
  }

  return maxContextSize; // Use max if needed
}

async function classifyWithOllama(
  transcript: Transcript,
  config: IntelligenceConfig,
  visualLogs?: VisualLog[]
): Promise<Classification> {
  console.log('Classifying transcript with Ollama...');
  const tick = setInterval(() => {
    process.stdout.write('.');
  }, 1000);

  await checkOllamaHealth();
  const prompt = loadClassifyPrompt(transcript, visualLogs);
  const raw = await callOllama(prompt, config, {
    expectJson: true,
    jsonSchema: toOllamaSchema(classificationSchema),
    model: config.model,
  });
  clearInterval(tick);
  console.log('\nClassification completed.');

  return raw;
}

function loadClassifyPrompt(
  transcript: Transcript,
  visualLogs?: VisualLog[]
): string {
  const promptPath = join(process.cwd(), 'prompts', 'classify.md');
  let prompt = readFileSync(promptPath, 'utf-8');

  const segmentsText = transcript.segments
    .map((seg) => `[seg-${seg.id}] [${seg.start}s - ${seg.end}s] ${seg.text}`)
    .join('\n');

  prompt = prompt.replace('{{TRANSCRIPT_ALL}}', transcript.fullText);
  prompt = prompt.replace('{{TRANSCRIPT_SEGMENTS}}', segmentsText);

  if (visualLogs && visualLogs.length > 0) {
    const visualSummary = visualLogs[0].entries
      .map((e: any) => `[Visual Change] at ${e.timestamp}s`)
      .join('\n');
    prompt = prompt.replace('{{VISUAL_LOG}}', visualSummary);
  } else {
    prompt = prompt.replace('{{VISUAL_LOG}}', 'N/A');
  }

  return prompt;
}

async function callOllama(
  prompt: string,
  config: IntelligenceConfig,
  options: {
    expectJson: boolean;
    jsonSchema?: object;
    model: string;
  }
): Promise<string | any> {
  // Model warm-up (errors handled gracefully, especially in tests)
  try {
    await ensureModelWarmed(options.model, config);
  } catch {
    // Continue even if warmup fails - model will load on first request
  }

  const { endpoint, maxRetries, timeout, keepAlive, maxContextSize } = config;

  // Calculate optimal context size for this prompt
  const contextSize = calculateContextSize(prompt.length, maxContextSize);

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
          model: options.model,
          messages: [
            {
              role: 'system',
              content: options.expectJson
                ? 'You are a JSON-only output system. Output ONLY valid JSON, no other text.'
                : 'You are a helpful assistant that generates high-quality markdown documentation.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          stream: false,
          keep_alive: keepAlive,
          options: {
            num_ctx: contextSize,
          },
          ...(options.expectJson && {
            format: options.jsonSchema ?? 'json',
          }),
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
      if (!data.done || data.done_reason !== 'stop') {
        throw new Error(
          `Incomplete response: done=${data.done}, reason=${data.done_reason}`
        );
      }

      if (options.expectJson) {
        return JSON.parse(data.message.content);
      }

      return data.message.content as string;
    } catch (error: any) {
      lastError = error as Error;

      if (error instanceof Error && error.name === 'AbortError') {
        console.log(
          `Attempt ${attempt}/${maxRetries}: Request timed out, retrying...`
        );
      } else {
        console.log(
          `Attempt ${attempt}/${maxRetries}: Request failed, retrying...`
        );
        console.log('  Error:', lastError.message);
      }

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  throw new Error(
    `Request failed after ${maxRetries} retries: ${lastError?.message}`
  );
}

async function extractMetadata(
  transcript: Transcript,
  classification: Classification,
  config: IntelligenceConfig,
  visualLogs?: VisualLog[]
): Promise<TranscriptMetadata> {
  const prompt = loadMetadataPrompt(transcript, classification, visualLogs);
  const raw = await callOllama(prompt, config, {
    expectJson: true,
    jsonSchema: toOllamaSchema(transcriptMetadataSchema),
    model: config.generationModel, // Metadata extraction benefits from larger model
  });

  return raw;
}

function loadMetadataPrompt(
  transcript: Transcript,
  classification: Classification,
  visualLogs?: VisualLog[]
): string {
  const promptPath = join(process.cwd(), 'prompts', 'extract-metadata.md');
  let prompt = readFileSync(promptPath, 'utf-8');

  const classificationSummary = Object.entries(classification)
    .filter(([_, score]) => (score as number) >= 25)
    .map(([type, score]) => `${type}: ${score}%`)
    .join(', ');

  const segmentsText = transcript.segments
    .map((seg) => `[${seg.start}s - ${seg.end}s] ${seg.text}`)
    .join('\n');

  prompt = prompt.replace('{{CLASSIFICATION_SUMMARY}}', classificationSummary);
  prompt = prompt.replace('{{TRANSCRIPT_SEGMENTS}}', segmentsText);
  prompt = prompt.replace('{{TRANSCRIPT_ALL}}', transcript.fullText);

  if (visualLogs && visualLogs.length > 0) {
    const visualSummary = visualLogs[0].entries
      .map((e: any) => `[Visual Change] at ${e.timestamp}s`)
      .join('\n');
    prompt = prompt.replace('{{VISUAL_LOG}}', visualSummary);
  } else {
    prompt = prompt.replace('{{VISUAL_LOG}}', 'N/A');
  }

  return prompt;
}

async function generateArtifact(
  artifactType: ArtifactType,
  context: {
    transcript: Transcript;
    classification: Classification;
    metadata: TranscriptMetadata | null;
    visualLogs?: VisualLog[];
  },
  config: IntelligenceConfig
): Promise<string> {
  const prompt = loadArtifactPrompt(artifactType, context);
  const response = await callOllama(prompt, config, {
    expectJson: false,
    model: config.generationModel,
  });
  return response;
}

function loadArtifactPrompt(
  artifactType: ArtifactType,
  context: {
    transcript: Transcript;
    classification: Classification;
    metadata: TranscriptMetadata | null;
    visualLogs?: VisualLog[];
  }
): string {
  const promptPath = join(process.cwd(), 'prompts', `${artifactType}.md`);
  let prompt = readFileSync(promptPath, 'utf-8');

  prompt = prompt.replace('{{TRANSCRIPT_ALL}}', context.transcript.fullText);
  prompt = prompt.replace('{{LANGUAGE}}', context.transcript.language || 'en');

  const segmentsText = context.transcript.segments
    .map((seg) => `[${seg.start}s - ${seg.end}s] ${seg.text}`)
    .join('\n');
  prompt = prompt.replace('{{TRANSCRIPT_SEGMENTS}}', segmentsText);

  const classificationSummary = Object.entries(context.classification)
    .filter(([_, score]) => score >= 25)
    .map(([type, score]) => `${type}: ${score}%`)
    .join(', ');
  prompt = prompt.replace('{{CLASSIFICATION_SUMMARY}}', classificationSummary);

  if (context.visualLogs && context.visualLogs.length > 0) {
    const visualSummary = context.visualLogs[0].entries
      .map(
        (e: any, i: number) =>
          `[Scene ${i}] at ${e.timestamp}s: ${e.description || 'Action on screen'}`
      )
      .join('\n');
    prompt = prompt.replace('{{VISUAL_LOG}}', visualSummary);
  } else {
    prompt = prompt.replace('{{VISUAL_LOG}}', 'N/A');
  }

  if (context.metadata) {
    prompt = prompt.replace(
      '{{METADATA}}',
      JSON.stringify(context.metadata, null, 2)
    );
    prompt = prompt.replace(
      '{{SPEAKERS}}',
      JSON.stringify(context.metadata.speakers || [], null, 2)
    );
    prompt = prompt.replace(
      '{{KEY_MOMENTS}}',
      JSON.stringify(context.metadata.keyMoments || [], null, 2)
    );
    prompt = prompt.replace(
      '{{ACTION_ITEMS}}',
      JSON.stringify(context.metadata.actionItems || [], null, 2)
    );
    prompt = prompt.replace(
      '{{TECHNICAL_TERMS}}',
      JSON.stringify(context.metadata.technicalTerms || [], null, 2)
    );
    prompt = prompt.replace(
      '{{CODE_SNIPPETS}}',
      JSON.stringify(context.metadata.codeSnippets || [], null, 2)
    );
  } else {
    prompt = prompt.replace('{{METADATA}}', 'N/A');
    prompt = prompt.replace('{{SPEAKERS}}', 'N/A');
    prompt = prompt.replace('{{KEY_MOMENTS}}', 'N/A');
    prompt = prompt.replace('{{ACTION_ITEMS}}', 'N/A');
    prompt = prompt.replace('{{TECHNICAL_TERMS}}', 'N/A');
    prompt = prompt.replace('{{CODE_SNIPPETS}}', 'N/A');
  }

  return prompt;
}
