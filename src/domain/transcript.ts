/**
 * Escribano - Transcript Domain Module
 */

import type {
  TaggedTranscript,
  Transcript as TranscriptType,
} from '../0_types.js';
import type { TimeRange } from './time-range.js';

export const Transcript = {
  isEmpty: (transcript: TranscriptType): boolean => {
    return !transcript.fullText.trim() || transcript.segments.length === 0;
  },

  /**
   * Slice a transcript by a time range
   */
  sliceByTime: (
    transcript: TranscriptType,
    timeRange: TimeRange
  ): TranscriptType => {
    const [start, end] = timeRange;
    const filteredSegments = transcript.segments.filter(
      (seg) => seg.start < end && seg.end > start
    );

    if (filteredSegments.length === 0) {
      return {
        fullText: '',
        segments: [],
        language: transcript.language,
        duration: 0,
      };
    }

    const fullText = filteredSegments.map((s) => s.text).join(' ');
    const duration =
      filteredSegments.length > 0
        ? Math.max(
            0,
            filteredSegments[filteredSegments.length - 1].end -
              filteredSegments[0].start
          )
        : 0;

    return {
      fullText,
      segments: filteredSegments,
      language: transcript.language,
      duration,
    };
  },

  /**
   * Slice tagged transcripts
   */
  sliceTagged: (
    tagged: TaggedTranscript[],
    timeRange: TimeRange
  ): TaggedTranscript[] => {
    return tagged
      .map((t) => ({
        source: t.source,
        transcript: Transcript.sliceByTime(t.transcript, timeRange),
      }))
      .filter((t) => !Transcript.isEmpty(t.transcript));
  },

  /**
   * Interleave multiple transcripts by timestamp for better LLM understanding
   */
  interleave: (transcripts: TaggedTranscript[]): TranscriptType => {
    const formatTime = (seconds: number): string => {
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    // Collect all segments with source tags
    const allSegments = transcripts.flatMap(({ source, transcript }) =>
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
    const duration = Math.max(
      ...transcripts.map((t) => t.transcript.duration),
      0
    );

    return {
      fullText,
      segments: interleavedSegments,
      language: transcripts[0]?.transcript.language || 'en',
      duration,
    };
  },
};
