/**
 * Escribano - Classification Value Object
 */

import type {
  Classification as ClassificationType,
  SessionType,
} from '../0_types.js';

export const Classification = {
  /**
   * Get the primary session type based on scores.
   * Returns the type with the highest score if it's above the threshold.
   */
  getPrimary: (c: ClassificationType, threshold = 25): SessionType | null => {
    const sorted = Object.entries(c).sort(
      ([, a], [, b]) => (b as number) - (a as number)
    );

    const [type, score] = sorted[0];
    return (score as number) >= threshold ? (type as SessionType) : null;
  },

  /**
   * Check if a specific type is present with a score above threshold
   */
  hasType: (
    c: ClassificationType,
    type: SessionType,
    threshold = 50
  ): boolean => {
    return (c[type] || 0) >= threshold;
  },

  /**
   * Get all types that meet a significance threshold
   */
  getSignificantTypes: (
    c: ClassificationType,
    threshold = 25
  ): SessionType[] => {
    return Object.entries(c)
      .filter(([, score]) => (score as number) >= threshold)
      .map(([type]) => type as SessionType);
  },

  /**
   * Aggregate multiple classifications (e.g., from segments to session)
   * Uses time-weighted average or simple average.
   */
  aggregate: (
    classifications: Array<{
      classification: ClassificationType;
      weight: number;
    }>
  ): ClassificationType => {
    const result: ClassificationType = {
      meeting: 0,
      debugging: 0,
      tutorial: 0,
      learning: 0,
      working: 0,
    };

    if (classifications.length === 0) return result;

    let totalWeight = 0;
    for (const { classification, weight } of classifications) {
      totalWeight += weight;
      result.meeting += (classification.meeting || 0) * weight;
      result.debugging += (classification.debugging || 0) * weight;
      result.tutorial += (classification.tutorial || 0) * weight;
      result.learning += (classification.learning || 0) * weight;
      result.working += (classification.working || 0) * weight;
    }

    if (totalWeight > 0) {
      result.meeting = Math.round(result.meeting / totalWeight);
      result.debugging = Math.round(result.debugging / totalWeight);
      result.tutorial = Math.round(result.tutorial / totalWeight);
      result.learning = Math.round(result.learning / totalWeight);
      result.working = Math.round(result.working / totalWeight);
    }

    return result;
  },
};
