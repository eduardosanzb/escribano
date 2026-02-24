/**
 * Escribano - Core Types
 *
 * All types and interfaces in one place.
 */

import { z } from 'zod';

// =============================================================================
// RECORDING
// =============================================================================

export const recordingSchema = z.object({
  id: z.string(),
  source: z.object({
    type: z.enum(['cap', 'meetily', 'raw']),
    originalPath: z.string(),
    metadata: z.record(z.string(), z.any()).optional(),
  }),
  videoPath: z.string().nullable(),
  audioMicPath: z.string().nullable(),
  audioSystemPath: z.string().nullable(),
  duration: z.number(),
  capturedAt: z.date(),
});
export type Recording = z.infer<typeof recordingSchema>;

// =============================================================================
// TRANSCRIPT
// =============================================================================

export const transcriptSegmentSchema = z.object({
  id: z.string(),
  start: z.number(),
  end: z.number(),
  text: z.string(),
  speaker: z.string().nullable().optional(),
});

export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;

export const transcriptSchema = z.object({
  fullText: z.string(),
  segments: z.array(transcriptSegmentSchema),
  language: z.string().default('en'),
  duration: z.number(),
});
export type Transcript = z.infer<typeof transcriptSchema>;

// =============================================================================
// SESSION
// =============================================================================

// Tagged transcript to identify audio source
export const taggedTranscriptSchema = z.object({
  source: z.enum(['mic', 'system']),
  transcript: transcriptSchema,
});

export type TaggedTranscript = z.infer<typeof taggedTranscriptSchema>;

// =============================================================================
// CLASSIFICATION
// =============================================================================

export const sessionTypeSchema = z.enum([
  'meeting',
  'debugging',
  'tutorial',
  'learning',
  'working',
]);

export type SessionType = z.infer<typeof sessionTypeSchema>;

export const classificationSchema = z.object({
  meeting: z.number().min(0).max(100),
  debugging: z.number().min(0).max(100),
  tutorial: z.number().min(0).max(100),
  learning: z.number().min(0).max(100),
  working: z.number().min(0).max(100),
});

export type Classification = z.infer<typeof classificationSchema>;

// =============================================================================
// TRANSCRIPT METADATA
// =============================================================================

const speakerSchema = z.object({
  name: z.string(),
  role: z.string().optional(),
});

const keyMomentSchema = z.object({
  timestamp: z.number(),
  description: z.string(),
  importance: z.enum(['high', 'medium', 'low']),
});

const actionItemSchema = z.object({
  description: z.string(),
  owner: z.string().nullable(),
  priority: z.enum(['high', 'medium', 'low']).optional(),
});

const technicalTermSchema = z.object({
  term: z.string(),
  context: z.string(),
  type: z.enum(['error', 'file', 'function', 'variable', 'other']),
});

const codeSnippetSchema = z.object({
  language: z.string().optional(),
  code: z.string(),
  description: z.string().optional(),
  timestamp: z.number().optional(),
});

export const transcriptMetadataSchema = z.object({
  speakers: z.array(speakerSchema).optional(),
  keyMoments: z.array(keyMomentSchema).optional(),
  actionItems: z.array(actionItemSchema).optional(),
  technicalTerms: z.array(technicalTermSchema).optional(),
  codeSnippets: z.array(codeSnippetSchema).optional(),
});

export type TranscriptMetadata = z.infer<typeof transcriptMetadataSchema>;

// =============================================================================
// ARTIFACTS
// =============================================================================

export const artifactTypeSchema = z.enum([
  'summary',
  'action-items',
  'runbook',
  'step-by-step',
  'notes',
  'code-snippets',
  'blog-research',
  'blog-draft',
]);

export type ArtifactType = z.infer<typeof artifactTypeSchema>;

export const artifactSchema = z.object({
  id: z.string(),
  type: artifactTypeSchema,
  content: z.string(),
  format: z.enum(['markdown']).default('markdown'),
  createdAt: z.date(),
});

export type Artifact = z.infer<typeof artifactSchema>;

// =============================================================================
// VISUAL LOG
// =============================================================================

export const visualLogEntrySchema = z.object({
  timestamp: z.number(),
  imagePath: z.string(),
  description: z.string().optional(),
  ocrSummary: z.string().optional(),
  heuristicLabel: z.string().optional(),
  sceneScore: z.number().optional(),
});
export type VisualLogEntry = z.infer<typeof visualLogEntrySchema>;

export const visualLogSchema = z.object({
  entries: z.array(visualLogEntrySchema),
  source: z.enum(['screen', 'camera']).default('screen'),
});
export type VisualLog = z.infer<typeof visualLogSchema>;

// =============================================================================
// VISUAL ANALYSIS (External Tool Output)
// =============================================================================

export const visualIndexFrameSchema = z.object({
  index: z.number(),
  timestamp: z.number(),
  imagePath: z.string(),
  ocrText: z.string(),
  clusterId: z.number(),
  changeScore: z.number(),
});
export type VisualIndexFrame = z.infer<typeof visualIndexFrameSchema>;

export const visualIndexClusterSchema = z.object({
  id: z.number(),
  heuristicLabel: z.string(),
  timeRange: z.tuple([z.number(), z.number()]),
  frameCount: z.number(),
  representativeIdx: z.number(),
  avgOcrCharacters: z.number(),
  mediaIndicators: z.array(z.string()),
});
export type VisualIndexCluster = z.infer<typeof visualIndexClusterSchema>;

export const visualIndexSchema = z.object({
  frames: z.array(visualIndexFrameSchema),
  clusters: z.array(visualIndexClusterSchema),
  processingTime: z.object({
    ocrMs: z.number(),
    clipMs: z.number(),
    totalMs: z.number(),
  }),
});
export type VisualIndex = z.infer<typeof visualIndexSchema>;

export const visualDescriptionSchema = z.object({
  clusterId: z.number(),
  timestamp: z.number(),
  description: z.string(),
});
export type VisualDescription = z.infer<typeof visualDescriptionSchema>;

export const visualDescriptionsSchema = z.object({
  descriptions: z.array(visualDescriptionSchema),
  processingTime: z.object({
    vlmMs: z.number(),
    framesProcessed: z.number(),
  }),
});
export type VisualDescriptions = z.infer<typeof visualDescriptionsSchema>;

// =============================================================================
// INTELLIGENCE & EMBEDDINGS
// =============================================================================

export const activityContextSchema = z.object({
  type: z.enum(['url', 'file', 'app', 'topic', 'unknown']),
  value: z.string(),
  confidence: z.number().min(0).max(1),
});
export type ActivityContext = z.infer<typeof activityContextSchema>;

export const sessionSegmentSchema = z.object({
  id: z.string(),
  timeRange: z.tuple([z.number(), z.number()]),
  visualClusterIds: z.array(z.number()),
  contexts: z.array(activityContextSchema),
  transcriptSlice: taggedTranscriptSchema.nullable(),
  classification: classificationSchema.nullable(),
  isNoise: z.boolean(),
});
export type SessionSegment = z.infer<typeof sessionSegmentSchema>;

export const embeddingConfigSchema = z.object({
  model: z.string().default('qwen3-embedding:8b'),
  similarityThreshold: z.number().min(0).max(1).default(0.4),
});
export type EmbeddingConfig = z.infer<typeof embeddingConfigSchema>;

// =============================================================================
// SESSION
// =============================================================================

export const outlineSyncStateSchema = z.object({
  collectionId: z.string(),
  sessionDocumentId: z.string(),
  sessionDocumentUrl: z.string(),
  artifacts: z.array(
    z.object({
      type: artifactTypeSchema,
      documentId: z.string(),
      documentUrl: z.string(),
      syncedAt: z.date(),
      contentHash: z.string(),
    })
  ),
  lastSyncedAt: z.date(),
});

export type OutlineSyncState = z.infer<typeof outlineSyncStateSchema>;

export const sessionSchema = z.object({
  id: z.string(),
  recording: recordingSchema,
  transcripts: z.array(taggedTranscriptSchema),
  visualLogs: z.array(visualLogSchema).default([]),
  segments: z.array(sessionSegmentSchema).default([]),
  status: z.enum([
    'raw',
    'transcribed',
    'visual-logged',
    'classified',
    'metadata-extracted',
    'complete',
    'error',
  ]),
  classification: classificationSchema.nullable(),
  metadata: transcriptMetadataSchema.nullable(),
  artifacts: z.array(artifactSchema).default([]),
  outlineSyncState: outlineSyncStateSchema.nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
  errorMessage: z.string().nullable().optional(),
});
export type Session = z.infer<typeof sessionSchema>;

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

export interface EmbeddingBatchOptions {
  /** Signal to abort the request */
  signal?: AbortSignal;
}

export interface EmbeddingService {
  embed(text: string, taskType?: 'clustering' | 'retrieval'): Promise<number[]>;
  embedBatch(
    texts: string[],
    taskType?: 'clustering' | 'retrieval',
    options?: EmbeddingBatchOptions
  ): Promise<number[][]>;
  similarity(a: number[], b: number[]): number;
  /** Compute centroid (average) of multiple embeddings */
  centroid(embeddings: number[][]): number[];
}

export interface CaptureSource {
  getLatestRecording(): Promise<Recording | null>;
  listRecordings(limit?: number): Promise<Recording[]>;
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
  embedText(
    texts: string[],
    options?: { batchSize?: number }
  ): Promise<number[][]>;
  extractTopics(observations: DbObservation[]): Promise<string[]>;
  generateText(
    prompt: string,
    options?: { model?: string; expectJson?: boolean }
  ): Promise<string>;
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

// =============================================================================
// CONFIG
// =============================================================================

export const capConfigSchema = z.object({
  recordingsPath: z
    .string()
    .default('~/Library/Application Support/so.cap.desktop/recordings'),
});
export type CapConfig = z.infer<typeof capConfigSchema>;

export const whisperConfigSchema = z.object({
  binaryPath: z.string().default('whisper-cli'),
  model: z.string().default('large-v3'),
  cwd: z.string().optional(),
  outputFormat: z.enum(['json', 'txt', 'srt', 'vtt']).default('json'),
  language: z.string().optional(),
});
export type WhisperConfig = z.infer<typeof whisperConfigSchema>;

export const intelligenceConfigSchema = z.object({
  provider: z.enum(['ollama', 'mlx']).default('ollama'),
  endpoint: z.string().default('http://localhost:11434/api/chat'),
  model: z.string().default('qwen3:8b'),
  generationModel: z.string().default('qwen3:32b'),
  visionModel: z.string().default('minicpm-v:8b'),
  maxRetries: z.number().default(3),
  timeout: z.number().default(600000), // 10 minutes
  keepAlive: z.string().default('10m'),
  maxContextSize: z.number().default(131072), // qwen3:8b supports up to 128K
  embedding: embeddingConfigSchema.default({
    model: 'nomic-embed-text',
    similarityThreshold: 0.75,
  }),
  // MLX-VLM specific config
  vlmBatchSize: z.number().default(4),
  vlmMaxTokens: z.number().default(2000),
  mlxSocketPath: z.string().default('/tmp/escribano-mlx.sock'),
});
export type IntelligenceConfig = z.infer<typeof intelligenceConfigSchema>;

export const DEFAULT_INTELLIGENCE_CONFIG: IntelligenceConfig =
  intelligenceConfigSchema.parse({});

const artifactConfigSchema = z.object({
  parallelGeneration: z.boolean().default(false),
  maxParallel: z.number().default(3),
  maxScreenshots: z.number().default(10),
});
type ArtifactConfig = z.infer<typeof artifactConfigSchema>;

export const outlineConfigSchema = z.object({
  url: z.string().url(),
  token: z.string(),
  collectionName: z.string().default('Escribano Sessions'),
});

export type OutlineConfig = z.infer<typeof outlineConfigSchema>;

// =============================================================================
// REPOSITORY INTERFACES (v2 - Storage Ports)
// =============================================================================
// TODO: Move to separate file when we split 0_types.ts

import type {
  DbArtifact,
  DbArtifactInsert,
  DbCluster,
  DbClusterInsert,
  DbClusterMerge,
  DbContext,
  DbContextInsert,
  DbObservation,
  DbObservationCluster,
  DbObservationContext,
  DbObservationInsert,
  DbRecording,
  DbRecordingInsert,
  DbTopicBlock,
  DbTopicBlockInsert,
} from './db/types.js';

export type {
  DbArtifact,
  DbArtifactInsert,
  DbCluster,
  DbClusterInsert,
  DbClusterMerge,
  DbContext,
  DbContextInsert,
  DbObservation,
  DbObservationCluster,
  DbObservationContext,
  DbObservationInsert,
  DbRecording,
  DbRecordingInsert,
  DbTopicBlock,
  DbTopicBlockInsert,
};

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

export interface ClusterRepository {
  findById(id: string): DbCluster | null;
  findByRecording(recordingId: string): DbCluster[];
  findByRecordingAndType(
    recordingId: string,
    type: 'visual' | 'audio'
  ): DbCluster[];
  save(cluster: DbClusterInsert): void;
  saveBatch(clusters: DbClusterInsert[]): void;
  linkObservation(
    observationId: string,
    clusterId: string,
    distance?: number
  ): void;
  linkObservationsBatch(
    links: Array<{
      observationId: string;
      clusterId: string;
      distance?: number;
    }>
  ): void;
  getObservations(clusterId: string): DbObservation[];
  updateClassification(id: string, classification: string): void;
  updateCentroid(id: string, centroid: number[]): void;
  saveMerge(
    visualClusterId: string,
    audioClusterId: string,
    similarity: number,
    reason: string
  ): void;
  getMergedAudioClusters(visualClusterId: string): DbCluster[];
  delete(id: string): void;
  deleteByRecording(recordingId: string): void;
}

export interface ArtifactRepository {
  findById(id: string): DbArtifact | null;
  findByType(type: string): DbArtifact[];
  findByBlock(blockId: string): DbArtifact[];
  findByContext(contextId: string): DbArtifact[]; // Cross-recording!
  save(artifact: DbArtifactInsert): void;
  update(id: string, content: string): void;
  delete(id: string): void;
}

export interface Repositories {
  recordings: RecordingRepository;
  observations: ObservationRepository;
  contexts: ContextRepository;
  topicBlocks: TopicBlockRepository;
  artifacts: ArtifactRepository;
  clusters: ClusterRepository;
}
