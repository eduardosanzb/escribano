/**
 * Escribano - Repository Interfaces
 *
 * Storage port interfaces for all database repositories.
 * Extracted from 0_types.ts for better organization.
 */

import type {
  DbArtifact,
  DbArtifactInsert,
  DbArtifactSubject,
  DbContext,
  DbContextInsert,
  DbFrame,
  DbFrameInsert,
  DbObservation,
  DbObservationContext,
  DbObservationInsert,
  DbProcessLock,
  DbRecording,
  DbRecordingInsert,
  DbSubject,
  DbSubjectInsert,
  DbSubjectTopicBlock,
  DbTopicBlock,
  DbTopicBlockInsert,
} from '../db/types.js';

import type { StatsRepository } from '../stats/types.js';

export type {
  DbArtifact,
  DbArtifactInsert,
  DbArtifactSubject,
  DbContext,
  DbContextInsert,
  DbFrame,
  DbFrameInsert,
  DbObservation,
  DbObservationContext,
  DbObservationInsert,
  DbProcessLock,
  DbRecording,
  DbRecordingInsert,
  DbSubject,
  DbSubjectInsert,
  DbSubjectTopicBlock,
  DbTopicBlock,
  DbTopicBlockInsert,
  StatsRepository,
};

// =============================================================================
// REPOSITORY INTERFACES (v2 - Storage Ports)
// =============================================================================

export interface FrameRepository {
  findById(id: string): DbFrame | null;
  /** Claim a batch of frames for analysis by a specific lock ID */
  claimFrames(lockId: string, limit: number, expiryMinutes?: number): DbFrame[];
  markAnalyzed(id: string): void;
  markFailed(id: string, error?: string): void;
  /** Release locks that have expired */
  releaseStaleLocks(): number;
  delete(id: string): void;
  getPendingCount(): number;
}

export interface RecordingRepository {
  findById(id: string): DbRecording | null;
  findByStatus(status: DbRecording['status']): DbRecording[];
  findPending(): DbRecording[];
  save(recording: DbRecordingInsert): void;
  updateStatus(
    id: string,
    status: DbRecording['status'],
    step?: DbRecording['processing_step'],
    error?: string | null
  ): void;
  updateMetadata(id: string, metadata: string): void;
  delete(id: string): void;
}

export interface ObservationRepository {
  findById(id: string): DbObservation | null;
  findByRecording(recordingId: string): DbObservation[];
  findByRecordingAndType(
    recordingId: string,
    type: 'visual' | 'audio'
  ): DbObservation[];
  findByContext(contextId: string): DbObservation[];
  save(observation: DbObservationInsert): void;
  saveBatch(observations: DbObservationInsert[]): void;
  updateEmbedding(id: string, embedding: number[]): void;
  updateVLMDescription(id: string, description: string): void;
  delete(id: string): void;
  deleteByRecording(recordingId: string): void;
}

export interface ContextRepository {
  findById(id: string): DbContext | null;
  findByTypeAndName(type: string, name: string): DbContext | null;
  findAll(): DbContext[];
  save(context: DbContextInsert): void;
  saveOrIgnore(context: DbContextInsert): void;
  linkObservation(
    observationId: string,
    contextId: string,
    confidence?: number
  ): void;
  unlinkObservation(observationId: string, contextId: string): void;
  getObservationLinks(contextId: string): DbObservationContext[];
  getObservationLinksByObservation(
    observationId: string
  ): DbObservationContext[];
  getLinksByRecording(recordingId: string): DbObservationContext[];
  delete(id: string): void;
}

export interface TopicBlockRepository {
  findById(id: string): DbTopicBlock | null;
  findByRecording(recordingId: string): DbTopicBlock[];
  findByContext(contextId: string): DbTopicBlock[]; // Cross-recording!
  save(block: DbTopicBlockInsert): void;
  delete(id: string): void;
  deleteByRecording(recordingId: string): void;
}

export interface ArtifactRepository {
  findById(id: string): DbArtifact | null;
  findByType(type: string): DbArtifact[];
  findByBlock(blockId: string): DbArtifact[];
  findByContext(contextId: string): DbArtifact[];
  findByRecording(recordingId: string): DbArtifact[];
  save(artifact: DbArtifactInsert): void;
  update(id: string, content: string): void;
  delete(id: string): void;
  deleteByRecording(recordingId: string): void;
  linkSubjects(artifactId: string, subjectIds: string[]): void;
  findSubjectsByArtifact(artifactId: string): DbArtifactSubject[];
}

export interface SubjectRepository {
  findById(id: string): DbSubject | null;
  findByRecording(recordingId: string): DbSubject[];
  save(subject: DbSubjectInsert): void;
  saveBatch(subjects: DbSubjectInsert[]): void;
  linkTopicBlocksBatch(
    links: Array<{ subjectId: string; topicBlockId: string }>
  ): void;
  getTopicBlocks(subjectId: string): DbTopicBlock[];
  deleteByRecording(recordingId: string): void;
}

export interface Repositories {
  recordings: RecordingRepository;
  observations: ObservationRepository;
  contexts: ContextRepository;
  topicBlocks: TopicBlockRepository;
  artifacts: ArtifactRepository;
  subjects: SubjectRepository;
  frames: FrameRepository;
  stats: StatsRepository;
}
