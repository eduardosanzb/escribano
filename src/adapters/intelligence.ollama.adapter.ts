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

// Zod schema for VLM batch response validation
const vlmBatchItemSchema = z.object({
  index: z.number(),
  description: z.string(),
  activity: z.string(),
  apps: z.array(z.string()).default([]),
  topics: z.array(z.string()).default([]),
});

const vlmBatchResponseSchema = z.array(vlmBatchItemSchema);

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
    describeImages: (images, options) =>
      describeImagesWithOllama(images, parsedConfig, options),
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
 * Build VLM prompt for single image analysis.
 * Simple format without index tracking.
 */
function buildVLMSingleImagePrompt(): string {
  return `Analyze this screenshot from a screen recording.

Provide:
- description: What's on screen? Be specific about content, text, and UI elements.
- activity: What is the user doing? (e.g., browsing, coding, reading, debugging)
- apps: Which applications are visible? (e.g., Chrome, VS Code, Terminal)
- topics: What topics, projects, or technical subjects? (e.g., Next.js, Bun, cloud services)

Output in this exact format:
description: ... | activity: ... | apps: [...] | topics: [...]`;
}

/** Parsed VLM response for a single image */
interface ParsedVLM {
  description: string;
  activity: string;
  apps: string[];
  topics: string[];
}

/**
 * Parse single-image VLM response.
 * Returns parsed data or fallback values.
 */
function parseVLMResponse(content: string): ParsedVLM {
  if (!content || content.trim().length === 0) {
    return { description: '', activity: 'unknown', apps: [], topics: [] };
  }

  const regex =
    /^description:\s*(.+?)\s*\|\s*activity:\s*(.+?)\s*\|\s*apps:\s*(\[.+?\]|[^|]+)\s*\|\s*topics:\s*(.+)$/s;
  const match = content.match(regex);

  if (match) {
    const appsStr = match[3].replace(/^\[|\]$/g, '').trim();
    const topicsStr = match[4].replace(/^\[|\]$/g, '').trim();

    return {
      description: match[1].trim(),
      activity: match[2].trim(),
      apps: appsStr
        ? appsStr
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
      topics: topicsStr
        ? topicsStr
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
    };
  }

  debugLog('[parseVLMResponse] No match, using content as description');
  debugLog('[parseVLMResponse] Raw content:', content.substring(0, 500));
  return {
    description: content.trim(),
    activity: 'unknown',
    apps: [],
    topics: [],
  };
}

/**
 * Describe images sequentially (one at a time).
 * Each image gets its own VLM request for accurate image-description mapping.
 */
async function describeImagesWithOllama(
  images: Array<{ imagePath: string; timestamp: number }>,
  config: IntelligenceConfig,
  options: {
    model?: string;
    recordingId?: string;
    onImageProcessed?: (
      result: {
        index: number;
        timestamp: number;
        imagePath: string;
        activity: string;
        description: string;
        apps: string[];
        topics: string[];
      },
      progress: { current: number; total: number }
    ) => void;
  } = {}
): Promise<
  Array<{
    index: number;
    timestamp: number;
    imagePath: string;
    activity: string;
    description: string;
    apps: string[];
    topics: string[];
  }>
> {
  const model =
    options.model ?? process.env.ESCRIBANO_VLM_MODEL ?? 'qwen3-vl:4b';
  const endpoint = `${config.endpoint.replace('/generate', '').replace('/chat', '')}/chat`;
  const { timeout, keepAlive } = config;
  const numPredict = Number(process.env.ESCRIBANO_VLM_NUM_PREDICT) || 30000;

  const allResults: Array<{
    index: number;
    timestamp: number;
    imagePath: string;
    activity: string;
    description: string;
    apps: string[];
    topics: string[];
  }> = [];

  const total = images.length;
  console.log(`[VLM] Processing ${total} images sequentially...`);
  console.log(`[VLM] Model: ${model}, num_predict: ${numPredict}`);
  const startTime = Date.now();

  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const current = i + 1;
    const imageStartTime = Date.now();
    let lastError: Error | null = null;
    let success = false;

    // 3 retry attempts
    for (let attempt = 1; attempt <= 3 && !success; attempt++) {
      try {
        // Read and encode image
        let base64Image: string;
        try {
          const buffer = readFileSync(image.imagePath);
          base64Image = buffer.toString('base64');
        } catch (readError) {
          throw new Error(
            `Failed to read image: ${(readError as Error).message}`
          );
        }

        const prompt = buildVLMSingleImagePrompt();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: 'user',
                content: prompt,
                images: [base64Image],
              },
            ],
            stream: false,
            keep_alive: keepAlive,
            options: {
              num_predict: numPredict,
              temperature: 0.3,
            },
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
        debugLog('[VLM] Response data keys:', Object.keys(data).join(', '));
        const content = data.message?.content || data.response || '';
        debugLog('[VLM] Raw content length:', content.length);
        debugLog('[VLM] Raw content preview:', content.substring(0, 500));
        const parsed = parseVLMResponse(content);

        if (parsed.activity === 'unknown' && parsed.description.length === 0) {
          debugLog('[VLM] Parsed as empty/unknown, full response:', content);
          throw new Error('VLM returned empty/unparseable response');
        }

        const result = {
          index: i,
          timestamp: image.timestamp,
          imagePath: image.imagePath,
          activity: parsed.activity,
          description: parsed.description,
          apps: parsed.apps,
          topics: parsed.topics,
        };

        allResults.push(result);

        success = true;
        const duration = Date.now() - imageStartTime;

        // Log every 10 frames
        if (current % 10 === 0) {
          console.log(
            `[VLM] [${current}/${total}] ✓ (${(duration / 1000).toFixed(1)}s)`
          );
        }

        // Call callback immediately after each image
        if (options.onImageProcessed) {
          options.onImageProcessed(result, { current, total });
        }
      } catch (error) {
        lastError = error as Error;
        if (attempt < 3) {
          debugLog(
            `[VLM] [${current}/${total}] Attempt ${attempt}/3 failed: ${lastError.message}, retrying...`
          );
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
      }
    }

    if (!success) {
      console.warn(
        `[VLM] [${current}/${total}] ✗ Failed after 3 attempts: ${lastError?.message}`
      );
      // Don't save - frame will be re-processed on next run
    }
  }

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
  const successCount = allResults.length;
  console.log(
    `\n[VLM] Complete: ${successCount}/${total} frames in ${totalDuration}s`
  );

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
    format?: 'json';
    think?: boolean;
    num_predict?: number;
    images?: string[];
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
              ...(options.images && { images: options.images }),
            },
          ],
          stream: false,
          keep_alive: keepAlive,
          options: {
            num_ctx: contextSize,
            ...(options.num_predict && { num_predict: options.num_predict }),
          },
          ...(options.expectJson && {
            format: options.jsonSchema ?? 'json',
          }),
          ...(options.format && { format: options.format }),
          ...(options.think !== undefined && { think: options.think }),
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      debugLog(`[${requestId}] response`, response);

      if (!response.ok) {
        throw new Error(
          `Ollama API error: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json();

      debugLog(
        `[${requestId}] Response received in ${Date.now() - attemptStart}ms`,
        data
      );
      if (data.eval_count) {
        debugLog(
          `  Tokens: ${data.eval_count} eval, ${data.prompt_eval_count || 0} prompt`
        );
      }
      debugLog(`  Total request time: ${Date.now() - requestStart}ms`);

      if (!data.done || data.done_reason !== 'stop') {
        // Warn about truncation but don't throw - let caller decide
        if (data.done_reason === 'length') {
          console.warn(
            `[Ollama] Response truncated (done_reason: length). ` +
              `Used ${data.eval_count} tokens. Consider increasing num_predict.`
          );
        }
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
