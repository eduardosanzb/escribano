/**
 * Escribano - Intelligence Adapter (MLX-VLM)
 *
 * Implements IntelligenceService using MLX-VLM via Unix domain socket.
 * Uses interleaved batching for 4.7x speedup over Ollama sequential processing.
 *
 * Architecture:
 *   TypeScript (this file) <--Unix Socket--> Python (mlx_bridge.py)
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
import {
  ESCRIBANO_HOME,
  ESCRIBANO_VENV,
  ESCRIBANO_VENV_PYTHON,
  getPythonPath,
} from '../python-utils.js';
import type { ResourceTrackable } from '../stats/types.js';

const DEBUG_MLX = process.env.ESCRIBANO_VERBOSE === 'true';

function debugLog(...args: unknown[]): void {
  if (DEBUG_MLX) {
    console.log('[VLM] [MLX]', ...args);
  }
}

interface MlxConfig {
  model: string;
  batchSize: number;
  maxTokens: number;
  socketPath: string;
  bridgeScript: string;
}

interface BridgeState {
  process: ChildProcess | null;
  socket: Socket | null;
  ready: boolean;
  connecting: boolean;
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

interface MlxConfigWithTimeout extends MlxConfig {
  startupTimeout: number;
}

const DEFAULT_CONFIG: MlxConfigWithTimeout = {
  model:
    process.env.ESCRIBANO_VLM_MODEL ??
    'mlx-community/Qwen3-VL-2B-Instruct-4bit',
  batchSize: Number(process.env.ESCRIBANO_VLM_BATCH_SIZE) || 4,
  maxTokens: Number(process.env.ESCRIBANO_VLM_MAX_TOKENS) || 2000,
  socketPath:
    process.env.ESCRIBANO_MLX_SOCKET_PATH ?? '/tmp/escribano-mlx.sock',
  bridgeScript: resolve(__dirname, '../../scripts/mlx_bridge.py'),
  startupTimeout: Number(process.env.ESCRIBANO_MLX_STARTUP_TIMEOUT) || 120000,
};

/** pip binary inside Escribano's managed venv. */
const _ESCRIBANO_VENV_PIP = resolve(ESCRIBANO_VENV, 'bin', 'pip');

/**
 * Run a command, streaming stdout/stderr directly to the terminal.
 * Used for long-running setup tasks (venv creation, pip install) so the
 * user can see progress in real time.
 */
function runVisible(cmd: string, args: string[]): Promise<void> {
  return new Promise((res, rej) => {
    const proc = spawn(cmd, args, { stdio: 'inherit' });
    proc.on('exit', (code) =>
      code === 0 ? res() : rej(new Error(`${cmd} exited with code ${code}`))
    );
    proc.on('error', rej);
  });
}

/**
 * Run a command silently (discard output). Used for quick probe checks.
 */
function runSilent(cmd: string, args: string[]): Promise<void> {
  return new Promise((res, rej) => {
    const proc = spawn(cmd, args, { stdio: 'ignore' });
    proc.on('exit', (code) =>
      code === 0 ? res() : rej(new Error(`${cmd} exited with code ${code}`))
    );
    proc.on('error', rej);
  });
}

/**
 * Ensure ~/.escribano/venv exists and has mlx-vlm installed.
 * Uses plain `python3 -m venv` — no uv, no pip flags, no fuss.
 * On first run this takes a few minutes; subsequent runs are instant.
 */
async function ensureEscribanoVenv(): Promise<string> {
  if (!existsSync(ESCRIBANO_HOME)) {
    mkdirSync(ESCRIBANO_HOME, { recursive: true });
  }

  if (!existsSync(ESCRIBANO_VENV_PYTHON)) {
    console.log(
      '[VLM] First-time setup: creating Python environment at ~/.escribano/venv'
    );
    await runVisible('python3', ['-m', 'venv', ESCRIBANO_VENV]);
  }

  // Check whether mlx-vlm and required runtime deps are already importable (~0.3s probe)
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
      '[VLM] Installing mlx-vlm into ~/.escribano/venv (first run — this may take a few minutes)...'
    );
    // Ensure pip is available in the venv; ignore failures if ensurepip is disabled.
    try {
      await runVisible(ESCRIBANO_VENV_PYTHON, ['-m', 'ensurepip', '--upgrade']);
    } catch {
      // ensurepip may be unavailable; continue and rely on existing pip if present.
    }
    await runVisible(ESCRIBANO_VENV_PYTHON, [
      '-m',
      'pip',
      'install',
      'mlx-vlm',
      'torch',
      'torchvision',
    ]);
    console.log('[VLM] mlx-vlm installed successfully.');
  }

  return ESCRIBANO_VENV_PYTHON;
}

/**
 * Resolve the Python executable to use for the MLX bridge.
 * If the user has configured an explicit environment, use it.
 * Otherwise, transparently create and populate ~/.escribano/venv.
 */
export async function resolvePythonPath(): Promise<string> {
  return getPythonPath() ?? ensureEscribanoVenv();
}

// Global cleanup function to track the current bridge instance
let globalCleanup: (() => void) | null = null;

/**
 * Cleanup the MLX bridge process.
 * Should be called explicitly before process exit.
 */
export function cleanupMlxBridge(): void {
  if (globalCleanup) {
    debugLog('Explicit cleanup called');
    globalCleanup();
    globalCleanup = null;
  }
}

/**
 * Create MLX-VLM intelligence service.
 *
 * Note: This adapter only implements describeImages() for VLM processing.
 * Other methods (classify, generate, etc.) are not implemented and will throw.
 */
export function createMlxIntelligenceService(
  _config: Partial<IntelligenceConfig> = {}
): IntelligenceService & ResourceTrackable {
  const mlxConfig = { ...DEFAULT_CONFIG };
  const bridge: BridgeState = {
    process: null,
    socket: null,
    ready: false,
    connecting: false,
  };

  // Cleanup on process exit
  const cleanup = (): void => {
    if (bridge.socket) {
      try {
        bridge.socket.destroy();
      } catch {
        // Ignore
      }
      bridge.socket = null;
    }
    if (bridge.process) {
      try {
        bridge.process.kill('SIGTERM');
      } catch {
        // Ignore
      }
      bridge.process = null;
    }
    // Clean up socket file if it exists
    if (existsSync(mlxConfig.socketPath)) {
      try {
        unlinkSync(mlxConfig.socketPath);
      } catch {
        // Ignore
      }
    }
    bridge.ready = false;
  };

  // Register global cleanup
  globalCleanup = cleanup;

  // Also cleanup on process signals
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);

  // Cleanup on beforeExit to ensure it runs before process.exit
  process.on('beforeExit', cleanup);

  /**
   * Start the Python bridge process.
   */
  const startBridge = async (): Promise<void> => {
    if (bridge.process && bridge.ready) {
      return;
    }

    debugLog('Starting MLX bridge...');

    // Resolve (and if needed, auto-create) the Python environment before spawning.
    const pythonPath = await resolvePythonPath();
    debugLog(`Using Python: ${pythonPath}`);

    return new Promise((resolve, reject) => {
      bridge.process = spawn(pythonPath, [mlxConfig.bridgeScript], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ESCRIBANO_VLM_MODEL: mlxConfig.model,
          ESCRIBANO_VLM_BATCH_SIZE: String(mlxConfig.batchSize),
          ESCRIBANO_VLM_MAX_TOKENS: String(mlxConfig.maxTokens),
          ESCRIBANO_MLX_SOCKET_PATH: mlxConfig.socketPath,
        },
      });

      if (!bridge.process.stdout || !bridge.process.stderr) {
        reject(new Error('Failed to create bridge process streams'));
        return;
      }

      // Handle stdout (ready signal is JSON on first line)
      let readyReceived = false;
      bridge.process.stdout.on('data', (data: Buffer) => {
        const lines = data.toString().trim().split('\n');
        for (const line of lines) {
          if (!readyReceived && line.startsWith('{')) {
            try {
              const msg = JSON.parse(line);
              if (msg.status === 'ready') {
                readyReceived = true;
                bridge.ready = true;
                debugLog(`Bridge ready: ${msg.model}`);
                resolve();
              }
            } catch {
              // Not JSON, ignore
            }
          }
        }
      });

      // Handle stderr (logs from Python)
      bridge.process.stderr.on('data', (data: Buffer) => {
        const text = data.toString().trim();
        if (text) {
          console.log(text);
        }
      });

      // Handle process exit
      bridge.process.on('exit', (code, signal) => {
        debugLog(`Bridge exited: code=${code} signal=${signal}`);
        bridge.process = null;
        bridge.ready = false;
        if (!readyReceived) {
          reject(new Error(`Bridge failed to start: exit code ${code}`));
        }
      });

      bridge.process.on('error', (err) => {
        debugLog(`Bridge error: ${err.message}`);
        if (!readyReceived) {
          reject(new Error(`Failed to start bridge: ${err.message}`));
        }
      });

      // Timeout for ready signal
      setTimeout(() => {
        if (!readyReceived) {
          reject(
            new Error(
              `Bridge startup timeout (${mlxConfig.startupTimeout / 1000}s)`
            )
          );
        }
      }, mlxConfig.startupTimeout);
    });
  };

  /**
   * Connect to the Unix socket.
   */
  const connect = (): Promise<Socket> => {
    return new Promise((resolve, reject) => {
      if (bridge.socket && !bridge.socket.destroyed) {
        resolve(bridge.socket);
        return;
      }

      debugLog(`Connecting to socket: ${mlxConfig.socketPath}`);

      const client = createConnection(mlxConfig.socketPath);

      client.on('connect', () => {
        debugLog('Socket connected');
        bridge.socket = client;
        resolve(client);
      });

      client.on('error', (err) => {
        debugLog(`Socket error: ${err.message}`);
        bridge.socket = null;
        reject(new Error(`Socket connection failed: ${err.message}`));
      });

      client.on('close', () => {
        debugLog('Socket closed');
        bridge.socket = null;
      });

      // Timeout
      setTimeout(() => {
        if (!bridge.socket) {
          client.destroy();
          reject(new Error('Socket connection timeout'));
        }
      }, 5000);
    });
  };

  /**
   * Send request and receive streaming NDJSON responses.
   */
  const sendRequest = async <T>(
    request: { id: number; method: string; params: Record<string, unknown> },
    onBatch?: (
      response: T,
      progress: { current: number; total: number }
    ) => void
  ): Promise<T[]> => {
    // Ensure bridge is running
    if (!bridge.ready) {
      await startBridge();
    }

    // Connect to socket
    const socket = await connect();

    return new Promise((resolve, reject) => {
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
              // Error response
              reject(new Error(response.error));
              socket.off('data', onData);
              return;
            }

            if ('done' in response && response.done) {
              // Final response
              socket.off('data', onData);
              resolve(responses);
              return;
            }

            // Batch response
            responses.push(response);
            if (onBatch && 'progress' in response) {
              const resp = response as T & {
                progress: { current: number; total: number };
              };
              onBatch(response, resp.progress);
            }
          } catch {
            debugLog(`Failed to parse response: ${line}`);
            // Continue processing, might be partial
          }
        }
      };

      socket.on('data', onData);
      socket.on('error', (err) => {
        socket.off('data', onData);
        reject(new Error(`Socket error: ${err.message}`));
      });

      // Send request
      const requestJson = `${JSON.stringify(request)}\n`;
      debugLog(`Sending request: id=${request.id} method=${request.method}`);
      socket.write(requestJson);
    });
  };

  // Return IntelligenceService implementation
  return {
    /**
     * Classify transcript - NOT IMPLEMENTED for MLX backend.
     */
    async classify(
      _transcript: Transcript,
      _visualLogs?: VisualLog[]
    ): Promise<Classification> {
      throw new Error(
        'MLX adapter does not support classify(). Use Ollama backend for this operation.'
      );
    },

    /**
     * Classify segment - NOT IMPLEMENTED for MLX backend.
     */
    async classifySegment(
      _segment: unknown,
      _transcript?: Transcript
    ): Promise<Classification> {
      throw new Error(
        'MLX adapter does not support classifySegment(). Use Ollama backend for this operation.'
      );
    },

    /**
     * Extract metadata - NOT IMPLEMENTED for MLX backend.
     */
    async extractMetadata(
      _transcript: Transcript,
      _classification: Classification,
      _visualLogs?: VisualLog[]
    ): Promise<TranscriptMetadata> {
      throw new Error(
        'MLX adapter does not support extractMetadata(). Use Ollama backend for this operation.'
      );
    },

    /**
     * Generate artifact - NOT IMPLEMENTED for MLX backend.
     */
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
        'MLX adapter does not support generate(). Use Ollama backend for this operation.'
      );
    },

    /**
     * Describe images using MLX-VLM with interleaved batching.
     *
     * This is the primary method for VLM frame processing.
     */
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

            // Fire callback for each frame
            if (options.onImageProcessed) {
              options.onImageProcessed(result, progress);
            }
          }

          // Log progress every 10 frames
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

    /**
     * Embed text - NOT IMPLEMENTED for MLX backend.
     */
    async embedText(
      _texts: string[],
      _options?: { batchSize?: number }
    ): Promise<number[][]> {
      throw new Error(
        'MLX adapter does not support embedText(). Use Ollama backend for this operation.'
      );
    },

    /**
     * Extract topics - NOT IMPLEMENTED for MLX backend.
     */
    async extractTopics(_observations: DbObservation[]): Promise<string[]> {
      throw new Error(
        'MLX adapter does not support extractTopics(). Use Ollama backend for this operation.'
      );
    },

    /**
     * Generate text - NOT IMPLEMENTED for MLX backend.
     */
    async generateText(
      _prompt: string,
      _options?: { model?: string; expectJson?: boolean }
    ): Promise<string> {
      throw new Error(
        'MLX adapter does not support generateText(). Use Ollama backend for this operation.'
      );
    },

    getResourceName(): string {
      return 'mlx-python';
    },

    getPid(): number | null {
      return bridge.process?.pid ?? null;
    },
  };
}
