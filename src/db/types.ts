/**
 * Manual Database Types for SQLite
 * (Fallback when kysely-codegen is unavailable)
 */

export interface DbRecording {
  id: string;
  video_path: string | null;
  audio_mic_path: string | null;
  audio_system_path: string | null;
  duration: number;
  captured_at: string;
  status: 'raw' | 'processing' | 'processed' | 'error';
  processing_step:
    | 'extraction'
    | 'vad'
    | 'transcription'
    | 'clustering'
    | 'context_derivation'
    | 'block_formation'
    | 'complete'
    | null;
  source_type: 'cap' | 'meetily' | 'raw';
  source_metadata: string | null; // JSON
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export type DbRecordingInsert = Omit<DbRecording, 'created_at' | 'updated_at'>;

export interface DbObservation {
  id: string;
  recording_id: string;
  type: 'visual' | 'audio';
  timestamp: number;
  end_timestamp: number | null;
  image_path: string | null;
  ocr_text: string | null;
  vlm_description: string | null;
  text: string | null;
  audio_source: 'mic' | 'system' | null;
  audio_type: 'speech' | 'music' | 'silence' | null;
  embedding: Buffer | null;
  created_at: string;
}

export type DbObservationInsert = Omit<DbObservation, 'created_at'>;

export interface DbContext {
  id: string;
  type: string;
  name: string;
  metadata: string | null; // JSON
  created_at: string;
}

export type DbContextInsert = Omit<DbContext, 'created_at'>;

export interface DbObservationContext {
  observation_id: string;
  context_id: string;
  confidence: number | null;
}

export interface DbTopicBlock {
  id: string;
  recording_id: string;
  context_ids: string; // JSON array
  classification: string | null; // JSON
  duration: number | null;
  created_at: string;
}

export type DbTopicBlockInsert = Omit<DbTopicBlock, 'created_at'>;

export interface DbArtifact {
  id: string;
  type: string;
  content: string;
  format: string;
  source_block_ids: string | null; // JSON array
  source_context_ids: string | null; // JSON array
  created_at: string;
  updated_at: string;
}

export type DbArtifactInsert = Omit<DbArtifact, 'created_at' | 'updated_at'>;
