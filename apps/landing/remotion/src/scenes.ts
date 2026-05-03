export type LineType = 'user' | 'cmd' | 'tool' | 'ok' | 'ai' | 'json' | 'out';

export interface TerminalLine {
  type: LineType;
  text: string;
}

export interface TerminalScene {
  title: string;
  loop: boolean;
  lines: TerminalLine[];
}

export const SCENES: Record<string, TerminalScene> = {
  'hero-query': {
    title: 'escribano',
    loop: true,
    lines: [
      { type: 'user', text: 'What was I debugging yesterday around 3pm?' },
      { type: 'out',  text: '' },
      { type: 'tool', text: 'escribano-query search "error" --since 26h' },
      { type: 'ok',   text: '4 observations found' },
      { type: 'out',  text: '' },
      { type: 'out',  text: '14:32  VS Code    middleware/auth.ts — 401 refresh' },
      { type: 'out',  text: '14:47  Terminal   git commit "fix: refresh token"' },
      { type: 'out',  text: '15:02  Browser    Stack Overflow — JWT expiry' },
      { type: 'out',  text: '' },
      { type: 'ai',   text: 'Yesterday at 14:32 you were debugging a JWT refresh bug in middleware/auth.ts. The fix landed at 14:47.' },
    ],
  },
  'agent-memory': {
    title: 'Claude Code',
    loop: true,
    lines: [
      { type: 'user', text: 'What did I work on yesterday around 3pm?' },
      { type: 'tool', text: 'escribano-query recent --since 26h --json' },
      { type: 'ok',   text: '3 activity clusters found' },
      { type: 'out',  text: '' },
      { type: 'out',  text: '14:32  VS Code       Debugging JWT refresh bug' },
      { type: 'out',  text: '14:47  Terminal      git commit "fix: refresh token"' },
      { type: 'out',  text: '16:40  GitHub        Reviewing PR #214' },
      { type: 'out',  text: '' },
      { type: 'ai',   text: 'Yesterday ~14:32 you were debugging a JWT refresh token bug in middleware/auth.ts. Fix landed at 14:47.' },
    ],
  },
  'forensic': {
    title: 'Terminal',
    loop: true,
    lines: [
      { type: 'cmd',  text: 'escribano-query search "ECONNREFUSED" --since 7d' },
      { type: 'out',  text: '' },
      { type: 'json', text: '{' },
      { type: 'json', text: '  "timestamp": "Tue 14:02",' },
      { type: 'json', text: '  "app":       "Terminal",' },
      { type: 'json', text: '  "text":      "postgres connection refused — port 5432"' },
      { type: 'json', text: '}' },
    ],
  },
  'pipeline': {
    title: 'zsh',
    loop: true,
    lines: [
      { type: 'cmd',  text: 'escribano-query entities --kind framework --since 24h \\' },
      { type: 'cmd',  text: '  | jq -r \'.entities[].value\' | sort -u' },
      { type: 'out',  text: '' },
      { type: 'out',  text: 'drizzle' },
      { type: 'out',  text: 'next.js' },
      { type: 'out',  text: 'react' },
      { type: 'out',  text: 'swift' },
    ],
  },
};

// Animation timing (in frames at 30fps)
export const TYPE_SPEED_FRAMES = 2;   // frames per character for typed lines
export const LINE_PAUSE_FRAMES = 14;  // frames between lines
export const LOOP_PAUSE_FRAMES = 150; // frames before restarting a scene

// Sigils for each line type
export const SIGILS: Record<LineType, string> = {
  user: '>',
  cmd:  '$',
  tool: '·',
  ok:   '✓',
  ai:   '↳',
  json: '',
  out:  '',
};

// Colors for each line type (matching landing page CSS)
export const LINE_COLORS: Record<LineType, string> = {
  user: '#e8e9ee',
  cmd:  '#f5f0e8',
  tool: '#9395a5',
  ok:   '#a3c49a',
  ai:   '#e8c79a',
  json: 'rgba(245,240,232,0.78)',
  out:  'rgba(245,240,232,0.62)',
};

export const SIGIL_COLORS: Record<LineType, string> = {
  user: '#7aa2f7',
  cmd:  '#d4734f',
  tool: '#9395a5',
  ok:   '#a3c49a',
  ai:   '#e8a838',
  json: '',
  out:  '',
};
