import { pipelineEvents } from '../pipeline/events.js';
import type { StatsRepository } from './types.js';

let currentRunId: string | null = null;
let statsRepo: StatsRepository | null = null;

export function setupStatsObserver(repo: StatsRepository): void {
  statsRepo = repo;

  pipelineEvents.on('run:start', (data) => {
    currentRunId = data.runId;
    repo.createRun({
      id: data.runId,
      recording_id: data.recordingId,
      run_type: data.runType,
      status: 'running',
      started_at: new Date(data.timestamp).toISOString(),
      metadata: data.metadata ? JSON.stringify(data.metadata) : undefined,
    });
  });

  pipelineEvents.on('run:end', (data) => {
    if (!currentRunId) return;

    const startedAt = data.timestamp;
    repo.updateRun(currentRunId, {
      status: data.status,
      completed_at: new Date(data.timestamp).toISOString(),
      total_duration_ms: data.durationMs,
      error_message: data.error,
    });

    if (data.status !== 'cancelled') {
      currentRunId = null;
    }
  });

  pipelineEvents.on('phase:start', (data) => {
    if (!data.runId) return;

    repo.createStat({
      id: data.phaseId,
      run_id: data.runId,
      phase: data.phase,
      status: 'running',
      started_at: new Date(data.timestamp).toISOString(),
      items_total: data.itemsTotal,
    });
  });

  pipelineEvents.on('phase:end', (data) => {
    repo.updateStat(data.phaseId, {
      status: data.status,
      completed_at: new Date(data.timestamp).toISOString(),
      duration_ms: data.durationMs,
      items_processed: data.itemsProcessed,
      metadata: data.metadata ? JSON.stringify(data.metadata) : undefined,
    });
  });
}

export function cancelCurrentRun(): void {
  if (currentRunId && statsRepo) {
    statsRepo.updateRun(currentRunId, {
      status: 'cancelled',
      completed_at: new Date().toISOString(),
      total_duration_ms: 0,
    });
    currentRunId = null;
  }
}

export function getCurrentRunId(): string | null {
  return currentRunId;
}
