/**
 * Escribano - Signal Extraction Service
 *
 * Extracts semantic signals (apps, urls, projects, topics) from cluster observations.
 * Uses a tiered approach: regex for structured → patterns for semi-structured → LLM for semantic.
 */

import type { DbObservation, IntelligenceService } from '../0_types.js';

export interface ExtractedSignals {
  apps: string[];
  urls: string[];
  projects: string[];
  topics: string[];
}

// ============================================================================
// TIER 1: REGEX-BASED EXTRACTION (URLs, Domains)
// ============================================================================

const URL_REGEX =
  /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9][-a-zA-Z0-9]*(?:\.[a-zA-Z0-9][-a-zA-Z0-9]*)+)(?:\/[^\s]*)?/gi;
const NOISE_DOMAINS = ['localhost', '127.0.0.1', '0.0.0.0', 'example.com'];

export function extractUrls(texts: string[]): string[] {
  const domains = new Map<string, number>();

  for (const text of texts) {
    const matches = text.matchAll(URL_REGEX);
    for (const match of matches) {
      const domain = match[1].toLowerCase();
      if (!NOISE_DOMAINS.includes(domain) && !domain.startsWith('192.168.')) {
        domains.set(domain, (domains.get(domain) || 0) + 1);
      }
    }
  }

  // Return domains appearing at least twice, sorted by frequency
  return Array.from(domains.entries())
    .filter(([_, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([domain]) => domain);
}

// ============================================================================
// TIER 2: PATTERN-BASED EXTRACTION (Apps, Projects)
// ============================================================================

const APP_PATTERNS: Record<string, RegExp> = {
  'VS Code': /(?:visual\s+studio\s+code|vscode|code\s+-|\[Code\]|\.vscode)/i,
  Chrome: /(?:google\s+chrome|chrome\s+-|\s+-\s+chrome)/i,
  Firefox: /(?:mozilla\s+firefox|firefox\s+-)/i,
  Safari: /(?:safari\s+-|apple\s+safari)/i,
  Terminal: /(?:terminal|iterm|iterm2|hyper)/i,
  Ghostty: /ghostty/i,
  Neovim: /(?:neovim|nvim|nvimtree)/i,
  Vim: /(?:\bvim\b(?!tree))/i,
  Slack: /(?:slack\s+-|\[Slack\])/i,
  Discord: /(?:discord\s+-|\[Discord\])/i,
  YouTube: /(?:youtube\.com|youtube\s+-)/i,
  GitHub: /(?:github\.com|github\s+-)/i,
  Figma: /(?:figma\.com|figma\s+-)/i,
  Notion: /(?:notion\.so|notion\s+-)/i,
  Obsidian: /(?:obsidian\s+-|\.obsidian)/i,
};

export function extractApps(texts: string[]): string[] {
  const detected = new Set<string>();

  for (const text of texts) {
    for (const [app, pattern] of Object.entries(APP_PATTERNS)) {
      if (pattern.test(text)) {
        detected.add(app);
      }
    }
  }

  return Array.from(detected);
}

const PROJECT_PATTERNS = [
  /(?:repos|projects|dev|src|code)\/([a-zA-Z0-9_-]+)/i,
  /(?:github\.com|gitlab\.com)\/[^/]+\/([a-zA-Z0-9_-]+)/i,
  /package\.json.*?"name":\s*"([^"]+)"/i,
  /~\/([a-zA-Z0-9_-]+)\/(?:src|lib|packages)/i,
];

export function extractProjects(texts: string[]): string[] {
  const projects = new Map<string, number>();

  for (const text of texts) {
    for (const pattern of PROJECT_PATTERNS) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const name = match[1].toLowerCase();
        // Filter out common non-project names
        if (
          !['src', 'lib', 'dist', 'build', 'node_modules', 'packages'].includes(
            name
          )
        ) {
          projects.set(name, (projects.get(name) || 0) + 1);
        }
      }
    }
  }

  return Array.from(projects.keys());
}

// ============================================================================
// TIER 3: LLM-BASED EXTRACTION (Topics)
// ============================================================================

export async function extractTopics(
  observations: DbObservation[],
  intelligence: IntelligenceService
): Promise<string[]> {
  return intelligence.extractTopics(observations);
}

// ============================================================================
// COMBINED EXTRACTION
// ============================================================================

export async function extractSignals(
  observations: DbObservation[],
  intelligence: IntelligenceService
): Promise<ExtractedSignals> {
  // Collect all text content
  const allTexts = observations.map((o) => {
    if (o.type === 'visual') {
      return [o.ocr_text || '', o.vlm_description || ''].join(' ');
    }
    return o.text || '';
  });

  // Tier 1 & 2: Fast extraction
  const urls = extractUrls(allTexts);
  const apps = extractApps(allTexts);
  const projects = extractProjects(allTexts);

  // Tier 3: LLM-based topics
  const topics = await extractTopics(observations, intelligence);

  return { apps, urls, projects, topics };
}
