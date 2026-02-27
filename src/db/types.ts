/**
 * Manual Database Types for SQLite
 */

export interface DbRecording {
  id: string;
  video_path: string | null;
  audio_mic_path: string | null;
  audio_system_path: string | null;
  duration: number;
  captured_at: string;
  status: 'raw' | 'processing' | 'processed' | 'published' | 'error';
  processing_step:
    | 'vad'
    | 'transcription'
    | 'frame_extraction'
    | 'ocr_processing'
    | 'embedding'
    | 'clustering'
    | 'vlm_enrichment'
    | 'signal_extraction'
    | 'cluster_merge'
    | 'context_creation'
    | 'block_formation'
    | 'complete'
    | null;
  source_type: 'cap' | 'meetily' | 'raw' | 'file';
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
  vlm_raw_response: string | null;
  activity_type: string | null;
  apps: string | null;
  topics: string | null;
  text: string | null;
  audio_source: 'mic' | 'system' | null;
  audio_type: 'speech' | 'music' | 'silence' | null;
  embedding: Buffer | null;
  created_at: string;
}

export type DbObservationInsert = Omit<DbObservation, 'created_at'>;

export interface DbCluster {
  id: string;
  recording_id: string;
  type: 'visual' | 'audio';
  start_timestamp: number;
  end_timestamp: number;
  observation_count: number;
  centroid: Buffer | null;
  classification: string | null; // JSON
  metadata: string | null; // JSON
  created_at: string;
}

export type DbClusterInsert = Omit<DbCluster, 'created_at'>;

export interface DbObservationCluster {
  observation_id: string;
  cluster_id: string;
  distance: number | null;
}

export interface DbClusterMerge {
  visual_cluster_id: string;
  audio_cluster_id: string;
  similarity_score: number;
  merge_reason: string | null;
}

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
  recording_id: string | null;
  type: string;
  content: string;
  format: string;
  source_block_ids: string | null;
  source_context_ids: string | null;
  created_at: string;
  updated_at: string;
}

export type DbArtifactInsert = Omit<DbArtifact, 'created_at' | 'updated_at'>;

export interface DbSubject {
  id: string;
  recording_id: string;
  label: string;
  is_personal: number;
  duration: number;
  activity_breakdown: string | null;
  metadata: string | null;
  created_at: string;
}

export type DbSubjectInsert = Omit<DbSubject, 'created_at'>;

export interface DbSubjectTopicBlock {
  subject_id: string;
  topic_block_id: string;
}

export interface DbArtifactSubject {
  artifact_id: string;
  subject_id: string;
}
