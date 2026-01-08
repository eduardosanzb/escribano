/**
 * Escribano - Classify Session Action
 *
 * Classifies a session using IntelligenceService
 */

import type { IntelligenceService, Session } from '../0_types.js';

export async function classifySession(
  session: Session,
  intelligence: IntelligenceService
): Promise<Session> {
  if (!session.transcript) {
    throw new Error('Cannot classify session without transcript');
  }

  const classification = await intelligence.classify(session.transcript);

  return {
    id: session.id,
    recording: session.recording,
    transcript: session.transcript,
    status: 'classified',
    type: classification.type,
    classification,
    createdAt: session.createdAt,
    updatedAt: new Date(),
  };
}
