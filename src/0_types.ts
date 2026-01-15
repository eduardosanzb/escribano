/**
 * Escribano - Core Types
 *
 * All types and interfaces in one place.
 */

import { z } from 'zod';

// =============================================================================
// RECORDING
// =============================================================================

/**
 * Normalizes a raw ID (e.g. from a folder name) by removing spaces and special characters.
 */
export function normalizeSessionId(rawId: string): string {
  return rawId
    .replace(/\s+/g, '-') // Spaces → hyphens
    .replace(/[()[\]{}]/g, '') // Remove brackets
    .replace(/—/g, '-') // Em-dash → hyphen
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-|-$/g, '') // Trim leading/trailing hyphens
    .replace(/\.cap$/i, ''); // Remove .cap extension
}

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

export const speakerSchema = z.object({
  name: z.string(),
  role: z.string().optional(),
});

export const keyMomentSchema = z.object({
  timestamp: z.number(),
  description: z.string(),
  importance: z.enum(['high', 'medium', 'low']),
});

export const actionItemSchema = z.object({
  description: z.string(),
  owner: z.string().nullable(),
  priority: z.enum(['high', 'medium', 'low']).optional(),
});

export const technicalTermSchema = z.object({
  term: z.string(),
  context: z.string(),
  type: z.enum(['error', 'file', 'function', 'variable', 'other']),
});

export const codeSnippetSchema = z.object({
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
  extractMetadata(
    transcript: Transcript,
    classification: Classification,
    visualLogs?: VisualLog[]
  ): Promise<TranscriptMetadata>;
  describeImages(
    images: Array<{ imagePath: string; clusterId: number; timestamp: number }>,
    prompt?: string
  ): Promise<VisualDescriptions>;
  generate(
    artifactType: ArtifactType,
    context: {
      transcript: Transcript;
      classification: Classification;
      metadata: TranscriptMetadata | null;
      visualLogs?: VisualLog[];
    }
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
  extractFrames(
    videoPath: string,
    timestamps: number[],
    outputDir: string
  ): Promise<string[]>;
  detectAndExtractScenes(
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
  timeout: z.number().default(500000),
  keepAlive: z.string().default('10m'),
  maxContextSize: z.number().default(131072), // qwen3:8b supports up to 128K
});
export type IntelligenceConfig = z.infer<typeof intelligenceConfigSchema>;

export const DEFAULT_INTELLIGENCE_CONFIG: IntelligenceConfig =
  intelligenceConfigSchema.parse({});

export const artifactConfigSchema = z.object({
  parallelGeneration: z.boolean().default(false),
  maxParallel: z.number().default(3),
  maxScreenshots: z.number().default(10),
});
export type ArtifactConfig = z.infer<typeof artifactConfigSchema>;

export const outlineConfigSchema = z.object({
  url: z.string().url(),
  token: z.string(),
  collectionName: z.string().default('Escribano Sessions'),
});
export type OutlineConfig = z.infer<typeof outlineConfigSchema>;
