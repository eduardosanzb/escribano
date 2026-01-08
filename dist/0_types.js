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
export const transcriptSchema = z.object({
    fullText: z.string(),
    segments: z.array(transcriptSegmentSchema),
    language: z.string().default('en'),
    duration: z.number(),
});
// =============================================================================
// SESSION
// =============================================================================
export const sessionSchema = z.object({
    id: z.string(),
    recording: recordingSchema,
    transcript: transcriptSchema.nullable(),
    status: z.enum(['raw', 'transcribed', 'classified', 'complete']),
    type: z.enum(['meeting', 'debugging', 'tutorial', 'learning']).nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
});
// =============================================================================
// CONFIG
// =============================================================================
export const capConfigSchema = z.object({
    recordingsPath: z.string().default('~/Library/Application Support/so.cap.desktop/recordings').optional(),
});
export const whisperConfigSchema = z.object({
    binaryPath: z.string().default('whisper-cli'),
    model: z.string().default('large-v3'),
    cwd: z.string().optional(),
    outputFormat: z.enum(['json', 'txt', 'srt', 'vtt']).default('json'),
    language: z.string().optional(),
});
