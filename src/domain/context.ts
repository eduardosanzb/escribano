/**
 * Escribano - Context Extraction Domain Module
 */

import type { ActivityContext } from '../0_types.js';

export const Context = {
  /**
   * Extract semantic contexts from raw OCR text using regex patterns.
   * This is a fast-path optimization for common applications and URLs.
   */
  extractFromOCR: (ocrText: string): ActivityContext[] => {
    const contexts: ActivityContext[] = [];
    const text = ocrText.trim();
    if (!text) return contexts;

    // 1. App Detection
    const apps = [
      { name: 'Ghostty', pattern: /Ghostty/i },
      { name: 'VS Code', pattern: /Visual Studio Code|VS Code/i },
      { name: 'Chrome', pattern: /Google Chrome/i },
      { name: 'Arc', pattern: /Arc/i },
      { name: 'Cursor', pattern: /Cursor/i },
      { name: 'TablePlus', pattern: /TablePlus/i },
      { name: 'Slack', pattern: /Slack/i },
      { name: 'Spotify', pattern: /Spotify/i },
      { name: 'YouTube Music', pattern: /YouTube Music/i },
    ];

    for (const app of apps) {
      if (app.pattern.test(text)) {
        contexts.push({
          type: 'app',
          value: app.name,
          confidence: 0.9,
        });
      }
    }

    // 2. URL Detection
    const urlPattern = /https?:\/\/[^\s]+/g;
    const urls = text.match(urlPattern);
    if (urls) {
      for (const url of urls) {
        contexts.push({
          type: 'url',
          value: url.replace(/[,.)}>]$/, ''), // Clean trailing punctuation
          confidence: 1.0,
        });
      }
    }

    // 3. Domain Detection (Specific known domains)
    const domains = [
      { name: 'github.com', pattern: /github\.com/i },
      { name: 'linkedin.com', pattern: /linkedin\.com/i },
      { name: 'stackoverflow.com', pattern: /stackoverflow\.com/i },
      { name: 'docs.rs', pattern: /docs\.rs/i },
      { name: 'ollama.com', pattern: /ollama\.com/i },
    ];

    for (const domain of domains) {
      if (domain.pattern.test(text)) {
        // Only add if not already covered by a full URL
        if (
          !contexts.some(
            (c) => c.type === 'url' && c.value.includes(domain.name)
          )
        ) {
          contexts.push({
            type: 'url',
            value: domain.name,
            confidence: 0.8,
          });
        }
      }
    }

    // 4. File Path Detection
    const pathPattern =
      /(?:~\/|\/Users\/)[^\s]+\.(?:ts|js|py|rs|md|go|json|yml|yaml)/g;
    const paths = text.match(pathPattern);
    if (paths) {
      for (const path of paths) {
        contexts.push({
          type: 'file',
          value: path,
          confidence: 0.9,
        });
      }
    }

    // TODO: Implement Step 2 - Embedding clustering for topic grouping
    // This will be used when regex patterns don't yield high-confidence results
    // or when we want to group related segments together.

    return contexts;
  },

  /**
   * Aggregate multiple contexts and remove duplicates
   */
  unique: (contexts: ActivityContext[]): ActivityContext[] => {
    const seen = new Set<string>();
    return contexts.filter((c) => {
      const key = `${c.type}:${c.value}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  },
};
