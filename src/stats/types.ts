export type RunType = 'initial' | 'resume' | 'force';
export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled';
export type PhaseStatus =
  | 'running'
  | 'success'
  | 'skipped'
  | 'failed'
  | 'cancelled';

export type PhaseName =
  | 'audio_vad'
  | 'audio_transcription'
  | 'video_frame_extraction'
  | 'video_scene_detection'
  | 'video_sampling'
  | 'vlm_inference'
  | 'segmentation'
  | 'temporal_alignment'
  | 'topic_blocks'
  | 'summary';

export interface RunStartEvent {
  runId: string;
  recordingId: string;
  runType: RunType;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface RunEndEvent {
  runId: string;
  status: RunStatus;
  timestamp: number;
  error?: string;
}

export interface PhaseStartEvent {
  runId: string;
  phaseId: string;
  phase: string;
  timestamp: number;
  itemsTotal?: number;
}

export interface PhaseEndEvent {
  runId: string;
  phaseId: string;
  status: PhaseStatus;
  timestamp: number;
  durationMs: number;
  itemsProcessed?: number;
  metadata?: Record<string, unknown>;
}

export interface DbProcessingRun {
  id: string;
  recording_id: string;
  run_type: RunType;
  status: RunStatus;
  started_at: string;
  completed_at: string | null;
  total_duration_ms: number | null;
  error_message: string | null;
  metadata: string | null;
}

export interface DbProcessingStat {
  id: string;
  run_id: string;
  phase: string;
  status: PhaseStatus;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  items_total: number | null;
  items_processed: number | null;
  metadata: string | null;
}

export interface DbProcessingRunInsert {
  id: string;
  recording_id: string;
  run_type: RunType;
  status: RunStatus;
  started_at: string;
  metadata?: string;
}

export interface DbProcessingStatInsert {
  id: string;
  run_id: string;
  phase: string;
  status: PhaseStatus;
  started_at: string;
  items_total?: number;
}

export interface StatsRepository {
  createRun(run: DbProcessingRunInsert): void;
  updateRun(
    id: string,
    updates: {
      status: RunStatus;
      completed_at: string;
      total_duration_ms: number;
      error_message?: string;
    }
  ): void;
  createStat(stat: DbProcessingStatInsert): void;
  updateStat(
    id: string,
    updates: {
      status: PhaseStatus;
      completed_at: string;
      duration_ms: number;
      items_processed?: number;
      metadata?: string;
    }
  ): void;
}

export interface ResourceTrackable {
  getResourceName(): string;
  getPid(): number | null;
}

export interface ResourceStats {
  peakMemoryMB: number;
  avgMemoryMB: number;
  peakCpuPercent: number;
  avgCpuPercent: number;
  sampleCount: number;
}

export interface ResourceSnapshot {
  [resourceName: string]: ResourceStats;
}

export interface SystemInfo {
  totalMemoryGB: number;
  cpuCores: number;
  platform: string;
}
