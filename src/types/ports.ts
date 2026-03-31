/**
 * Escribano - Port Interfaces
 *
 * Service port interfaces for external system adapters.
 * Extracted from 0_types.ts for better organization.
 */

import type { DbObservation } from '../db/types.js';
import type {
  Artifact,
  ArtifactType,
  Classification,
  Recording,
  Session,
  SessionSegment,
  Transcript,
  TranscriptMetadata,
  VisualIndex,
  VisualLog,
} from './schemas.js';

// =============================================================================
// PORTS (Interfaces)
// =============================================================================

export interface PublishingService {
  ensureCollection(name: string): Promise<{ id: string }>;

  createDocument(params: {
    collectionId: string;
    title: string;
    content: string;
    parentDocumentId?: string;
    publish?: boolean;
  }): Promise<{ id: string; url: string }>;

  updateDocument(
    id: string,
    params: {
      title?: string;
      content?: string;
    }
  ): Promise<void>;

  findDocumentByTitle(
    collectionId: string,
    title: string
  ): Promise<{ id: string; url: string } | null>;

  listDocuments(collectionId: string): Promise<
    Array<{
      id: string;
      title: string;
      parentDocumentId?: string;
      url: string;
    }>
  >;
}

export interface TranscriptionService {
  transcribe(audioPath: string): Promise<Transcript>;
  transcribeSegment(audioPath: string): Promise<string>;
}

export interface CaptureSource {
  getLatestRecording(): Promise<Recording | null>;
  listRecordings(limit?: number): Promise<Recording[]>;
}

/**
 * Result from LLM text generation with optional token metadata for benchmarking
 */
export interface GenerateTextResult {
  text: string;
  tokenMetadata?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

export interface IntelligenceService {
  classify(
    transcript: Transcript,
    visualLogs?: VisualLog[]
  ): Promise<Classification>;
  classifySegment(
    segment: SessionSegment,
    transcript?: Transcript
  ): Promise<Classification>;
  extractMetadata(
    transcript: Transcript,
    classification: Classification,
    visualLogs?: VisualLog[]
  ): Promise<TranscriptMetadata>;
  /** Sequential VLM processing - one image per request for accurate image-description mapping. */
  describeImages(
    images: Array<{ imagePath: string; timestamp: number }>,
    config?: {
      model?: string;
      recordingId?: string;
      onImageProcessed?: (
        result: {
          index: number;
          timestamp: number;
          imagePath: string;
          activity: string;
          description: string;
          apps: string[];
          topics: string[];
        },
        progress: { current: number; total: number }
      ) => void;
    }
  ): Promise<
    Array<{
      index: number;
      timestamp: number;
      activity: string;
      description: string;
      apps: string[];
      topics: string[];
      imagePath: string;
      raw_response?: string;
    }>
  >;
  generate(
    artifactType: ArtifactType,
    context: {
      transcript: Transcript;
      classification: Classification;
      metadata: TranscriptMetadata | null;
      visualLogs?: VisualLog[];
    }
  ): Promise<string>;
  extractTopics(observations: DbObservation[]): Promise<string[]>;
  generateText(
    prompt: string,
    options?: {
      model?: string;
      expectJson?: boolean;
      numPredict?: number;
      think?: boolean;
      debugContext?: {
        recordingId?: string;
        artifactId?: string;
        callType: 'subject_grouping' | 'artifact_generation';
      };
    }
  ): Promise<string>;
  /** Load LLM model into the bridge (MLX adapter only). */
  loadLlm?(model: string): Promise<void>;
  /** Unload VLM model to free memory (MLX adapter only). */
  unloadVlm?(): Promise<void>;
  /** Unload LLM model to free memory (MLX adapter only). */
  unloadLlm?(): Promise<void>;
}

export interface StorageService {
  saveSession(session: Session): Promise<void>;
  loadSession(sessionId: string): Promise<Session | null>;
  listSessions(): Promise<Session[]>;
  saveArtifact(sessionId: string, artifact: Artifact): Promise<void>;
  loadArtifacts(sessionId: string): Promise<Artifact[]>;
}

export interface VideoService {
  extractFramesAtTimestamps(
    videoPath: string,
    timestamps: number[],
    outputDir: string
  ): Promise<string[]>;
  extractFramesAtInterval(
    videoPath: string,
    threshold: number,
    outputDir: string
  ): Promise<Array<{ imagePath: string; timestamp: number }>>;
  extractFramesAtTimestampsBatch(
    videoPath: string,
    timestamps: number[],
    outputDir: string,
    concurrency?: number
  ): Promise<Array<{ imagePath: string; timestamp: number }>>;
  getMetadata(videoPath: string): Promise<{
    duration: number;
    width: number;
    height: number;
  }>;
  runVisualIndexing(
    framesDir: string,
    outputPath: string
  ): Promise<VisualIndex>;
  detectSceneChanges(
    videoPath: string,
    config?: { threshold?: number; minInterval?: number }
  ): Promise<number[]>;
}
