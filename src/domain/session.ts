/**
 * Escribano - Session Entity Module
 */

import type {
  ArtifactType,
  Recording,
  SessionSegment,
  Session as SessionType,
  TaggedTranscript,
  VisualIndex,
} from '../0_types.js';
import { Classification } from './classification.js';
import { Segment } from './segment.js';

export const Session = {
  /**
   * Factory: Create a new session from a recording
   */
  create: (recording: Recording): SessionType => {
    const now = new Date();
    return {
      id: recording.id,
      recording,
      transcripts: [],
      visualLogs: [],
      segments: [],
      status: 'raw',
      classification: null,
      metadata: null,
      artifacts: [],
      createdAt: now,
      updatedAt: now,
    };
  },

  /**
   * Transformation: Add transcripts to session
   */
  withTranscripts: (
    session: SessionType,
    transcripts: TaggedTranscript[]
  ): SessionType => ({
    ...session,
    transcripts,
    status: 'transcribed',
    updatedAt: new Date(),
  }),

  /**
   * Transformation: Add visual index and generate segments
   */
  withVisualIndex: (
    session: SessionType,
    visualIndex: VisualIndex
  ): SessionType => {
    const segments = Segment.fromVisualClusters(
      visualIndex.clusters,
      visualIndex.frames,
      session.transcripts
    );

    return {
      ...session,
      segments,
      status: 'visual-logged',
      updatedAt: new Date(),
    };
  },

  /**
   * Query: Get aggregated activity breakdown from segments
   */
  getActivityBreakdown: (session: SessionType): Record<string, number> => {
    if (session.segments.length === 0) return {};

    const classifications = session.segments
      .filter((s) => s.classification !== null)
      .map((s) => ({
        classification: s.classification!,
        weight: Segment.duration(s),
      }));

    if (classifications.length === 0) return {};

    return Classification.aggregate(classifications);
  },

  /**
   * Query: Get recommended artifacts based on aggregated classification
   */
  getRecommendedArtifacts: (session: SessionType): ArtifactType[] => {
    const breakdown = Session.getActivityBreakdown(session);
    if (!breakdown || Object.keys(breakdown).length === 0) return ['summary'];

    const recommendations: ArtifactType[] = ['summary'];

    if ((breakdown.meeting || 0) > 50) recommendations.push('action-items');
    if ((breakdown.debugging || 0) > 50) recommendations.push('runbook');
    if ((breakdown.tutorial || 0) > 50) recommendations.push('step-by-step');
    if ((breakdown.learning || 0) > 50)
      recommendations.push('notes', 'blog-research');
    if ((breakdown.working || 0) > 50) recommendations.push('code-snippets');

    return [...new Set(recommendations)]; // Unique
  },

  /**
   * Query: Get segments needing VLM description
   */
  getSegmentsNeedingVLM: (session: SessionType): SessionSegment[] => {
    return session.segments.filter((s) => {
      // Logic: No audio overlap AND (low OCR density OR specific media indicators)
      // For now, simple rule: No audio = needs VLM
      return !Segment.hasAudio(s) && !s.isNoise;
    });
  },
};
