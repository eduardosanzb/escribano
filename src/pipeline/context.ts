import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import { generateId } from '../db/helpers.js';
import type { ResourceTracker } from '../stats/resource-tracker.js';
import type { ResourceSnapshot } from '../stats/types.js';
import { pipelineEvents } from './events.js';

export interface StepResult {
  name: string;
  durationMs: number;
  status: 'success' | 'error';
  error?: string;
}

export interface PipelineState {
  recordingId: string;
  runId: string;
  runType: 'initial' | 'resume' | 'force';
  steps: StepResult[];
  verbose: boolean;
  startTime: number;
}

const storage = new AsyncLocalStorage<PipelineState>();
let resourceTracker: ResourceTracker | null = null;

export function setResourceTracker(tracker: ResourceTracker): void {
  resourceTracker = tracker;
}

export function getResourceTracker(): ResourceTracker | null {
  return resourceTracker;
}

export function withPipeline<T>(
  recordingId: string,
  runType: 'initial' | 'resume' | 'force',
  metadata: Record<string, unknown> | undefined,
  fn: () => Promise<T>
): Promise<T> {
  const verbose = process.env.ESCRIBANO_VERBOSE === 'true';
  const runId = generateId();
  const startTime = performance.now();

  const state: PipelineState = {
    recordingId,
    runId,
    runType,
    steps: [],
    verbose,
    startTime,
  };

  console.log(`\n🚀 Pipeline: [${recordingId}] (${runType})`);

  pipelineEvents.emit('run:start', {
    runId,
    recordingId,
    runType,
    timestamp: Date.now(),
    metadata,
  });

  return storage.run(state, async () => {
    try {
      const result = await fn();
      const durationMs = performance.now() - startTime;

      pipelineEvents.emit('run:end', {
        runId,
        status: 'completed',
        timestamp: Date.now(),
        durationMs,
      });

      printSummary(state);
      return result;
    } catch (error) {
      const durationMs = performance.now() - startTime;
      const errorMessage = (error as Error).message;

      pipelineEvents.emit('run:end', {
        runId,
        status: 'failed',
        timestamp: Date.now(),
        durationMs,
        error: errorMessage,
      });

      printSummary(state);
      throw error;
    }
  });
}

export interface StepOptions {
  itemsTotal?: number;
}

export interface StepResultWithItems {
  itemsProcessed?: number;
}

export async function step<T>(
  name: string,
  fn: () => Promise<T | (T & StepResultWithItems)>,
  options?: StepOptions
): Promise<T> {
  const state = storage.getStore();
  if (!state) return fn() as Promise<T>;

  const phaseId = generateId();
  const start = performance.now();

  if (state.verbose) {
    console.log(`  ▶ ${name}`);
  }

  pipelineEvents.emit('phase:start', {
    runId: state.runId,
    phaseId,
    phase: name,
    timestamp: Date.now(),
    itemsTotal: options?.itemsTotal,
  });

  // Start resource tracking for this phase
  await resourceTracker?.start();

  try {
    const result = await fn();
    const durationMs = performance.now() - start;
    state.steps.push({ name, durationMs, status: 'success' });

    let itemsProcessed = (result as StepResultWithItems)?.itemsProcessed;
    if (itemsProcessed === undefined && Array.isArray(result)) {
      itemsProcessed = result.length;
    }

    // Stop resource tracking and get stats
    const resourceStats = resourceTracker?.stop();

    pipelineEvents.emit('phase:end', {
      runId: state.runId,
      phaseId,
      status: 'success',
      timestamp: Date.now(),
      durationMs,
      itemsProcessed,
      metadata: resourceStats ? { resources: resourceStats } : undefined,
    });

    const itemsInfo = options?.itemsTotal
      ? ` (${itemsProcessed ?? options.itemsTotal}/${options.itemsTotal})`
      : itemsProcessed
        ? ` (${itemsProcessed})`
        : '';

    if (!state.verbose) {
      console.log(
        `  ✅ ${name.padEnd(30, '.')} ${(durationMs / 1000).toFixed(1)}s${itemsInfo}`
      );
    } else {
      console.log(
        `  ✅ ${name} completed in ${(durationMs / 1000).toFixed(1)}s${itemsInfo}`
      );
    }

    return result as T;
  } catch (error) {
    const durationMs = performance.now() - start;
    const errorMessage = (error as Error).message;
    state.steps.push({
      name,
      durationMs,
      status: 'error',
      error: errorMessage,
    });

    // Stop resource tracking and get stats (even on error)
    const resourceStats = resourceTracker?.stop();

    pipelineEvents.emit('phase:end', {
      runId: state.runId,
      phaseId,
      status: 'failed',
      timestamp: Date.now(),
      durationMs,
      metadata: resourceStats ? { resources: resourceStats } : undefined,
    });

    console.error(
      `  ❌ ${name} failed after ${(durationMs / 1000).toFixed(1)}s: ${errorMessage}`
    );
    throw error;
  }
}

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

  if (level === 'debug' && !state.verbose) return;

  const prefix = level === 'info' ? '    ' : `    [${level}] `;
  console.log(`${prefix}${message}`);
}

function printSummary(state: PipelineState) {
  const totalDuration = (performance.now() - state.startTime) / 1000;
  console.log('─'.repeat(50));
  console.log(`🏁 Pipeline Finished: [${state.recordingId}]`);
  console.log(`📊 Total Duration: ${totalDuration.toFixed(1)}s`);
  console.log('─'.repeat(50));
}

export function getCurrentPipeline(): PipelineState | undefined {
  return storage.getStore();
}

export function getCurrentRunId(): string | undefined {
  return storage.getStore()?.runId;
}
