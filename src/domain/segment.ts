/**
 * Escribano - Segment Value Object
 */

import type {
  SessionSegment,
  TaggedTranscript,
  VisualIndexCluster,
  VisualIndexFrame,
} from '../0_types.js';
import { TimeRange } from './time-range.js';
import { Transcript } from './transcript.js';

// Minimal Context logic previously in context.ts
const Context = {
  extractFromOCR: (text: string): any[] => {
    // This is a stub to keep V1 compiling.
    // V2 uses signal-extraction.ts instead.
    return [];
  },
  unique: (contexts: any[]): any[] => contexts,
};

export const Segment = {
  /**
   * Factory: Create segments from visual clusters
   */
  fromVisualClusters: (
    clusters: VisualIndexCluster[],
    frames: VisualIndexFrame[],
    transcripts: TaggedTranscript[]
  ): SessionSegment[] => {
    if (clusters.length === 0) return [];

    // Sort clusters chronologically just in case
    const sortedClusters = [...clusters].sort(
      (a, b) => a.timeRange[0] - b.timeRange[0]
    );

    const segments: SessionSegment[] = [];

    // Group adjacent clusters with the same heuristic label
    let currentGroup: VisualIndexCluster[] = [sortedClusters[0]];

    for (let i = 1; i < sortedClusters.length; i++) {
      const prev = currentGroup[currentGroup.length - 1];
      const curr = sortedClusters[i];

      // Primitives for merging:
      // 1. Same heuristic label
      // 2. Overlapping or very close in time (< 5s gap)
      const sameLabel = curr.heuristicLabel === prev.heuristicLabel;
      const smallGap = curr.timeRange[0] - prev.timeRange[1] < 5;

      if (sameLabel && smallGap) {
        currentGroup.push(curr);
      } else {
        segments.push(
          Segment.createFromClusterGroup(currentGroup, frames, transcripts)
        );
        currentGroup = [curr];
      }
    }

    // Add last group
    if (currentGroup.length > 0) {
      segments.push(
        Segment.createFromClusterGroup(currentGroup, frames, transcripts)
      );
    }

    return segments;
  },

  /**
   * Helper: Create a segment from a group of clusters
   */
  createFromClusterGroup: (
    group: VisualIndexCluster[],
    frames: VisualIndexFrame[],
    transcripts: TaggedTranscript[]
  ): SessionSegment => {
    const startTime = Math.min(...group.map((c) => c.timeRange[0]));
    const endTime = Math.max(...group.map((c) => c.timeRange[1]));
    const timeRange: [number, number] = [startTime, endTime];
    const clusterIds = group.map((c) => c.id);

    // Collect OCR text from all frames belonging to these clusters
    const segmentFrames = frames.filter((f) =>
      clusterIds.includes(f.clusterId)
    );
    const allOcrText = segmentFrames.map((f) => f.ocrText).join('\n');

    // Extract contexts
    const contexts = Context.unique(Context.extractFromOCR(allOcrText));

    // Slice transcripts
    const transcriptSlice = Transcript.sliceTagged(transcripts, timeRange);

    const segment: SessionSegment = {
      id: `seg-${startTime.toFixed(0)}`,
      timeRange,
      visualClusterIds: clusterIds,
      contexts,
      transcriptSlice: transcriptSlice.length > 0 ? transcriptSlice[0] : null, // Simplify to primary for now
      classification: null,
      isNoise: false, // Will be set by isNoise() check
    };

    segment.isNoise = Segment.isNoise(segment);

    return segment;
  },

  duration: (segment: SessionSegment): number => {
    return TimeRange.duration(segment.timeRange);
  },

  hasAudio: (segment: SessionSegment): boolean => {
    return (
      segment.transcriptSlice !== null &&
      !Transcript.isEmpty(segment.transcriptSlice.transcript)
    );
  },

  isNoise: (segment: SessionSegment): boolean => {
    // 1. Check contexts for noise apps
    const noiseApps = ['Spotify', 'YouTube Music'];
    if (
      segment.contexts.some(
        (c) => c.type === 'app' && noiseApps.includes(c.value)
      )
    ) {
      return true;
    }

    // 2. Check for "idle" indicator in heuristic label
    // Note: Python script might label things as "idle" (future)

    return false;
  },
};
