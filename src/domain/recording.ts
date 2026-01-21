import type { DbRecording } from '../0_types.js';

export type RecordingStatus = 'raw' | 'processing' | 'processed' | 'error';
export type ProcessingStep =
  // Audio pipeline
  | 'vad'
  | 'transcription'
  // Visual pipeline
  | 'frame_extraction'
  | 'ocr_processing'
  | 'embedding'
  // Context derivation phases
  | 'clustering'
  | 'vlm_enrichment'
  | 'signal_extraction'
  | 'cluster_merge'
  | 'context_creation'
  | 'block_formation'
  | 'complete';

export interface Recording {
  readonly id: string;
  readonly status: RecordingStatus;
  readonly processingStep: ProcessingStep | null;
  readonly errorMessage: string | null;
  readonly videoPath: string | null;
  readonly audioMicPath: string | null;
  readonly audioSystemPath: string | null;
  readonly capturedAt: string;
  readonly duration: number;
}

/**
 * Transition recording to processing state
 */
export function startProcessing(recording: Recording): Recording {
  return {
    ...recording,
    status: 'processing',
    processingStep: 'vad',
    errorMessage: null,
  };
}

/**
 * Advance to next processing step
 */
export function advanceStep(
  recording: Recording,
  step: ProcessingStep
): Recording {
  return {
    ...recording,
    processingStep: step,
  };
}

/**
 * Mark recording as successfully processed
 */
export function completeProcessing(recording: Recording): Recording {
  return {
    ...recording,
    status: 'processed',
    processingStep: null,
  };
}

/**
 * Mark recording as failed
 */
export function failProcessing(recording: Recording, error: string): Recording {
  return {
    ...recording,
    status: 'error',
    errorMessage: error,
    // Keep processingStep to know where we failed for resume
  };
}
