import type {
  Artifact,
  ArtifactType,
  IntelligenceService,
  Session,
} from '../0_types.js';

/**
 * Generates a specific artifact for a session
 */
export async function generateArtifact(
  session: Session,
  intelligence: IntelligenceService,
  artifactType: ArtifactType
): Promise<Artifact> {
  if (!session.classification) {
    throw new Error('Session must be classified before generating artifacts');
  }

  // Combine transcripts for context
  const fullText = session.transcripts
    .map((t) => `[${t.source.toUpperCase()}]\n${t.transcript.fullText}`)
    .join('\n\n');

  const context = {
    transcript: {
      ...session.transcripts[0].transcript,
      fullText,
    },
    classification: session.classification,
    metadata: session.metadata,
  };

  const content = await intelligence.generate(artifactType, context);

  return {
    id: `${session.id}-${artifactType}-${Date.now()}`,
    type: artifactType,
    content,
    format: 'markdown',
    createdAt: new Date(),
  };
}

/**
 * Returns a list of recommended artifact types based on session classification
 */
export function getRecommendedArtifacts(session: Session): ArtifactType[] {
  const recommendations: ArtifactType[] = [];
  const { classification } = session;

  if (!classification) return recommendations;

  if (classification.meeting > 50) {
    recommendations.push('summary', 'action-items');
  }
  if (classification.debugging > 50) {
    recommendations.push('runbook');
  }
  if (classification.tutorial > 50) {
    recommendations.push('step-by-step');
  }
  if (classification.learning > 50) {
    recommendations.push('notes');
  }
  if (classification.working > 50) {
    recommendations.push('code-snippets');
  }

  return [...new Set(recommendations)];
}
