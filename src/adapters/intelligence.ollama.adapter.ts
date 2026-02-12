/**
 * Escribano - Intelligence Adapter (Ollama)
 *
 * Implements IntelligenceService using Ollama REST API
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  type ArtifactType,
  type Classification,
  classificationSchema,
  type DbObservation,
  type IntelligenceConfig,
  type IntelligenceService,
  intelligenceConfigSchema,
  type SessionSegment,
  type Transcript,
  type TranscriptMetadata,
  transcriptMetadataSchema,
  type VisualDescription,
  type VisualDescriptions,
  type VisualLog,
} from '../0_types.js';

// Debug logging controlled by environment variable
const DEBUG_OLLAMA = process.env.ESCRIBANO_DEBUG_OLLAMA === 'true';

// TODO: put in an util
export function debugLog(...args: unknown[]): void {
  if (DEBUG_OLLAMA) {
    console.log('[Ollama]', ...args);
  }
}

/**
 * Helper to convert Zod schema to Ollama-compatible JSON schema
 */
function toOllamaSchema(schema: z.ZodType): object {
  // biome-ignore lint/suspicious/noExplicitAny: needed for Zod schema conversion
  const jsonSchema = (z as any).toJSONSchema(schema);
  const { $schema, ...rest } = jsonSchema;
  return rest;
}

// Model warm state - ensures model is loaded before first real request
const warmedModels = new Set<string>();
// Warmup lock - prevents parallel warmup race condition
const warmupInProgress = new Map<string, Promise<void>>();

export function createOllamaIntelligenceService(
  config: Partial<IntelligenceConfig> = {}
): IntelligenceService {
  const parsedConfig = intelligenceConfigSchema.parse(config);
  return {
    classify: (transcript, visualLogs) =>
      classifyWithOllama(transcript, parsedConfig, visualLogs),
    classifySegment: (segment, transcript) =>
      classifySegmentWithOllama(segment, parsedConfig, transcript),
    extractMetadata: (transcript, classification, visualLogs) =>
      extractMetadata(transcript, classification, parsedConfig, visualLogs),
    generate: (artifactType, context) =>
      generateArtifact(artifactType, context, parsedConfig),
    describeImages: (images, prompt) =>
      describeImagesWithOllama(images, parsedConfig, prompt),
    describeImageBatch: (images, options) =>
      describeImageBatchWithOllama(images, parsedConfig, options),
    embedText: (texts, options) =>
      embedTextWithOllama(texts, parsedConfig, options),
    extractTopics: (observations) =>
      extractTopicsWithOllama(observations, parsedConfig),
    generateText: (prompt, options) =>
      generateTextWithOllama(prompt, parsedConfig, options),
  };
}

async function embedTextWithOllama(
  texts: string[],
  config: IntelligenceConfig,
  options: { batchSize?: number } = {}
): Promise<number[][]> {
  const batchSize = options.batchSize ?? 10;
  const model = process.env.ESCRIBANO_EMBED_MODEL || 'nomic-embed-text';
  const endpoint = `${config.endpoint.replace('/chat', '').replace('/generate', '')}/embeddings`;

  const embeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);

    for (const text of batch) {
      if (!text || text.trim().length === 0) {
        embeddings.push([]); // Empty embedding for empty text
        continue;
      }

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, prompt: text }),
        });

        if (!response.ok) {
          console.warn(
            `Embedding failed for text: ${text.substring(0, 50)}...`
          );
          embeddings.push([]);
          continue;
        }

        const data = await response.json();
        embeddings.push(data.embedding || []);
      } catch (error) {
        console.warn(`Embedding request failed: ${(error as Error).message}`);
        embeddings.push([]);
      }
    }
  }

  return embeddings;
}

async function ensureModelWarmed(
  modelName: string,
  config: IntelligenceConfig
): Promise<void> {
  // Already warmed - fast path
  if (warmedModels.has(modelName)) {
    debugLog(`Model ${modelName} already warm`);
    return;
  }

  // Warmup already in progress - wait for it (prevents race condition)
  const existingWarmup = warmupInProgress.get(modelName);
  if (existingWarmup) {
    debugLog(`Waiting for existing warmup of ${modelName}...`);
    return existingWarmup;
  }

  // Start warmup and store the promise
  const warmupPromise = doModelWarmup(modelName, config);
  warmupInProgress.set(modelName, warmupPromise);

  try {
    await warmupPromise;
  } finally {
    warmupInProgress.delete(modelName);
  }
}

async function doModelWarmup(
  modelName: string,
  config: IntelligenceConfig
): Promise<void> {
  try {
    console.log(`Warming up model: ${modelName}...`);
    const response = await fetch(
      `${config.endpoint.replace('/chat', '').replace('/generate', '')}/chat`,
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
  } catch (_error) {
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
  } catch (_error) {
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

async function classifySegmentWithOllama(
  segment: SessionSegment,
  config: IntelligenceConfig,
  transcript?: Transcript
): Promise<Classification> {
  await checkOllamaHealth();
  const prompt = loadClassifySegmentPrompt(segment, transcript);
  const raw = await callOllama(prompt, config, {
    expectJson: true,
    jsonSchema: toOllamaSchema(classificationSchema),
    model: config.model,
  });
  return raw;
}

function loadClassifySegmentPrompt(
  segment: SessionSegment,
  transcript?: Transcript
): string {
  const promptPath = join(process.cwd(), 'prompts', 'classify-segment.md');
  let prompt = readFileSync(promptPath, 'utf-8');

  const timeRangeStr = `[${segment.timeRange[0]}s - ${segment.timeRange[1]}s]`;
  const ocrContext =
    segment.contexts.map((c) => `${c.type}: ${c.value}`).join(', ') || 'None';

  const transcriptText =
    transcript?.fullText ||
    segment.transcriptSlice?.transcript.fullText ||
    'N/A';

  prompt = prompt.replace('{{TIME_RANGE}}', timeRangeStr);
  prompt = prompt.replace(
    '{{VISUAL_CONTEXT}}',
    segment.visualClusterIds.length > 0 ? 'Multiple visual clusters' : 'N/A'
  );
  prompt = prompt.replace('{{OCR_CONTEXT}}', ocrContext);
  prompt = prompt.replace('{{TRANSCRIPT_CONTENT}}', transcriptText);
  prompt = prompt.replace('{{VLM_DESCRIPTION}}', 'N/A'); // Placeholder for future integration

  return prompt;
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

  // TODO: Implement robust transcript cleaning (Milestone 4)
  prompt = prompt.replace('{{TRANSCRIPT_ALL}}', transcript.fullText);
  prompt = prompt.replace('{{TRANSCRIPT_SEGMENTS}}', segmentsText);

  if (visualLogs && visualLogs.length > 0) {
    const visualSummary = visualLogs[0].entries
      .map((e, _i) => {
        const timestamp = `[${e.timestamp}s]`;
        const label = e.heuristicLabel ? `[${e.heuristicLabel}]` : '';
        const description = e.description ? `: ${e.description}` : '';
        const ocr = e.ocrSummary
          ? ` (OCR: ${e.ocrSummary.substring(0, 100)})`
          : '';
        return `${timestamp} ${label}${description}${ocr}`;
      })
      .join('\n');
    prompt = prompt.replace('{{VISUAL_LOG}}', visualSummary);
  } else {
    prompt = prompt.replace('{{VISUAL_LOG}}', 'N/A');
  }

  return prompt;
}

/**
 * Describe multiple images in a single VLM request.
 * Uses Ollama's multi-image chat API for efficiency.
 */
async function describeImageBatchWithOllama(
  images: Array<{ imagePath: string; timestamp: number }>,
  config: IntelligenceConfig,
  options: {
    batchSize?: number;
    model?: string;
    onBatchComplete?: (
      results: Array<{
        index: number;
        timestamp: number;
        activity: string;
        description: string;
        apps: string[];
        topics: string[];
      }>,
      batchIndex: number
    ) => void;
  } = {}
): Promise<
  Array<{
    index: number;
    timestamp: number;
    activity: string;
    description: string;
    apps: string[];
    topics: string[];
  }>
> {
  const batchSize = options.batchSize ?? 8;
  const model =
    options.model ?? process.env.ESCRIBANO_VLM_MODEL ?? 'qwen3-vl:4b';
  const endpoint = `${config.endpoint.replace('/generate', '').replace('/chat', '')}/chat`;

  const allResults: Array<{
    index: number;
    timestamp: number;
    activity: string;
    description: string;
    apps: string[];
    topics: string[];
  }> = [];

  // Process in batches
  for (
    let batchStart = 0;
    batchStart < images.length;
    batchStart += batchSize
  ) {
    const batch = images.slice(batchStart, batchStart + batchSize);
    const batchIndex = Math.floor(batchStart / batchSize) + 1;
    const totalBatches = Math.ceil(images.length / batchSize);

    console.log(
      `[VLM] Processing batch ${batchIndex}/${totalBatches} (${batch.length} images)...`
    );
    const batchStartTime = Date.now();

    // Read and encode images as base64
    const base64Images: string[] = [];
    for (const img of batch) {
      try {
        const buffer = readFileSync(img.imagePath);
        base64Images.push(buffer.toString('base64'));
      } catch (error) {
        console.warn(
          `Failed to read image ${img.imagePath}: ${(error as Error).message}`
        );
        base64Images.push(''); // Empty placeholder
      }
    }

    // Build prompt
    const prompt = `You are analyzing ${batch.length} screenshots from a developer's screen recording.

For each image (indexed 0 to ${batch.length - 1}), provide:
1. A brief 1-2 sentence description of what's shown
2. The primary activity (suggest a concise label like "debugging", "coding", "reading docs", "meeting", "browsing")
3. Visible applications (e.g., "VS Code", "Chrome", "Terminal", "Slack")
4. Any key topics or projects visible (e.g., "authentication", "API design", "escribano")

IMPORTANT: Return ONLY valid JSON array, no markdown, no explanation.
Format:
[
  {"index": 0, "description": "...", "activity": "...", "apps": ["..."], "topics": ["..."]},
  {"index": 1, "description": "...", "activity": "...", "apps": ["..."], "topics": ["..."]}
]`;

    try {
      // Ensure model is loaded
      await ensureModelWarmed(model, config);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'user',
              content: prompt,
              images: base64Images.filter((img) => img.length > 0),
            },
          ],
          format: 'json',
          stream: false,
          options: {
            num_predict: 6000,
            temperature: 0.3,
          },
          think: false,
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Ollama API error: ${response.status} ${response.statusText}`
        );
      }

      console.log(response);

      const data = await response.json();
      console.log(data);
      const content = data.message?.content || '';

      // Parse JSON response
      let parsed: any;

      try {
        // Try to extract JSON from response (handle markdown code blocks)
        let jsonStr = content.trim();
        if (jsonStr.startsWith('```')) {
          jsonStr = jsonStr
            .replace(/^```(?:json)?\n?/, '')
            .replace(/\n?```$/, '');
        }
        parsed = JSON.parse(jsonStr);

        // Handle object wrappers vs direct array
        if (!Array.isArray(parsed)) {
          console.log(
            `[VLM] Batch ${batchIndex} response is an object, attempting to extract array...`
          );
          // Try common wrapper keys or just take the first array property found
          parsed =
            parsed.results ||
            parsed.frames ||
            parsed.images ||
            parsed.data ||
            Object.values(parsed).find((v) => Array.isArray(v));

          if (!Array.isArray(parsed)) {
            throw new Error('VLM response is not an array');
          }
        }
      } catch (_parseError) {
        console.warn(
          `Failed to parse VLM response for batch ${batchIndex}:`,
          content.substring(0, 200)
        );
        // Create fallback entries
        parsed = batch.map((_, i) => ({
          index: i,
          description: 'Failed to parse VLM response',
          activity: 'unknown',
          apps: [],
          topics: [],
        }));
      }

      // Map results back to global indices with timestamps
      const batchResults: Array<{
        index: number;
        timestamp: number;
        activity: string;
        description: string;
        apps: string[];
        topics: string[];
      }> = [];

      for (let i = 0; i < batch.length; i++) {
        const globalIndex = batchStart + i;
        const parsedItem = parsed.find((p: any) => p.index === i) || {
          index: i,
          description: 'No description',
          activity: 'unknown',
          apps: [],
          topics: [],
        };

        const result = {
          index: globalIndex,
          timestamp: batch[i].timestamp,
          activity: parsedItem.activity || 'unknown',
          description: parsedItem.description || '',
          apps: parsedItem.apps || [],
          topics: parsedItem.topics || [],
        };

        batchResults.push(result);
        allResults.push(result);
      }

      // Report progress per batch for eager saving
      if (options.onBatchComplete) {
        options.onBatchComplete(batchResults, batchIndex);
      }

      const batchDuration = ((Date.now() - batchStartTime) / 1000).toFixed(1);
      console.log(
        `[VLM] Batch ${batchIndex}/${totalBatches} complete in ${batchDuration}s`
      );
    } catch (error) {
      console.error(
        `[VLM] Batch ${batchIndex} failed:`,
        (error as Error).message
      );
      // Add fallback entries for failed batch
      for (let i = 0; i < batch.length; i++) {
        allResults.push({
          index: batchStart + i,
          timestamp: batch[i].timestamp,
          activity: 'error',
          description: `VLM processing failed: ${(error as Error).message}`,
          apps: [],
          topics: [],
        });
      }
    }
  }

  return allResults;
}

async function extractTopicsWithOllama(
  observations: DbObservation[],
  config: IntelligenceConfig
): Promise<string[]> {
  const textSamples = observations
    .slice(0, 20)
    .map((o) => {
      if (o.type === 'visual') {
        return o.vlm_description || o.ocr_text?.slice(0, 200) || '';
      }
      return o.text?.slice(0, 500) || '';
    })
    .filter((t) => t.length > 10);

  if (textSamples.length === 0) return [];

  const prompt = `Analyze these observations from a screen recording session and generate 1-3 descriptive topic labels.

Observations:
${textSamples.join('\n---\n')}

Output ONLY a JSON object with this format:
{"topics": ["specific topic 1", "specific topic 2"]}

Rules:
- Be specific: "debugging TypeScript errors" not just "debugging"
- Be descriptive: "learning React hooks" not just "learning"
- Focus on what the user is DOING, not just what's visible
- Max 3 topics`;

  try {
    const result = await callOllama(prompt, config, {
      expectJson: true,
      model: config.model,
    });

    return result.topics || [];
  } catch (error) {
    console.warn('Topic extraction failed:', error);
    return [];
  }
}

async function generateTextWithOllama(
  prompt: string,
  config: IntelligenceConfig,
  options?: { model?: string; expectJson?: boolean }
): Promise<string> {
  const model = options?.model || config.generationModel || config.model;
  const expectJson = options?.expectJson ?? false;

  try {
    const result = await callOllama(prompt, config, {
      expectJson,
      model,
    });

    // If expectJson, result might be an object - stringify it
    if (expectJson && typeof result === 'object') {
      return JSON.stringify(result, null, 2);
    }

    // Otherwise return as string
    return String(result);
  } catch (error) {
    console.error('Text generation failed:', (error as Error).message);
    throw error;
  }
}

async function callOllama(
  prompt: string,
  config: IntelligenceConfig,
  options: {
    expectJson: boolean;
    jsonSchema?: object;
    model: string;
  }
  // biome-ignore lint/suspicious/noExplicitAny: Ollama returns dynamic JSON or strings
): Promise<any> {
  const requestId = Math.random().toString(36).substring(2, 8);
  const requestStart = Date.now();

  // Model warm-up (errors handled gracefully, especially in tests)
  try {
    await ensureModelWarmed(options.model, config);
  } catch {
    // Continue even if warmup fails - model will load on first request
  }

  const { endpoint, maxRetries, timeout, keepAlive, maxContextSize } = config;

  // Calculate optimal context size for this prompt
  const contextSize = calculateContextSize(prompt.length, maxContextSize);

  debugLog(`[${requestId}] Request started`);
  debugLog(`  Model: ${options.model}`);
  debugLog(
    `  Prompt: ${prompt.length} chars (~${Math.ceil(prompt.length / 4)} tokens)`
  );
  debugLog(`  Context: ${contextSize}, Timeout: ${timeout}ms`);
  debugLog(`  Expect JSON: ${options.expectJson}`);

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const attemptStart = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      debugLog(`[${requestId}] Attempt ${attempt}/${maxRetries}...`);

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

      debugLog(
        `[${requestId}] Response received in ${Date.now() - attemptStart}ms`
      );
      if (data.eval_count) {
        debugLog(
          `  Tokens: ${data.eval_count} eval, ${data.prompt_eval_count || 0} prompt`
        );
      }
      debugLog(`  Total request time: ${Date.now() - requestStart}ms`);

      if (!data.done || data.done_reason !== 'stop') {
        throw new Error(
          `Incomplete response: done=${data.done}, reason=${data.done_reason}`
        );
      }

      if (options.expectJson) {
        return JSON.parse(data.message.content);
      }

      return data.message.content as string;
    } catch (error) {
      lastError = error as Error;

      if (error instanceof Error && error.name === 'AbortError') {
        console.log(
          `Attempt ${attempt}/${maxRetries}: Request timed out after ${Date.now() - attemptStart}ms, retrying...`
        );
        debugLog(`[${requestId}] Timeout after ${Date.now() - attemptStart}ms`);
      } else {
        console.log(
          `Attempt ${attempt}/${maxRetries}: Request failed, retrying...`
        );
        console.log('  Error:', lastError.message);
        debugLog(`[${requestId}] Error:`, lastError.message);
      }

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  debugLog(`[${requestId}] Failed after ${maxRetries} retries`);
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
  // TODO: Implement robust transcript cleaning (Milestone 4)
  prompt = prompt.replace('{{TRANSCRIPT_ALL}}', transcript.fullText);

  if (visualLogs && visualLogs.length > 0) {
    const visualSummary = visualLogs[0].entries
      .map((e, _i) => {
        const timestamp = `[${e.timestamp}s]`;
        const label = e.heuristicLabel ? `[${e.heuristicLabel}]` : '';
        const description = e.description ? `: ${e.description}` : '';
        const ocr = e.ocrSummary
          ? ` (OCR: ${e.ocrSummary.substring(0, 100)})`
          : '';
        return `${timestamp} ${label}${description}${ocr}`;
      })
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

  // TODO: Implement robust transcript cleaning (Milestone 4)
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
        (e, _i: number) =>
          `[Scene ${_i}] at ${e.timestamp}s: ${e.description || 'Action on screen'}`
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

/**
 * Describe a set of images using a vision-capable model.
 */
async function describeImagesWithOllama(
  images: Array<{ imagePath: string; clusterId: number; timestamp: number }>,
  config: IntelligenceConfig,
  customPrompt?: string
): Promise<VisualDescriptions> {
  if (images.length === 0) {
    return {
      descriptions: [],
      processingTime: { vlmMs: 0, framesProcessed: 0 },
    };
  }

  console.log(`Describing ${images.length} images with vision model...`);
  debugLog(`Vision model: ${config.visionModel}`);
  const startTime = Date.now();

  await ensureModelWarmed(config.visionModel, config);

  const BATCH_SIZE = 3; // Stable batch size for minicpm-v
  const allDescriptions: VisualDescription[] = [];

  for (let i = 0; i < images.length; i += BATCH_SIZE) {
    const batch = images.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(images.length / BATCH_SIZE);
    const batchStart = Date.now();

    console.log(`  Processing batch ${batchNum}/${totalBatches}...`);
    debugLog(`  Batch ${batchNum}: ${batch.length} images`);

    try {
      const descriptions = await callOllamaVision(batch, config, customPrompt);
      allDescriptions.push(...descriptions);
      debugLog(`  Batch ${batchNum} completed in ${Date.now() - batchStart}ms`);
    } catch (error) {
      console.error(`  Error in batch ${batchNum}:`, error);
      debugLog(`  Batch ${batchNum} failed:`, (error as Error).message);
      // Add error placeholders to maintain alignment
      for (const img of batch) {
        allDescriptions.push({
          clusterId: img.clusterId,
          timestamp: img.timestamp,
          description: `Error: ${(error as Error).message}`,
        });
      }
    }

    // Small delay between batches to avoid overwhelming Ollama
    if (i + BATCH_SIZE < images.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  const vlmMs = Date.now() - startTime;
  console.log(`✓ Described ${allDescriptions.length} images in ${vlmMs}ms`);
  debugLog(`Total vision processing time: ${vlmMs}ms`);

  return {
    descriptions: allDescriptions,
    processingTime: { vlmMs, framesProcessed: allDescriptions.length },
  };
}

async function callOllamaVision(
  images: Array<{ imagePath: string; clusterId: number; timestamp: number }>,
  config: IntelligenceConfig,
  customPrompt?: string
): Promise<VisualDescription[]> {
  const requestId = Math.random().toString(36).substring(2, 8);
  const requestStart = Date.now();

  debugLog(`[${requestId}] Vision request started`);
  debugLog(`  Model: ${config.visionModel}`);
  debugLog(`  Images: ${images.length}`);

  // Convert images to base64 (Ollama expects raw base64 strings)
  const imageContents = images.map((img) => {
    const data = readFileSync(img.imagePath);
    return data.toString('base64');
  });

  const prompt =
    customPrompt ||
    `Analyze these ${images.length} screenshots from a screen recording.
For each screenshot (in order), provide a one-sentence description of what the user is doing.
Focus on: the application being used, the specific activity, and any visible content.

Return a JSON object with this structure:
{
  "descriptions": [
    {"index": 0, "summary": "description for first image"},
    {"index": 1, "summary": "description for second image"}
  ]
}`;

  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.visionModel,
      messages: [
        {
          role: 'user',
          content: prompt,
          images: imageContents,
        },
      ],
      format: {
        type: 'object',
        properties: {
          descriptions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                index: { type: 'number' },
                summary: { type: 'string' },
              },
              required: ['index', 'summary'],
            },
          },
        },
        required: ['descriptions'],
      },
      stream: false,
      options: { num_ctx: 131072 },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`  HTTP ${response.status}: ${errorText.substring(0, 500)}`);
    debugLog(`[${requestId}] Vision error: ${response.status}`);
    throw new Error(
      `Ollama vision error: ${response.status} ${response.statusText}`
    );
  }

  const data = await response.json();

  debugLog(`[${requestId}] Vision response in ${Date.now() - requestStart}ms`);
  if (data.eval_count) {
    debugLog(`  Tokens: ${data.eval_count} eval`);
  }

  const content = data.message?.content;

  if (!content) {
    console.error(
      '  Empty response from Ollama:',
      JSON.stringify(data).substring(0, 500)
    );
    throw new Error('Empty response from Ollama vision model');
  }

  const parsed = JSON.parse(content);
  const descriptionsList = parsed.descriptions || [];

  // Map back to our format
  return images.map((img, i) => {
    const desc = descriptionsList.find(
      (d: { index: number }) => d.index === i
    ) ||
      descriptionsList[i] || { summary: 'No description generated' };

    return {
      clusterId: img.clusterId,
      timestamp: img.timestamp,
      description: desc.summary,
    };
  });
}
