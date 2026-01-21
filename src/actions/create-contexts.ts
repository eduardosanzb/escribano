/**
 * Escribano - Context Creation Action
 *
 * Creates Context entities from extracted signals and links observations.
 */

import type { ContextRepository, DbObservation } from '../0_types.js';
import { generateId } from '../db/helpers.js';
import type { ExtractedSignals } from '../services/signal-extraction.js';

export interface ContextCreationResult {
  contextIds: string[];
  observationLinks: Array<{ observationId: string; contextId: string }>;
}

export function createContextsFromSignals(
  signals: ExtractedSignals,
  observations: DbObservation[],
  contextRepo: ContextRepository
): ContextCreationResult {
  const contextIds: string[] = [];
  const observationLinks: Array<{ observationId: string; contextId: string }> =
    [];

  // Helper: get or create context
  const getOrCreateContext = (type: string, name: string): string => {
    const existing = contextRepo.findByTypeAndName(type, name);
    if (existing) return existing.id;

    const id = generateId();
    contextRepo.save({ id, type, name, metadata: null });
    return id;
  };

  // Create contexts for each signal type
  for (const app of signals.apps) {
    const contextId = getOrCreateContext('app', app);
    contextIds.push(contextId);
  }

  for (const url of signals.urls) {
    const contextId = getOrCreateContext('url', url);
    contextIds.push(contextId);
  }

  for (const project of signals.projects) {
    const contextId = getOrCreateContext('project', project);
    contextIds.push(contextId);
  }

  for (const topic of signals.topics) {
    const contextId = getOrCreateContext('topic', topic);
    contextIds.push(contextId);
  }

  // Link all observations to all contexts (cluster-level association)
  const uniqueContextIds = [...new Set(contextIds)];
  for (const obs of observations) {
    for (const contextId of uniqueContextIds) {
      observationLinks.push({ observationId: obs.id, contextId });
    }
  }

  return { contextIds: uniqueContextIds, observationLinks };
}
