/**
 * Escribano - Classify Session Action
 *
 * Classifies a session using IntelligenceService.
 * If segments exist, it classifies each segment individually and aggregates the results.
 */

import type {
  IntelligenceService,
  SessionSegment,
  Session as SessionType,
} from '../0_types.js';
import { Session } from '../domain/session.js';
import { Transcript } from '../domain/transcript.js';

export async function classifySession(
  session: SessionType,
  intelligence: IntelligenceService
): Promise<SessionType> {
  if (session.transcripts.length === 0) {
    throw new Error('Cannot classify session without transcripts');
  }

  // 1. If segments exist, classify each segment sequentially
  if (session.segments.length > 0) {
    const nonNoiseSegments = session.segments.filter((s) => !s.isNoise);
    const noiseCount = session.segments.length - nonNoiseSegments.length;

    console.log(
      `Classifying ${nonNoiseSegments.length} segments (${noiseCount} noise skipped)...`
    );

    // Sequential classification to avoid parallel warmup race + Ollama overload
    const classifiedSegments: SessionSegment[] = [];
    let classifiedCount = 0;

    for (const segment of session.segments) {
      if (segment.isNoise) {
        classifiedSegments.push({
          ...segment,
          classification: {
            meeting: 0,
            debugging: 0,
            tutorial: 0,
            learning: 0,
            working: 0,
          },
        });
        continue;
      }

      classifiedCount++;
      console.log(
        `  Segment ${classifiedCount}/${nonNoiseSegments.length}: ${segment.id}`
      );

      try {
        const classification = await intelligence.classifySegment(segment);
        classifiedSegments.push({ ...segment, classification });
      } catch (error) {
        console.error(`  Failed to classify segment ${segment.id}:`, error);
        classifiedSegments.push(segment);
      }
    }

    // Update session with classified segments
    const updatedSession = {
      ...session,
      segments: classifiedSegments,
      status: 'classified' as const,
      updatedAt: new Date(),
    };

    // 2. Derive session-level classification from aggregated segments
    const aggregatedClassification =
      Session.getActivityBreakdown(updatedSession);

    // Convert Record to Classification type
    updatedSession.classification = {
      meeting: aggregatedClassification.meeting || 0,
      debugging: aggregatedClassification.debugging || 0,
      tutorial: aggregatedClassification.tutorial || 0,
      learning: aggregatedClassification.learning || 0,
      working: aggregatedClassification.working || 0,
    };

    return updatedSession;
  }

  // Fallback to legacy whole-session classification if no segments exist
  console.log(
    'No segments found, falling back to session-level classification...'
  );

  const transcriptForClassification =
    session.transcripts.length === 1
      ? session.transcripts[0].transcript
      : Transcript.interleave(session.transcripts);

  const classification = await intelligence.classify(
    transcriptForClassification,
    session.visualLogs
  );

  return {
    ...session,
    status: 'classified',
    classification,
    updatedAt: new Date(),
  };
}
