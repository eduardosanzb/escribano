/**
 * Escribano - Extract Metadata Action
 *
 * Extracts structured metadata from session transcripts using LLM
 */

import type {
  Session,
  IntelligenceService,
  TranscriptMetadata,
} from '../0_types.js';

export async function extractMetadata(
  session: Session,
  intelligence: IntelligenceService
): Promise<Session> {
  if (!session.classification) {
    throw new Error('Session must be classified before metadata extraction');
  }

  console.log('Extracting metadata from transcript...');

  const metadata = await intelligence.extractMetadata(
    session.transcripts[0].transcript,
    session.classification
  );

  console.log('✓ Metadata extraction complete');

  return {
    ...session,
    metadata,
    status: 'metadata-extracted',
    updatedAt: new Date(),
  };
}
