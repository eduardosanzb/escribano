/**
 * Escribano - Temporal Audio Alignment Service
 *
 * Attaches audio transcripts to visual segments based on timestamp overlap.
 * Replaces semantic similarity-based merge with deterministic temporal alignment.
 */

import type { DbObservation } from '../db/types.js';
import type { Segment } from './activity-segmentation.js';

export interface EnrichedSegment extends Segment {
  /** Audio transcripts that overlap with this segment */
  transcripts: Array<{
    source: 'mic' | 'system';
    text: string;
    startTime: number;
    endTime: number;
  }>;
  /** Combined transcript text for the segment */
  combinedTranscript: string;
}

export interface AlignmentConfig {
  /** Minimum overlap in seconds to consider alignment (default: 1) */
  minOverlapSeconds: number;
  /** Whether to prefer mic or system audio when both available (default: 'mic') */
  preferredSource: 'mic' | 'system';
}

const DEFAULT_CONFIG: AlignmentConfig = {
  minOverlapSeconds: 1,
  preferredSource: 'mic',
};

/**
 * Check if two time ranges overlap.
 *
 * @param start1 - Start of range 1
 * @param end1 - End of range 1
 * @param start2 - Start of range 2
 * @param end2 - End of range 2
 * @returns True if ranges overlap
 */
function rangesOverlap(
  start1: number,
  end1: number,
  start2: number,
  end2: number
): boolean {
  return start1 < end2 && start2 < end1;
}

/**
 * Calculate overlap duration between two time ranges.
 *
 * @param start1 - Start of range 1
 * @param end1 - End of range 1
 * @param start2 - Start of range 2
 * @param end2 - End of range 2
 * @returns Overlap duration in seconds (0 if no overlap)
 */
function calculateOverlap(
  start1: number,
  end1: number,
  start2: number,
  end2: number
): number {
  if (!rangesOverlap(start1, end1, start2, end2)) {
    return 0;
  }
  const overlapStart = Math.max(start1, start2);
  const overlapEnd = Math.min(end1, end2);
  return Math.max(0, overlapEnd - overlapStart);
}

/**
 * Align audio transcripts to visual segments based on temporal overlap.
 *
 * @param segments - Visual segments from activity segmentation
 * @param audioObservations - Audio observations with transcripts
 * @param config - Alignment configuration
 * @returns Segments enriched with aligned transcripts
 */
export function alignAudioToSegments(
  segments: Segment[],
  audioObservations: DbObservation[],
  config: Partial<AlignmentConfig> = {}
): EnrichedSegment[] {
  const cfg: AlignmentConfig = { ...DEFAULT_CONFIG, ...config };

  // Filter to audio observations with transcripts
  const audioTranscripts = audioObservations
    .filter((o) => o.type === 'audio' && o.text && o.text.trim().length > 0)
    .map((o) => ({
      source: o.audio_source as 'mic' | 'system',
      text: o.text!,
      startTime: o.timestamp,
      endTime: o.end_timestamp ?? o.timestamp + 5, // Default 5s if no end time
    }))
    .sort((a, b) => a.startTime - b.startTime);

  // Enrich each segment with overlapping transcripts
  return segments.map((segment) => {
    const overlappingTranscripts: EnrichedSegment['transcripts'] = [];

    for (const transcript of audioTranscripts) {
      const overlap = calculateOverlap(
        segment.startTime,
        segment.endTime,
        transcript.startTime,
        transcript.endTime
      );

      if (overlap >= cfg.minOverlapSeconds) {
        overlappingTranscripts.push(transcript);
      }
    }

    // Combine transcripts in chronological order
    const combinedTranscript = overlappingTranscripts
      .sort((a, b) => a.startTime - b.startTime)
      .map((t) => `[${t.source.toUpperCase()}] ${t.text}`)
      .join('\n');

    return {
      ...segment,
      transcripts: overlappingTranscripts,
      combinedTranscript,
    };
  });
}

/**
 * Get statistics about audio alignment.
 */
export function getAlignmentStats(enrichedSegments: EnrichedSegment[]): {
  totalSegments: number;
  segmentsWithAudio: number;
  totalTranscriptSegments: number;
  micTranscriptCount: number;
  systemTranscriptCount: number;
  avgTranscriptsPerSegment: number;
} {
  const segmentsWithAudio = enrichedSegments.filter(
    (s) => s.transcripts.length > 0
  ).length;

  const totalTranscriptSegments = enrichedSegments.reduce(
    (sum, s) => sum + s.transcripts.length,
    0
  );

  const micTranscriptCount = enrichedSegments.reduce(
    (sum, s) => sum + s.transcripts.filter((t) => t.source === 'mic').length,
    0
  );

  const systemTranscriptCount = enrichedSegments.reduce(
    (sum, s) => sum + s.transcripts.filter((t) => t.source === 'system').length,
    0
  );

  return {
    totalSegments: enrichedSegments.length,
    segmentsWithAudio,
    totalTranscriptSegments,
    micTranscriptCount,
    systemTranscriptCount,
    avgTranscriptsPerSegment:
      enrichedSegments.length > 0
        ? totalTranscriptSegments / enrichedSegments.length
        : 0,
  };
}
