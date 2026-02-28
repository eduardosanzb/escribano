/**
 * Escribano - App Name Normalization Service
 *
 * Normalizes and deduplicates app names extracted from VLM descriptions.
 * Uses fuzzy matching and known alias maps to produce consistent app names.
 */

const KNOWN_ALIASES: Record<string, string> = {
  ghosty: 'Ghostty',
  ghosttie: 'Ghostty',
  'ghostty terminal': 'Ghostty',
  iterm: 'iTerm',
  iterm2: 'iTerm',
  'iterm 2': 'iTerm',
  'vs code': 'VSCode',
  'visual studio code': 'VSCode',
  vscode: 'VSCode',
  'visual studio': 'VSCode',
  chrome: 'Google Chrome',
  'google chrome': 'Google Chrome',
  safari: 'Safari',
  firefox: 'Firefox',
  slack: 'Slack',
  zoom: 'Zoom',
  'google meet': 'Google Meet',
  teams: 'Microsoft Teams',
  'microsoft teams': 'Microsoft Teams',
  discord: 'Discord',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  notion: 'Notion',
  figma: 'Figma',
  github: 'GitHub',
  gitlab: 'GitLab',
  bitbucket: 'Bitbucket',
  terminal: 'Terminal',
  finder: 'Finder',
  mail: 'Mail',
  gmail: 'Gmail',
  calendar: 'Calendar',
  notes: 'Notes',
  spotify: 'Spotify',
  music: 'Music',
  photos: 'Photos',
  preview: 'Preview',
  quicktime: 'QuickTime Player',
  'quicktime player': 'QuickTime Player',
  'activity monitor': 'Activity Monitor',
  'system preferences': 'System Preferences',
  settings: 'System Settings',
  'system settings': 'System Settings',
  tableplus: 'TablePlus',
  postgres: 'PostgreSQL',
  postgresql: 'PostgreSQL',
  sqlite: 'SQLite',
  sqlitebrowser: 'SQLite',
};

const NOISY_APP_NAMES = new Set([
  'a',
  'the',
  'and',
  'or',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'with',
  'unknown',
  'unidentified',
  'application',
  'app',
  'program',
  'software',
  'window',
  'screen',
  'desktop',
  'mac os',
  'macos',
  'os x',
  'operating system',
]);

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

function normalizeAppName(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (KNOWN_ALIASES[normalized]) {
    return KNOWN_ALIASES[normalized];
  }

  for (const [alias, canonical] of Object.entries(KNOWN_ALIASES)) {
    if (normalized.includes(alias)) {
      return canonical;
    }
  }

  return name.trim();
}

function isNoisyAppName(name: string): boolean {
  const normalized = name.toLowerCase().trim();
  if (NOISY_APP_NAMES.has(normalized)) return true;
  if (normalized.length < 2) return true;
  if (normalized.length > 50) return true;
  return false;
}

function fuzzyMatchAppName(
  name: string,
  knownApps: Set<string>
): string | null {
  const normalized = normalizeAppName(name);

  if (isNoisyAppName(normalized)) return null;

  for (const known of knownApps) {
    const distance = levenshteinDistance(
      normalized.toLowerCase(),
      known.toLowerCase()
    );
    const maxLen = Math.max(normalized.length, known.length);
    const similarity = 1 - distance / maxLen;

    if (similarity >= 0.85) {
      return known;
    }
  }

  return null;
}

export function normalizeAppNames(apps: string[]): string[] {
  if (apps.length === 0) return [];

  const normalizedApps: string[] = [];
  const knownApps = new Set<string>();

  const sortedApps = [...apps].sort((a, b) => a.length - b.length);

  for (const app of sortedApps) {
    const trimmed = app.trim();
    if (!trimmed) continue;

    let normalized = normalizeAppName(trimmed);

    if (isNoisyAppName(normalized)) continue;

    const fuzzyMatch = fuzzyMatchAppName(normalized, knownApps);
    if (fuzzyMatch) {
      normalized = fuzzyMatch;
    } else {
      knownApps.add(normalized);
    }

    if (!normalizedApps.includes(normalized)) {
      normalizedApps.push(normalized);
    }
  }

  return normalizedApps.sort();
}

export function normalizeAppNamesInRecord<T extends { apps: string[] }>(
  record: T
): T {
  return {
    ...record,
    apps: normalizeAppNames(record.apps),
  };
}

export function normalizeAppNamesInRecords<T extends { apps: string[] }>(
  records: T[]
): T[] {
  const allApps = records.flatMap((r) => r.apps);
  const globalNormalized = normalizeAppNames(allApps);

  const appMapping = new Map<string, string>();
  for (const app of allApps) {
    const normalized = normalizeAppName(app);
    const fuzzyMatch = fuzzyMatchAppName(normalized, new Set(globalNormalized));
    appMapping.set(app, fuzzyMatch || normalized);
  }

  return records.map((record) => ({
    ...record,
    apps: record.apps
      .map((app) => appMapping.get(app) || normalizeAppName(app))
      .filter((app) => !isNoisyAppName(app))
      .filter((app, index, arr) => arr.indexOf(app) === index)
      .sort(),
  }));
}

export function isPersonalApp(app: string): boolean {
  const normalized = app.toLowerCase().trim();
  const personalApps = [
    'whatsapp',
    'instagram',
    'tiktok',
    'telegram',
    'facebook',
    'twitter',
    'snapchat',
    'discord',
    'messenger',
    'signal',
    'facetime',
    'imessage',
    'messages',
  ];
  return personalApps.some((personal) => normalized.includes(personal));
}
