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
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { createConnection, type Socket } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
import {
  ESCRIBANO_HOME,
  ESCRIBANO_VENV_PYTHON,
  getPythonPath,
} from '../python-utils.js';
import type { ResourceTrackable } from '../stats/types.js';
import { selectBestMLXModel } from '../utils/model-detector.js';

function debugLog(...args: unknown[]): void {
  const config = loadConfig();
  if (config.verbose) {
    console.log('[MLX]', ...args);
  }
}

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

function runVisible(cmd: string, args: string[]): Promise<void> {
  return new Promise((res, rej) => {
    const proc = spawn(cmd, args, { stdio: 'inherit' });
    proc.on('exit', (code) =>
      code === 0 ? res() : rej(new Error(`${cmd} exited with code ${code}`))
    );
    proc.on('error', rej);
  });
}

function runSilent(cmd: string, args: string[]): Promise<void> {
  return new Promise((res, rej) => {
    const proc = spawn(cmd, args, { stdio: 'ignore' });
    proc.on('exit', (code) =>
      code === 0 ? res() : rej(new Error(`${cmd} exited with code ${code}`))
    );
    proc.on('error', rej);
  });
}

async function ensureEscribanoVenv(): Promise<string> {
  if (!existsSync(ESCRIBANO_HOME)) {
    mkdirSync(ESCRIBANO_HOME, { recursive: true });
  }

  if (!existsSync(ESCRIBANO_VENV_PYTHON)) {
    console.log(
      '[MLX] First-time setup: creating Python environment at ~/.escribano/venv'
    );
    await runVisible('python3', ['-m', 'venv', `${ESCRIBANO_HOME}/venv`]);
  }

  let mlxReady = false;
  try {
    await runSilent(ESCRIBANO_VENV_PYTHON, [
      '-c',
      'import mlx_vlm; import torch; import torchvision',
    ]);
    mlxReady = true;
  } catch {
    // not installed yet
  }

  if (!mlxReady) {
    console.log(
      '[MLX] Installing mlx-vlm into ~/.escribano/venv (first run — this may take a few minutes)...'
    );
    try {
      await runVisible(ESCRIBANO_VENV_PYTHON, ['-m', 'ensurepip', '--upgrade']);
    } catch {
      // ensurepip may be unavailable
    }
    await runVisible(ESCRIBANO_VENV_PYTHON, [
      '-m',
      'pip',
      'install',
      'mlx-vlm',
      'torch',
      'torchvision',
      'mlx-lm',
    ]);
    console.log('[MLX] mlx-vlm and mlx-lm installed successfully.');
  }

  return ESCRIBANO_VENV_PYTHON;
}

export async function resolvePythonPath(): Promise<string> {
  return getPythonPath() ?? ensureEscribanoVenv();
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
    socketPath: string
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
      const requestId = Date.now();

      const handleBatch = (
        response: {
          results: FrameDescription[];
          progress: { current: number; total: number };
        },
        progress: { current: number; total: number }
      ): void => {
        if (response.results) {
          for (const result of response.results) {
            allResults.push(result);
            if (options.onImageProcessed) {
              options.onImageProcessed(result, progress);
            }
          }

          if (
            progress.current % 10 === 0 ||
            progress.current === progress.total
          ) {
            console.log(
              `[VLM] [${progress.current}/${progress.total}] frames processed`
            );
          }
        }
      };

      try {
        await sendRequest(
          vlmBridge,
          getVlmSocketPath(),
          'vlm',
          {
            id: requestId,
            method: 'describe_images',
            params: {
              images: images.map((img, idx) => ({
                index: idx,
                imagePath: img.imagePath,
                timestamp: img.timestamp,
              })),
              batchSize: mlxConfig.batchSize,
              maxTokens: mlxConfig.maxTokens,
            },
          },
          handleBatch
        );

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        const fps = total / ((Date.now() - startTime) / 1000);
        console.log(
          `\n[VLM] Complete: ${allResults.length}/${total} frames in ${duration}s (${fps.toFixed(2)} fps)`
        );

        return allResults;
      } catch (error) {
        const message = (error as Error).message;
        console.error(`[VLM] ERROR: ${message}`);
        throw new Error(`MLX VLM processing failed: ${message}`);
      }
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
      }
    ): Promise<string> {
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
          method: 'generate_text',
          params: {
            rawPrompt: prompt,
            maxTokens: options?.numPredict ?? 4000,
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

        debugLog(`Generated ${response.text?.length || 0} chars`);
        return response.text || '';
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
