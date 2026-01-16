import os from 'node:os';
import path from 'node:path';
import type {
  Artifact,
  ArtifactType,
  IntelligenceService,
  Session,
  VideoService,
} from '../0_types.js';

/**
 * Generates a specific artifact for a session, including on-demand screenshot extraction
 */
export async function generateArtifact(
  session: Session,
  intelligence: IntelligenceService,
  artifactType: ArtifactType,
  videoService: VideoService
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
    visualLogs: session.visualLogs,
  };

  let content = await intelligence.generate(artifactType, context);

  // Post-process [SCREENSHOT: timestamp] tags for on-demand extraction
  const screenshotRegex = /\[SCREENSHOT:\s*([\d.]+)\]/g;
  const matches = [...content.matchAll(screenshotRegex)];

  if (matches.length > 0 && session.recording.videoPath) {
    console.log(
      `Found ${matches.length} screenshot requests in artifact. Extracting...`
    );
    const timestamps = matches.map((m) => Number.parseFloat(m[1]));
    const screenshotDir = path.join(
      os.homedir(),
      '.escribano',
      'sessions',
      session.id,
      'artifacts',
      'screenshots'
    );

    try {
      const paths = await videoService.extractFrames(
        session.recording.videoPath,
        timestamps,
        screenshotDir
      );

      // Replace tags with markdown images using relative paths
      for (let i = 0; i < matches.length; i++) {
        const match = matches[i];
        if (paths[i]) {
          const fileName = path.basename(paths[i]);
          const markdownImage = `![Screenshot at ${match[1]}s](./screenshots/${fileName})`;
          content = content.replace(match[0], markdownImage);
        }
      }
    } catch (error) {
      console.error('Failed to extract screenshots for artifact:', error);
    }
  }

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
