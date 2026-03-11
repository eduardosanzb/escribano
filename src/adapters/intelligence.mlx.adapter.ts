/**
 * Escribano - Intelligence Adapter (MLX)
 *
 * Implements IntelligenceService using MLX-VLM and MLX-LM via Unix domain sockets.
 * Uses separate bridge processes for VLM (frame analysis) and LLM (text generation).
 *
 * Architecture:
 *   TypeScript (this file) <--Unix Socket--> Python (mlx_bridge.py --mode vlm)
 *   TypeScript (this file) <--Unix Socket--> Python (mlx_bridge.py --mode llm)
 *
 * The caller only sees a single IntelligenceService. Internally, we manage:
 * - VLM bridge: spawns lazily on describeImages(), uses -vlm.sock
 * - LLM bridge: spawns lazily on generateText(), uses -llm.sock
 *
 * See docs/adr/006-mlx-vlm-adapter.md for full design.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { createConnection, type Socket } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));

import type {
  ArtifactType,
  Classification,
  DbObservation,
  IntelligenceConfig,
  IntelligenceService,
  Transcript,
  TranscriptMetadata,
  VisualLog,
} from '../0_types.js';
import { loadConfig } from '../config.js';
import { getDbPath } from '../db/index.js';
import { ensureEscribanoVenv as ensurePythonVenv } from '../python-deps.js';
import { getPythonPath } from '../python-utils.js';
import type { ResourceTrackable } from '../stats/types.js';
import { selectBestMLXModel } from '../utils/model-detector.js';

// ============================================================================
// Utility Functions - Parsing, Prompts, Debug Logging
// ============================================================================

function debugLog(...args: unknown[]): void {
  const config = loadConfig();
  if (config.verbose) {
    console.log('[MLX]', ...args);
  }
}

/**
 * Strip <think>...</think> tags from LLM output.
 * Handles standard pairs and Qwen's orphan </think> edge case.
 */
function stripThinkingTags(text: string): string {
  // Strip complete <think>...</think> pairs (standard case)
  let result = text.replace(/<think>[\s\S]*?<\/think>/g, '');

  // Strip orphan closing tag + everything before it (Qwen3.5 actual behavior)
  // This handles: "Let me analyze...\n</think>\n# Actual answer"
  if (result.includes('</think>')) {
    const parts = result.split('</think>');
    result = parts[parts.length - 1]; // Take content after the last </think>
  }

  return result.trim();
}

/**
 * Load VLM prompt template from prompts/vlm-batch.md or use inline fallback.
 */
function loadVlmPrompt(batchSize: number): string {
  try {
    const promptPath = resolve(__dirname, '../../prompts/vlm-batch.md');
    const content = readFileSync(promptPath, 'utf-8');
    return content.replace('{{FRAME_COUNT}}', String(batchSize));
  } catch {
    // Fallback to inline prompt
    return `Analyze these ${batchSize} screenshots from a screen recording.

For each frame above, provide:
- description: What's on screen? Be specific about content, text, and UI elements.
- activity: What is the user doing?
- apps: Which applications are visible?
- topics: What topics, projects, or technical subjects?

Output in this exact format for each frame:
Frame 1: description: ... | activity: ... | apps: [...] | topics: [...]
Frame 2: description: ... | activity: ... | apps: [...] | topics: [...]
...and so on for all ${batchSize} frames.`;
  }
}

/**
 * Parse interleaved multi-frame VLM output.
 * Handles the pipe-delimited format returned by MLX-VLM.
 */
function parseInterleavedOutput(
  text: string,
  batch: Array<{ index: number; timestamp: number; imagePath: string }>
): Array<{
  index: number;
  timestamp: number;
  imagePath: string;
  description: string;
  activity: string;
  apps: string[];
  topics: string[];
  raw_response?: string;
}> {
  const results: Array<{
    index: number;
    timestamp: number;
    imagePath: string;
    description: string;
    activity: string;
    apps: string[];
    topics: string[];
    raw_response?: string;
  }> = [];

  for (let frameNum = 1; frameNum <= batch.length; frameNum++) {
    const frame = batch[frameNum - 1];

    // Look for "Frame N: description: ..." pattern
    const pattern = new RegExp(
      `Frame ${frameNum}:\\s*description:\\s*(.+?)\\s*\\|\\s*activity:\\s*(.+?)\\s*\\|\\s*apps:\\s*(\\[.+?\\]|[^|]+)\\s*\\|\\s*topics:\\s*(.+?)(?=Frame \\d+:|$)`,
      'is'
    );
    const match = text.match(pattern);

    if (match) {
      const appsStr = match[3].replace(/^\[|\]$/g, '').trim();
      const topicsStr = match[4].replace(/^\[|\]$/g, '').trim();

      results.push({
        index: frame.index,
        timestamp: frame.timestamp,
        imagePath: frame.imagePath,
        description: match[1].trim(),
        activity: match[2].trim(),
        apps: appsStr
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        topics: topicsStr
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      });
    } else {
      results.push({
        index: frame.index,
        timestamp: frame.timestamp,
        imagePath: frame.imagePath,
        description: `Failed to parse Frame ${frameNum}`,
        activity: 'unknown',
        apps: [],
        topics: [],
        raw_response: text,
      });
    }
  }

  return results;
}

/**
 * Log LLM call to debug database (TypeScript-side).
 */
function logLlmCallToDb(
  recordingId: string | undefined,
  artifactId: string | undefined,
  callType: string,
  prompt: string | unknown,
  result: string,
  metadata: Record<string, unknown>
): void {
  try {
    const dbPath = getDbPath();
    const db = new Database(dbPath);
    const stmt = db.prepare(
      `INSERT INTO llm_debug_log (id, recording_id, artifact_id, call_type, prompt, result, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const id = `ts-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    stmt.run(
      id,
      recordingId || null,
      artifactId || null,
      callType,
      typeof prompt === 'string' ? prompt : JSON.stringify(prompt),
      result,
      JSON.stringify(metadata)
    );
    db.close();
    debugLog(`Logged LLM call to debug table: ${id}`);
  } catch (err) {
    debugLog(`Failed to log LLM call (non-fatal): ${(err as Error).message}`);
  }
}

// ============================================================================

interface MlxConfig {
  model: string;
  batchSize: number;
  maxTokens: number;
  socketPath: string;
  bridgeScript: string;
  startupTimeout: number;
}

interface BridgeState {
  process: ChildProcess | null;
  socket: Socket | null;
  ready: boolean;
  connecting: boolean;
  loadedModel?: string | null;
}

interface FrameDescription {
  index: number;
  timestamp: number;
  activity: string;
  description: string;
  apps: string[];
  topics: string[];
  imagePath: string;
  raw_response?: string;
}

export async function resolvePythonPath(): Promise<string> {
  return getPythonPath() ?? ensurePythonVenv();
}

let globalCleanup: (() => void) | null = null;

export function cleanupMlxBridge(): void {
  if (globalCleanup) {
    debugLog('Explicit cleanup called');
    globalCleanup();
    globalCleanup = null;
  }
}

export function createMlxIntelligenceService(
  _config: Partial<IntelligenceConfig> = {}
): IntelligenceService & ResourceTrackable {
  // Load unified config (respects env vars, config file, and RAM-aware defaults)
  const config = loadConfig();

  const mlxConfig: MlxConfig = {
    model: config.vlmModel,
    batchSize: config.vlmBatchSize,
    maxTokens: config.vlmMaxTokens,
    socketPath: config.mlxSocketPath,
    bridgeScript: resolve(__dirname, '../../scripts/mlx_bridge.py'),
    startupTimeout: config.mlxStartupTimeout,
  };

  const vlmBridge: BridgeState = {
    process: null,
    socket: null,
    ready: false,
    connecting: false,
  };

  const llmBridge: BridgeState = {
    process: null,
    socket: null,
    ready: false,
    connecting: false,
    loadedModel: null,
  };

  const getVlmSocketPath = (): string =>
    mlxConfig.socketPath.replace('.sock', '-vlm.sock');
  const getLlmSocketPath = (): string =>
    mlxConfig.socketPath.replace('.sock', '-llm.sock');

  const cleanup = (): void => {
    if (vlmBridge.socket) {
      try {
        vlmBridge.socket.destroy();
      } catch {}
      vlmBridge.socket = null;
    }
    if (vlmBridge.process) {
      try {
        vlmBridge.process.kill('SIGTERM');
      } catch {}
      vlmBridge.process = null;
    }
    const vlmSock = getVlmSocketPath();
    if (existsSync(vlmSock)) {
      try {
        unlinkSync(vlmSock);
      } catch {}
    }
    vlmBridge.ready = false;

    if (llmBridge.socket) {
      try {
        llmBridge.socket.destroy();
      } catch {}
      llmBridge.socket = null;
    }
    if (llmBridge.process) {
      try {
        llmBridge.process.kill('SIGTERM');
      } catch {}
      llmBridge.process = null;
    }
    const llmSock = getLlmSocketPath();
    if (existsSync(llmSock)) {
      try {
        unlinkSync(llmSock);
      } catch {}
    }
    llmBridge.ready = false;
    llmBridge.loadedModel = null;
  };

  globalCleanup = cleanup;
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
  process.on('beforeExit', cleanup);

  const startBridge = async (
    bridgeState: BridgeState,
    mode: 'vlm' | 'llm',
    _socketPath: string
  ): Promise<void> => {
    if (bridgeState.process && bridgeState.ready) return;

    debugLog(`Starting ${mode.toUpperCase()} bridge...`);
    const pythonPath = await resolvePythonPath();
    debugLog(`Using Python: ${pythonPath}`);

    return new Promise((resolvePromise, rejectPromise) => {
      const env: Record<string, string> = {
        ...process.env,
        ESCRIBANO_MLX_SOCKET_PATH: mlxConfig.socketPath,
      } as Record<string, string>;

      if (mode === 'vlm') {
        env.ESCRIBANO_VLM_MODEL = mlxConfig.model;
        env.ESCRIBANO_VLM_BATCH_SIZE = String(mlxConfig.batchSize);
        env.ESCRIBANO_VLM_MAX_TOKENS = String(mlxConfig.maxTokens);
      }

      bridgeState.process = spawn(
        pythonPath,
        [mlxConfig.bridgeScript, '--mode', mode],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          env,
        }
      );

      if (!bridgeState.process.stdout || !bridgeState.process.stderr) {
        rejectPromise(new Error('Failed to create bridge process streams'));
        return;
      }

      let readyReceived = false;
      let startupTimer: ReturnType<typeof setTimeout> | null = null;

      const clearStartupTimer = () => {
        if (startupTimer) {
          clearTimeout(startupTimer);
          startupTimer = null;
        }
      };

      bridgeState.process.stdout.on('data', (data: Buffer) => {
        const lines = data.toString().trim().split('\n');
        for (const line of lines) {
          if (!readyReceived && line.startsWith('{')) {
            try {
              const msg = JSON.parse(line);
              if (msg.status === 'ready') {
                readyReceived = true;
                clearStartupTimer();
                bridgeState.ready = true;
                debugLog(
                  `${mode.toUpperCase()} bridge ready: ${msg.model || msg.mode}`
                );
                resolvePromise();
              }
            } catch {}
          }
        }
      });

      bridgeState.process.stderr.on('data', (data: Buffer) => {
        const text = data.toString().trim();
        if (text) console.log(text);
      });

      bridgeState.process.on('exit', (code, signal) => {
        debugLog(
          `${mode.toUpperCase()} bridge exited: code=${code} signal=${signal}`
        );
        bridgeState.process = null;
        bridgeState.ready = false;
        if (!readyReceived) {
          clearStartupTimer();
          rejectPromise(
            new Error(
              `${mode.toUpperCase()} bridge failed to start: exit code ${code}`
            )
          );
        }
      });

      bridgeState.process.on('error', (err) => {
        debugLog(`${mode.toUpperCase()} bridge error: ${err.message}`);
        if (!readyReceived) {
          clearStartupTimer();
          rejectPromise(
            new Error(
              `Failed to start ${mode.toUpperCase()} bridge: ${err.message}`
            )
          );
        }
      });

      startupTimer = setTimeout(() => {
        if (!readyReceived) {
          startupTimer = null;
          rejectPromise(
            new Error(
              `${mode.toUpperCase()} bridge startup timeout (${mlxConfig.startupTimeout / 1000}s)`
            )
          );
        }
      }, mlxConfig.startupTimeout);
    });
  };

  const connect = (
    bridgeState: BridgeState,
    socketPath: string
  ): Promise<Socket> => {
    return new Promise((resolvePromise, rejectPromise) => {
      if (bridgeState.socket && !bridgeState.socket.destroyed) {
        resolvePromise(bridgeState.socket);
        return;
      }

      let connectionTimer: ReturnType<typeof setTimeout> | null = null;

      const clearConnectionTimer = () => {
        if (connectionTimer) {
          clearTimeout(connectionTimer);
          connectionTimer = null;
        }
      };

      debugLog(`Connecting to socket: ${socketPath}`);
      const client = createConnection(socketPath);

      client.on('connect', () => {
        clearConnectionTimer();
        debugLog('Socket connected');
        bridgeState.socket = client;
        resolvePromise(client);
      });

      client.on('error', (err) => {
        clearConnectionTimer();
        debugLog(`Socket error: ${err.message}`);
        bridgeState.socket = null;
        rejectPromise(new Error(`Socket connection failed: ${err.message}`));
      });

      client.on('close', () => {
        debugLog('Socket closed');
        bridgeState.socket = null;
      });

      connectionTimer = setTimeout(() => {
        if (!bridgeState.socket) {
          connectionTimer = null;
          client.destroy();
          rejectPromise(new Error('Socket connection timeout'));
        }
      }, 5000);
    });
  };

  const sendRequest = async <T>(
    bridgeState: BridgeState,
    socketPath: string,
    mode: 'vlm' | 'llm',
    request: { id: number; method: string; params: Record<string, unknown> },
    onBatch?: (
      response: T,
      progress: { current: number; total: number }
    ) => void
  ): Promise<T[]> => {
    if (!bridgeState.ready) {
      await startBridge(bridgeState, mode, socketPath);
    }

    const socket = await connect(bridgeState, socketPath);

    return new Promise((resolvePromise, rejectPromise) => {
      const responses: T[] = [];
      let buffer = '';

      const onData = (chunk: Buffer): void => {
        buffer += chunk.toString();

        while (buffer.includes('\n')) {
          const newlineIndex = buffer.indexOf('\n');
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          if (!line.trim()) continue;

          try {
            const response = JSON.parse(line) as T & {
              done?: boolean;
              error?: string;
            };

            if ('error' in response && response.error) {
              rejectPromise(new Error(response.error));
              socket.off('data', onData);
              return;
            }

            responses.push(response);

            if ('done' in response && response.done) {
              socket.off('data', onData);
              resolvePromise(responses);
              return;
            }
            if (onBatch && 'progress' in response) {
              const resp = response as T & {
                progress: { current: number; total: number };
              };
              onBatch(response, resp.progress);
            }
          } catch {
            debugLog(`Failed to parse response: ${line}`);
          }
        }
      };

      socket.on('data', onData);
      socket.on('error', (err) => {
        socket.off('data', onData);
        rejectPromise(new Error(`Socket error: ${err.message}`));
      });

      const requestJson = `${JSON.stringify(request)}\n`;
      debugLog(`Sending request: id=${request.id} method=${request.method}`);
      socket.write(requestJson);
    });
  };

  return {
    async classify(
      _transcript: Transcript,
      _visualLogs?: VisualLog[]
    ): Promise<Classification> {
      throw new Error(
        'MLX adapter does not support classify(). Use Ollama backend.'
      );
    },

    async classifySegment(
      _segment: unknown,
      _transcript?: Transcript
    ): Promise<Classification> {
      throw new Error(
        'MLX adapter does not support classifySegment(). Use Ollama backend.'
      );
    },

    async extractMetadata(
      _transcript: Transcript,
      _classification: Classification,
      _visualLogs?: VisualLog[]
    ): Promise<TranscriptMetadata> {
      throw new Error(
        'MLX adapter does not support extractMetadata(). Use Ollama backend.'
      );
    },

    async generate(
      _artifactType: ArtifactType,
      _context: {
        transcript: Transcript;
        classification: Classification;
        metadata: TranscriptMetadata | null;
        visualLogs?: VisualLog[];
      }
    ): Promise<string> {
      throw new Error(
        'MLX adapter does not support generate(). Use Ollama backend.'
      );
    },

    async describeImages(
      images: Array<{ imagePath: string; timestamp: number }>,
      options: {
        model?: string;
        recordingId?: string;
        onImageProcessed?: (
          result: FrameDescription,
          progress: { current: number; total: number }
        ) => void;
      } = {}
    ): Promise<FrameDescription[]> {
      const total = images.length;
      if (total === 0) {
        debugLog('No images to process');
        return [];
      }

      console.log(`[VLM] Processing ${total} images with MLX...`);
      console.log(
        `[VLM] Model: ${mlxConfig.model}, batch size: ${mlxConfig.batchSize}`
      );

      const startTime = Date.now();
      const allResults: FrameDescription[] = [];

      // Convert input images to indexed list
      const imageList = images.map((img, idx) => ({
        index: idx,
        timestamp: img.timestamp,
        imagePath: img.imagePath,
      }));

      // Process in batches
      for (
        let batchStart = 0;
        batchStart < imageList.length;
        batchStart += mlxConfig.batchSize
      ) {
        const batchEnd = Math.min(
          batchStart + mlxConfig.batchSize,
          imageList.length
        );
        const batch = imageList.slice(batchStart, batchEnd);

        debugLog(`Processing batch: ${batchStart + 1}-${batchEnd}/${total}`);

        try {
          // Load VLM prompt for this batch
          const prompt = loadVlmPrompt(batch.length);

          // Build messages in shape expected by Python bridge:
          // [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image", imagePath: ... }, ...] }]
          const messages = [
            {
              role: 'user' as const,
              content: [
                {
                  type: 'text' as const,
                  text: prompt,
                },
                ...batch.map((img) => ({
                  type: 'image' as const,
                  imagePath: img.imagePath,
                })),
              ],
            },
          ];

          // Send single batch request
          const requestId = Date.now() + batchStart;
          const responses = await sendRequest(
            vlmBridge,
            getVlmSocketPath(),
            'vlm',
            {
              id: requestId,
              method: 'vlm_infer',
              params: {
                messages,
                maxTokens: mlxConfig.maxTokens,
              },
            }
          );

          if (responses.length === 0) {
            throw new Error('No response from VLM inference');
          }

          // Extract raw text from first response
          const response = responses[0] as {
            text?: string;
            error?: string;
          };
          if (response.error) {
            throw new Error(`VLM inference failed: ${response.error}`);
          }

          const rawText = response.text || '';
          debugLog(`VLM returned ${rawText.length} chars`);

          // Parse interleaved output
          const batchResults = parseInterleavedOutput(rawText, batch);

          // Append results and invoke callback with cumulative progress
          for (const result of batchResults) {
            allResults.push(result);
            const cumulativeProgress = {
              current: allResults.length,
              total,
            };
            if (options.onImageProcessed) {
              options.onImageProcessed(result, cumulativeProgress);
            }
          }

          // Log progress roughly every 10 frames
          if (allResults.length % 10 === 0 || allResults.length === total) {
            console.log(
              `[VLM] [${allResults.length}/${total}] frames processed`
            );
          }
        } catch (batchError) {
          const message = (batchError as Error).message;
          console.error(
            `[VLM] Batch ${batchStart + 1}-${batchEnd} failed: ${message}`
          );
          throw batchError;
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      const fps = total / ((Date.now() - startTime) / 1000);
      console.log(
        `\n[VLM] Complete: ${allResults.length}/${total} frames in ${duration}s (${fps.toFixed(2)} fps)`
      );

      return allResults;
    },

    async embedText(
      _texts: string[],
      _options?: { batchSize?: number }
    ): Promise<number[][]> {
      throw new Error(
        'MLX adapter does not support embedText(). Use Ollama backend.'
      );
    },

    async extractTopics(_observations: DbObservation[]): Promise<string[]> {
      throw new Error(
        'MLX adapter does not support extractTopics(). Use Ollama backend.'
      );
    },

    async generateText(
      prompt: string,
      options?: {
        model?: string;
        expectJson?: boolean;
        numPredict?: number;
        think?: boolean;
        debugContext?: {
          recordingId?: string;
          artifactId?: string;
          callType: 'subject_grouping' | 'artifact_generation';
        };
      }
    ): Promise<string> {
      const config = loadConfig();
      const modelSelection = await selectBestMLXModel();
      const resolvedModel = options?.model || modelSelection.model;
      const requestId = Date.now();
      const llmSocketPath = getLlmSocketPath();

      try {
        if (llmBridge.loadedModel !== resolvedModel) {
          if (llmBridge.loadedModel) {
            debugLog(`Unloading previous LLM model: ${llmBridge.loadedModel}`);
            await sendRequest(llmBridge, llmSocketPath, 'llm', {
              id: requestId,
              method: 'unload_llm',
              params: {},
            });
          }

          debugLog(`Loading LLM model: ${resolvedModel}`);
          console.log(`[LLM] Loading model: ${resolvedModel}`);
          try {
            await sendRequest(llmBridge, llmSocketPath, 'llm', {
              id: requestId + 1,
              method: 'load_llm',
              params: { model: resolvedModel },
            });
            llmBridge.loadedModel = resolvedModel;
            console.log('[LLM] Model loaded');
          } catch (loadError) {
            llmBridge.loadedModel = null;
            throw loadError;
          }
        }

        debugLog(`Generating text (${prompt.length} chars)...`);
        const responses = await sendRequest(llmBridge, llmSocketPath, 'llm', {
          id: requestId + 2,
          method: 'llm_infer',
          params: {
            rawPrompt: prompt,
            maxTokens: options?.numPredict ?? 8000,
            temperature: 0.7,
            think: options?.think ?? false,
          },
        });

        if (responses.length === 0) {
          throw new Error('No response from LLM generation');
        }

        const response = responses[0] as { error?: string; text?: string };
        if (response.error) {
          throw new Error(`Text generation failed: ${response.error}`);
        }

        const rawText = response.text || '';
        debugLog(`Generated ${rawText.length} chars`);

        // Strip thinking tags in TypeScript
        const cleanText = stripThinkingTags(rawText);

        // Log to debug DB if enabled
        if (config.debugLlm && options?.debugContext) {
          logLlmCallToDb(
            options.debugContext.recordingId,
            options.debugContext.artifactId,
            options.debugContext.callType,
            prompt,
            rawText,
            {
              model: resolvedModel,
              think: options.think ?? false,
              cleanedLength: cleanText.length,
            }
          );
        }

        return cleanText;
      } catch (error) {
        const message = (error as Error).message;
        console.error(`[LLM] ERROR: ${message}`);
        throw error;
      }
    },

    async loadLlm(model: string): Promise<void> {
      const requestId = Date.now();
      const llmSocketPath = getLlmSocketPath();

      if (llmBridge.loadedModel && llmBridge.loadedModel !== model) {
        await sendRequest(llmBridge, llmSocketPath, 'llm', {
          id: requestId,
          method: 'unload_llm',
          params: {},
        });
      }

      try {
        await sendRequest(llmBridge, llmSocketPath, 'llm', {
          id: requestId + 1,
          method: 'load_llm',
          params: { model },
        });
        llmBridge.loadedModel = model;
      } catch (loadError) {
        llmBridge.loadedModel = null;
        throw loadError;
      }
    },

    async unloadVlm(): Promise<void> {
      if (!vlmBridge.ready) return;
      const requestId = Date.now();
      await sendRequest(vlmBridge, getVlmSocketPath(), 'vlm', {
        id: requestId,
        method: 'unload_vlm',
        params: {},
      });
    },

    async unloadLlm(): Promise<void> {
      if (!llmBridge.ready) return;
      const requestId = Date.now();
      await sendRequest(llmBridge, getLlmSocketPath(), 'llm', {
        id: requestId,
        method: 'unload_llm',
        params: {},
      });
      llmBridge.loadedModel = null;
    },

    getResourceName(): string {
      return 'mlx-python';
    },

    getPid(): number | null {
      return vlmBridge.process?.pid ?? llmBridge.process?.pid ?? null;
    },
  };
}
