import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';

export interface StepResult {
  name: string;
  durationMs: number;
  status: 'success' | 'error';
  error?: string;
}

export interface PipelineState {
  recordingId: string;
  steps: StepResult[];
  verbose: boolean;
  startTime: number;
}

const storage = new AsyncLocalStorage<PipelineState>();

/**
 * Run a function within a pipeline context
 */
export async function withPipeline<T>(
  recordingId: string,
  fn: () => Promise<T>
): Promise<T> {
  const verbose = process.env.ESCRIBANO_VERBOSE === 'true';
  const state: PipelineState = {
    recordingId,
    steps: [],
    verbose,
    startTime: performance.now(),
  };

  console.log(`\n🚀 Pipeline: [${recordingId}]`);

  try {
    const result = await storage.run(state, fn);
    printSummary(state);
    return result;
  } catch (error) {
    printSummary(state);
    throw error;
  }
}

/**
 * Execute a named step within the current pipeline
 */
export async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const state = storage.getStore();
  if (!state) return fn();

  if (state.verbose) {
    console.log(`  ▶ ${name}`);
  }

  const start = performance.now();
  try {
    const result = await fn();
    const durationMs = performance.now() - start;
    state.steps.push({ name, durationMs, status: 'success' });

    if (!state.verbose) {
      console.log(
        `  ✅ ${name.padEnd(30, '.')} ${(durationMs / 1000).toFixed(1)}s`
      );
    } else {
      console.log(
        `  ✅ ${name} completed in ${(durationMs / 1000).toFixed(1)}s`
      );
    }

    return result;
  } catch (error) {
    const durationMs = performance.now() - start;
    const errorMessage = (error as Error).message;
    state.steps.push({
      name,
      durationMs,
      status: 'error',
      error: errorMessage,
    });

    console.error(
      `  ❌ ${name} failed after ${(durationMs / 1000).toFixed(1)}s: ${errorMessage}`
    );
    throw error;
  }
}

/**
 * Log a message within the current pipeline
 */
export function log(
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string
): void {
  const state = storage.getStore();
  if (!state) {
    if (level === 'error') console.error(message);
    else if (level === 'warn') console.warn(message);
    else console.log(message);
    return;
  }

  // Only show debug logs if verbose is enabled
  if (level === 'debug' && !state.verbose) return;

  const prefix = level === 'info' ? '    ' : `    [${level}] `;
  console.log(`${prefix}${message}`);
}

/**
 * Print the final pipeline summary
 */
function printSummary(state: PipelineState) {
  const totalDuration = (performance.now() - state.startTime) / 1000;
  console.log('─'.repeat(50));
  console.log(`🏁 Pipeline Finished: [${state.recordingId}]`);
  console.log(`📊 Total Duration: ${totalDuration.toFixed(1)}s`);
  console.log('─'.repeat(50));
}

/**
 * Get current pipeline state (useful for status inspection)
 */
export function getCurrentPipeline(): PipelineState | undefined {
  return storage.getStore();
}
