import { z } from 'zod';

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
