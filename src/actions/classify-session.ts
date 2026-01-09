/**
 * Escribano - Classify Session Action
 *
 * Classifies a session using IntelligenceService
 * Supports multiple transcripts by interleaving them by timestamp
 */

import type {
  IntelligenceService,
  Session,
  Transcript,
  TranscriptSegment,
  TaggedTranscript,
} from '../0_types.js';

/**
 * Format timestamp in MM:SS format
 */
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Interleave multiple transcripts by timestamp for better LLM understanding
 */
function interleaveTranscripts(transcripts: TaggedTranscript[]): Transcript {
  // Collect all segments with source tags
  interface SegmentWithSource extends TranscriptSegment {
    source: string;
  }

  const allSegments: SegmentWithSource[] = transcripts.flatMap(
    ({ source, transcript }) =>
      transcript.segments.map((seg) => ({
        ...seg,
        source: source.toUpperCase(),
      }))
  );

  // Sort by timestamp
  allSegments.sort((a, b) => a.start - b.start);

  // Create interleaved transcript
  const interleavedSegments = allSegments.map((seg, index) => ({
    id: `seg-${index}`,
    start: seg.start,
    end: seg.end,
    text: `[${formatTime(seg.start)} ${seg.source}] ${seg.text}`,
    speaker: seg.speaker,
  }));

  const fullText = interleavedSegments.map((seg) => seg.text).join('\n');

  // Use the maximum duration from all transcripts
  const duration = Math.max(...transcripts.map((t) => t.transcript.duration));

  return {
    fullText,
    segments: interleavedSegments,
    language: transcripts[0]?.transcript.language || 'en',
    duration,
  };
}

export async function classifySession(
  session: Session,
  intelligence: IntelligenceService
): Promise<Session> {
  if (session.transcripts.length === 0) {
    throw new Error('Cannot classify session without transcripts');
  }

  // Interleave transcripts if multiple sources exist
  const transcriptForClassification =
    session.transcripts.length === 1
      ? session.transcripts[0].transcript
      : interleaveTranscripts(session.transcripts);

  const classification = await intelligence.classify(
    transcriptForClassification
  );

  return {
    id: session.id,
    recording: session.recording,
    transcripts: session.transcripts,
    status: 'classified',
    classification,
    createdAt: session.createdAt,
    updatedAt: new Date(),
  };
}
