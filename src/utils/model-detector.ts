/**
 * LLM Model Auto-Detection
 *
 * Detects the best available LLM model from installed Ollama models
 * based on system RAM and model quality tiers.
 */

import { totalmem } from 'node:os';

export const LLM_MODEL_TIERS = [
  { model: 'qwen3.5:27b', tier: 4, minRamGB: 32, label: 'best' },
  { model: 'qwen3:14b', tier: 3, minRamGB: 20, label: 'very good' },
  { model: 'qwen3:8b', tier: 2, minRamGB: 10, label: 'good' },
  { model: 'qwen3:4b', tier: 1, minRamGB: 6, label: 'minimum' },
] as const;

export type LLMModelTier = (typeof LLM_MODEL_TIERS)[number];

export interface ModelSelection {
  model: string;
  source: 'env' | 'auto';
  tier: number;
  label: string;
  ramGB: number;
  warning?: string;
  recommendation?: string;
}

interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
}

const OLLAMA_ENDPOINT = process.env.OLLAMA_HOST || 'http://localhost:11434';

/**
 * Fetch installed models from Ollama
 */
export async function getInstalledOllamaModels(): Promise<string[]> {
  try {
    const response = await fetch(`${OLLAMA_ENDPOINT}/api/tags`);
    if (!response.ok) {
      return [];
    }
    const data = (await response.json()) as { models: OllamaModel[] };
    return data.models?.map((m) => m.name) ?? [];
  } catch {
    return [];
  }
}

/**
 * Check if a model matches (handles model:tag format)
 */
function modelMatches(installed: string, target: string): boolean {
  const installedBase = installed.split(':')[0];
  const targetBase = target.split(':')[0];
  return installedBase === targetBase;
}

/**
 * Find the best tier for a given model name
 */
function findTier(model: string): LLMModelTier | undefined {
  return LLM_MODEL_TIERS.find((t) => modelMatches(model, t.model));
}

/**
 * Get system RAM in GB
 */
export function getSystemRamGB(): number {
  return Math.round(totalmem() / (1024 * 1024 * 1024));
}

/**
 * Select the best LLM model based on installed models and system RAM.
 *
 * If ESCRIBANO_LLM_MODEL is set, uses that but still validates and warns.
 * Otherwise, auto-selects the best available model that fits in RAM.
 */
export async function selectBestLLMModel(): Promise<ModelSelection> {
  const ramGB = getSystemRamGB();
  const envModel = process.env.ESCRIBANO_LLM_MODEL;
  const installed = await getInstalledOllamaModels();

  // If env var is set, use it but validate
  if (envModel) {
    const tier = findTier(envModel);
    const isInstalled = installed.some((m) => modelMatches(m, envModel));

    if (!isInstalled) {
      return {
        model: envModel,
        source: 'env',
        tier: tier?.tier ?? 0,
        label: tier?.label ?? 'unknown',
        ramGB,
        warning: `${envModel} is not installed. Run: ollama pull ${envModel}`,
      };
    }

    if (tier && tier.minRamGB > ramGB) {
      const recommended = LLM_MODEL_TIERS.find((t) => t.minRamGB <= ramGB);
      return {
        model: envModel,
        source: 'env',
        tier: tier.tier,
        label: tier.label,
        ramGB,
        warning: `${envModel} may be too large for your ${ramGB}GB RAM.`,
        recommendation: recommended
          ? `Consider ${recommended.model} for stability (ollama pull ${recommended.model})`
          : undefined,
      };
    }

    // Check if there's a better model available for this RAM
    const betterTier = LLM_MODEL_TIERS.find(
      (t) =>
        t.tier > (tier?.tier ?? 0) &&
        t.minRamGB <= ramGB &&
        installed.some((m) => modelMatches(m, t.model))
    );

    return {
      model: envModel,
      source: 'env',
      tier: tier?.tier ?? 0,
      label: tier?.label ?? 'unknown',
      ramGB,
      recommendation: betterTier
        ? `${betterTier.model} is available and would give better quality (ollama pull ${betterTier.model})`
        : undefined,
    };
  }

  // Auto-select: find best installed model that fits in RAM
  for (const tier of LLM_MODEL_TIERS) {
    if (tier.minRamGB > ramGB) continue;

    const installedModel = installed.find((m) => modelMatches(m, tier.model));
    if (installedModel) {
      // Check if there's a better model NOT installed
      const betterTier = LLM_MODEL_TIERS.find(
        (t) => t.tier > tier.tier && t.minRamGB <= ramGB
      );

      return {
        model:
          installedModel.split(':')[0] === tier.model.split(':')[0]
            ? installedModel
            : tier.model,
        source: 'auto',
        tier: tier.tier,
        label: tier.label,
        ramGB,
        recommendation: betterTier
          ? `For better quality, install ${betterTier.model} (ollama pull ${betterTier.model})`
          : undefined,
      };
    }
  }

  // Nothing found - return lowest tier with install instruction
  const lowest = LLM_MODEL_TIERS[LLM_MODEL_TIERS.length - 1];
  return {
    model: lowest.model,
    source: 'auto',
    tier: 0,
    label: 'not found',
    ramGB,
    warning: `No supported LLM model found.`,
    recommendation: `Install at least ${lowest.model}: ollama pull ${lowest.model}`,
  };
}

/**
 * Format model selection for console output
 */
export function formatModelSelection(selection: ModelSelection): string {
  const lines: string[] = [];

  const sourceLabel =
    selection.source === 'env'
      ? '(from ESCRIBANO_LLM_MODEL)'
      : '(auto-detected)';
  lines.push(`Using ${selection.model} ${sourceLabel}`);

  if (selection.warning) {
    lines.push(`  ⚠ ${selection.warning}`);
  }

  if (selection.recommendation) {
    lines.push(`  ℹ ${selection.recommendation}`);
  }

  return lines.join('\n');
}
