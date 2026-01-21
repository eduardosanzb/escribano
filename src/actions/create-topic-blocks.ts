/**
 * Escribano - TopicBlock Creation Action
 *
 * Creates TopicBlocks from clusters with their associated contexts.
 */

import type { DbCluster, TopicBlockRepository } from '../0_types.js';
import { generateId } from '../db/helpers.js';
import type { ExtractedSignals } from '../services/signal-extraction.js';

export interface TopicBlockCreationInput {
  cluster: DbCluster;
  contextIds: string[];
  signals: ExtractedSignals;
  mergedAudioClusterIds?: string[];
}

export function createTopicBlockFromCluster(
  input: TopicBlockCreationInput,
  topicBlockRepo: TopicBlockRepository
): string {
  const { cluster, contextIds, signals, mergedAudioClusterIds } = input;

  const id = generateId();

  // Build classification from signals
  const classification = buildClassification(signals);

  // Calculate duration
  const duration = cluster.end_timestamp - cluster.start_timestamp;

  topicBlockRepo.save({
    id,
    recording_id: cluster.recording_id,
    context_ids: JSON.stringify(contextIds),
    classification: JSON.stringify({
      ...classification,
      mergedAudioClusterIds: mergedAudioClusterIds || [],
    }),
    duration,
  });

  return id;
}

function buildClassification(
  signals: ExtractedSignals
): Record<string, number> {
  // Map topics to classification scores
  const scores: Record<string, number> = {
    meeting: 0,
    debugging: 0,
    tutorial: 0,
    learning: 0,
    working: 0,
  };

  for (const topic of signals.topics) {
    const lower = topic.toLowerCase();
    if (
      lower.includes('debug') ||
      lower.includes('fix') ||
      lower.includes('error')
    ) {
      scores.debugging = Math.max(scores.debugging, 80);
    }
    if (
      lower.includes('learn') ||
      lower.includes('understand') ||
      lower.includes('research')
    ) {
      scores.learning = Math.max(scores.learning, 80);
    }
    if (
      lower.includes('tutorial') ||
      lower.includes('watch') ||
      lower.includes('video')
    ) {
      scores.tutorial = Math.max(scores.tutorial, 80);
    }
    if (
      lower.includes('meeting') ||
      lower.includes('call') ||
      lower.includes('discuss')
    ) {
      scores.meeting = Math.max(scores.meeting, 80);
    }
    if (
      lower.includes('implement') ||
      lower.includes('build') ||
      lower.includes('code')
    ) {
      scores.working = Math.max(scores.working, 80);
    }
  }

  // Default to working if no specific signals
  if (Object.values(scores).every((s) => s === 0)) {
    scores.working = 50;
  }

  return scores;
}
