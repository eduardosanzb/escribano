import { describe, expect, it } from 'vitest';
import {
  isPersonalApp,
  normalizeAppNames,
  normalizeAppNamesInRecord,
  normalizeAppNamesInRecords,
} from '../../services/app-normalization.js';

describe('normalizeAppNames', () => {
  it('should return empty array for empty input', () => {
    expect(normalizeAppNames([])).toEqual([]);
  });

  it('should normalize known alias: vscode → VSCode', () => {
    const result = normalizeAppNames(['vscode']);
    expect(result).toContain('VSCode');
  });

  it('should normalize known alias: ghosty → Ghostty', () => {
    const result = normalizeAppNames(['ghosty']);
    expect(result).toContain('Ghostty');
  });

  it('should normalize known alias: slack → Slack', () => {
    const result = normalizeAppNames(['slack']);
    expect(result).toContain('Slack');
  });

  it('should normalize case: SLACK → Slack via alias map', () => {
    const result = normalizeAppNames(['SLACK']);
    expect(result).toContain('Slack');
  });

  it('should deduplicate: VSCode and vscode both map to VSCode once', () => {
    const result = normalizeAppNames(['VSCode', 'vscode']);
    expect(result.filter((a) => a === 'VSCode').length).toBe(1);
  });

  it('should filter out single-letter noisy names', () => {
    const result = normalizeAppNames(['a']);
    expect(result).toEqual([]);
  });

  it('should filter out generic noisy words', () => {
    const noisyWords = [
      'unknown',
      'application',
      'app',
      'window',
      'screen',
      'desktop',
    ];
    for (const word of noisyWords) {
      const result = normalizeAppNames([word]);
      expect(result).toEqual([]);
    }
  });

  it('should return results sorted alphabetically', () => {
    const result = normalizeAppNames(['Zoom', 'Slack', 'Figma']);
    expect(result).toEqual([...result].sort());
  });

  it('should handle fuzzy matching: similar names collapse to canonical', () => {
    // 'iterm2' and 'iterm' both resolve to 'iTerm' via alias map — no duplicates
    const result = normalizeAppNames(['iterm', 'iterm2']);
    expect(result.filter((a) => a === 'iTerm').length).toBe(1);
  });

  it('should normalize multi-word alias: "vs code" → VSCode', () => {
    const result = normalizeAppNames(['vs code']);
    expect(result).toContain('VSCode');
  });

  it('should normalize "visual studio code" → VSCode', () => {
    const result = normalizeAppNames(['visual studio code']);
    expect(result).toContain('VSCode');
  });

  it('should normalize "google chrome" → Google Chrome', () => {
    const result = normalizeAppNames(['google chrome']);
    expect(result).toContain('Google Chrome');
  });

  it('should normalize chrome → Google Chrome', () => {
    const result = normalizeAppNames(['chrome']);
    expect(result).toContain('Google Chrome');
  });

  it('should handle multiple valid apps without deduplication', () => {
    const result = normalizeAppNames(['Figma', 'Notion', 'Slack']);
    expect(result).toContain('Figma');
    expect(result).toContain('Notion');
    expect(result).toContain('Slack');
    expect(result).toHaveLength(3);
  });

  it('should filter names shorter than 2 characters', () => {
    const result = normalizeAppNames(['x', 'Z']);
    expect(result).toEqual([]);
  });
});

describe('isPersonalApp', () => {
  it('should return true for WhatsApp', () => {
    expect(isPersonalApp('WhatsApp')).toBe(true);
  });

  it('should return true for Instagram', () => {
    expect(isPersonalApp('Instagram')).toBe(true);
  });

  it('should return true for Telegram', () => {
    expect(isPersonalApp('Telegram')).toBe(true);
  });

  it('should return true for Discord', () => {
    expect(isPersonalApp('Discord')).toBe(true);
  });

  it('should return true for FaceTime', () => {
    expect(isPersonalApp('FaceTime')).toBe(true);
  });

  it('should return true for TikTok', () => {
    expect(isPersonalApp('TikTok')).toBe(true);
  });

  it('should return true for Messenger', () => {
    expect(isPersonalApp('Messenger')).toBe(true);
  });

  it('should return false for VSCode', () => {
    expect(isPersonalApp('VSCode')).toBe(false);
  });

  it('should return false for Slack', () => {
    expect(isPersonalApp('Slack')).toBe(false);
  });

  it('should return false for Terminal', () => {
    expect(isPersonalApp('Terminal')).toBe(false);
  });

  it('should return false for Figma', () => {
    expect(isPersonalApp('Figma')).toBe(false);
  });

  it('should be case-insensitive', () => {
    expect(isPersonalApp('WHATSAPP')).toBe(true);
    expect(isPersonalApp('whatsapp')).toBe(true);
    expect(isPersonalApp('WhatsApp')).toBe(true);
  });
});

describe('normalizeAppNamesInRecord', () => {
  it('should normalize apps in a record', () => {
    const record = { id: 1, apps: ['vscode', 'slack'] };
    const result = normalizeAppNamesInRecord(record);
    expect(result.apps).toContain('VSCode');
    expect(result.apps).toContain('Slack');
  });

  it('should preserve other fields on the record', () => {
    const record = { id: 42, title: 'My Session', apps: ['figma'] };
    const result = normalizeAppNamesInRecord(record);
    expect(result.id).toBe(42);
    expect(result.title).toBe('My Session');
  });

  it('should deduplicate apps within a record', () => {
    const record = { apps: ['VSCode', 'vscode', 'slack'] };
    const result = normalizeAppNamesInRecord(record);
    expect(result.apps.filter((a) => a === 'VSCode').length).toBe(1);
    expect(result.apps).toContain('Slack');
  });

  it('should return empty apps array when all names are noisy', () => {
    const record = { apps: ['app', 'unknown', 'window'] };
    const result = normalizeAppNamesInRecord(record);
    expect(result.apps).toEqual([]);
  });

  it('should return sorted apps', () => {
    const record = { apps: ['Zoom', 'Figma', 'Notion'] };
    const result = normalizeAppNamesInRecord(record);
    expect(result.apps).toEqual([...result.apps].sort());
  });
});

describe('normalizeAppNamesInRecords', () => {
  it('should return empty array for empty input', () => {
    expect(normalizeAppNamesInRecords([])).toEqual([]);
  });

  it('should normalize apps across all records', () => {
    const records = [{ apps: ['vscode'] }, { apps: ['slack'] }];
    const result = normalizeAppNamesInRecords(records);
    expect(result[0].apps).toContain('VSCode');
    expect(result[1].apps).toContain('Slack');
  });

  it('should preserve other fields on each record', () => {
    const records = [
      { id: 1, label: 'first', apps: ['figma'] },
      { id: 2, label: 'second', apps: ['notion'] },
    ];
    const result = normalizeAppNamesInRecords(records);
    expect(result[0].id).toBe(1);
    expect(result[0].label).toBe('first');
    expect(result[1].id).toBe(2);
    expect(result[1].label).toBe('second');
  });

  it('should normalize the same app consistently across records', () => {
    const records = [{ apps: ['vscode'] }, { apps: ['VSCode'] }];
    const result = normalizeAppNamesInRecords(records);
    // Both should resolve to the same canonical form
    const allApps = result.flatMap((r) => r.apps);
    const uniqueApps = new Set(allApps);
    expect(uniqueApps.size).toBe(1);
    expect([...uniqueApps][0]).toBe('VSCode');
  });

  it('should filter noisy apps from records', () => {
    const records = [{ apps: ['unknown', 'app', 'vscode'] }];
    const result = normalizeAppNamesInRecords(records);
    expect(result[0].apps).not.toContain('unknown');
    expect(result[0].apps).not.toContain('app');
    expect(result[0].apps).toContain('VSCode');
  });

  it('should return apps sorted per record', () => {
    const records = [{ apps: ['Zoom', 'Figma', 'Notion'] }];
    const result = normalizeAppNamesInRecords(records);
    expect(result[0].apps).toEqual([...result[0].apps].sort());
  });
});
