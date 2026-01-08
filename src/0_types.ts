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
  audioPath: z.string(),
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

// =============================================================================
// CLASSIFICATION & ENTITIES
// =============================================================================

export const entitySchema = z.object({
  id: z.string(),
  type: z.string(),
  value: z.string(),
  segmentId: z.string(),
  timestamp: z.number(),
});

export type Entity = z.infer<typeof entitySchema>;

export const classificationSchema = z.object({
  type: z.enum(['meeting', 'debugging', 'tutorial', 'learning']),
  confidence: z.number().min(0).max(1),
  entities: z.array(entitySchema),
});

export type Classification = z.infer<typeof classificationSchema>;

// =============================================================================
// SESSION
// =============================================================================

export const sessionSchema = z.object({
  id: z.string(),
  recording: recordingSchema,
  transcript: transcriptSchema.nullable(),
  status: z.enum(['raw', 'transcribed', 'classified', 'complete']),
  type: z.enum(['meeting', 'debugging', 'tutorial', 'learning']).nullable(),
  classification: classificationSchema.nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Session = z.infer<typeof sessionSchema>;

// =============================================================================
// PORTS (Interfaces)
// =============================================================================

export interface TranscriptionService {
  transcribe(audioPath: string): Promise<Transcript>;
}

export interface CaptureSource {
  getLatestRecording(): Promise<Recording | null>;
  listRecordings(limit?: number): Promise<Recording[]>;
}

export interface IntelligenceService {
  classify(transcript: Transcript): Promise<Classification>;
  generate(
    prompt: string,
    context: { transcript: Transcript }
  ): Promise<string>;
}

export interface StorageService {
  saveSession(session: Session): Promise<void>;
  loadSession(sessionId: string): Promise<Session | null>;
  listSessions(): Promise<Session[]>;
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
  endpoint: z.string().default('http://localhost:11434/v1/chat/completions'),
  model: z.string().default('qwen3:32b'),
  maxRetries: z.number().default(3),
  timeout: z.number().default(30000),
});
export type IntelligenceConfig = z.infer<typeof intelligenceConfigSchema>;
