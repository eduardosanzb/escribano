import { generateId } from '../db/helpers.js';

export interface AudioObservation {
  readonly id: string;
  readonly recordingId: string;
  readonly type: 'audio';
  readonly timestamp: number;
  readonly endTimestamp: number;
  readonly text: string;
  readonly audioSource: 'mic' | 'system';
  readonly audioType: 'speech' | 'music' | 'silence';
  readonly confidence: number | null;
}

export interface VisualObservation {
  readonly id: string;
  readonly recordingId: string;
  readonly type: 'visual';
  readonly timestamp: number;
  readonly imagePath: string;
  readonly ocrText: string | null;
  readonly vlmDescription: string | null;
}

export type Observation = AudioObservation | VisualObservation;

/**
 * Factory for audio observations
 */
export function createAudioObservation(params: {
  recordingId: string;
  timestamp: number;
  endTimestamp: number;
  text: string;
  audioSource: 'mic' | 'system';
  confidence?: number;
}): AudioObservation {
  return {
    id: generateId(),
    recordingId: params.recordingId,
    type: 'audio',
    timestamp: params.timestamp,
    endTimestamp: params.endTimestamp,
    text: params.text,
    audioSource: params.audioSource,
    audioType: 'speech',
    confidence: params.confidence ?? null,
  };
}
