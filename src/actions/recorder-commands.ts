/**
 * Recorder CLI Commands
 *
 * recorder install — build escribano binary, install LaunchAgent plist
 * recorder status  — show agent state, pending frames, disk usage
 */

import { execSync, spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { ensureDb } from '../db/index.js';

const __filename = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = path.resolve(path.dirname(__filename), '..', '..');
const RECORDER_DIR = path.join(PACKAGE_ROOT, 'apps', 'recorder');
const BINARY_SRC = path.join(RECORDER_DIR, '.build', 'release', 'escribano');
const BIN_DIR = path.join(homedir(), '.escribano', 'bin');
const BINARY_DEST = path.join(BIN_DIR, 'escribano');
const PLIST_LABEL = 'com.escribano.capture';
// macOS 13+ requires the modern launchctl API (bootstrap/bootout) for GUI-domain
// LaunchAgents. The deprecated load/unload silently fails on Ventura/Sonoma.
const GUI_DOMAIN =
  process.platform === 'darwin' && typeof process.getuid === 'function'
    ? `gui/${process.getuid()}`
    : '';
const LAUNCHD_TARGET = `${GUI_DOMAIN}/${PLIST_LABEL}`;
const PLIST_PATH = path.join(
  homedir(),
  'Library',
  'LaunchAgents',
  `${PLIST_LABEL}.plist`
);
const LOGS_DIR = path.join(homedir(), '.escribano', 'logs');
const FRAMES_DIR = path.join(homedir(), '.escribano', 'frames');
const DB_PATH = path.join(homedir(), '.escribano', 'escribano.db');
const BRIDGE_SRC = path.join(PACKAGE_ROOT, 'scripts', 'mlx_bridge.py');
const SCRIPTS_DIR = path.join(homedir(), '.escribano', 'scripts');
const BRIDGE_DEST = path.join(SCRIPTS_DIR, 'mlx_bridge.py');
const DEFAULT_RECORDER_SOCKET_PATH = '/tmp/escribano-recorder-vlm.sock';
const RECORDER_SOCKET_PATH =
  process.env.ESCRIBANO_MLX_RECORDER_SOCKET ?? DEFAULT_RECORDER_SOCKET_PATH;

// ── install ──────────────────────────────────────────────────────────────────

export async function recorderInstall(): Promise<void> {
  // 1. Check for pre-built binary bundled with the npm package.
  //    Build it first with: pnpm build:recorder
  if (!existsSync(BUNDLED_BINARY)) {
    console.error(
      `Error: pre-built recorder binary not found at ${BUNDLED_BINARY}`
    );
    console.error('Build it first: pnpm build:recorder');
    console.error(
      '(This compiles the Swift binary and signs it with your Developer certificate.)'
    );
    process.exit(1);
  }

  // 2. Check apps/recorder/ exists (requires cloned repo for MVP)
  if (!existsSync(RECORDER_DIR)) {
    console.error(`Error: apps/recorder/ not found at ${RECORDER_DIR}`);
    console.error(
      'recorder install requires the Escribano repo to be cloned locally.'
    );
    process.exit(1);
  }

  // 3. Run Node.js DB migrations (ensures user_version is current)
  console.log('Initializing database and running migrations...');
  ensureDb();
  console.log('Database ready.');

  // 4. Build Swift binary
  console.log(
    'Building escribano-recorder (first build downloads MLX and may take several minutes)...'
  );
  const build = spawnSync(
    'swift',
    ['build', '--package-path', RECORDER_DIR, '-c', 'release'],
    { cwd: RECORDER_DIR, stdio: 'inherit', encoding: 'utf8' }
  );
  if (build.status !== 0) {
    console.error('Error: build failed. See output above.');
    process.exit(1);
  }

  if (!existsSync(BINARY_SRC)) {
    console.error(`Error: Binary not found at ${BINARY_SRC} after build.`);
    process.exit(1);
  }

  // 5. Copy binary to ~/.escribano/bin/
  mkdirSync(BIN_DIR, { recursive: true });
  execSync(`cp -f "${BINARY_SRC}" "${BINARY_DEST}"`);
  execSync(`chmod +x "${BINARY_DEST}"`);
  console.log(`Binary installed: ${BINARY_DEST}`);

  // 6. Copy mlx_bridge.py for the Python VLM bridge
  copyBridgeScript();

  // 7. Generate LaunchAgent plist
  mkdirSync(LOGS_DIR, { recursive: true });
  mkdirSync(path.dirname(PLIST_PATH), { recursive: true });
  const plist = generatePlist(BINARY_DEST);
  writeFileSync(PLIST_PATH, plist, 'utf8');
  console.log(`Plist written: ${PLIST_PATH}`);

  // 6. Unregister existing agent if present (ignore errors — may not be registered)
  try {
    execSync(`launchctl bootout ${LAUNCHD_TARGET} 2>/dev/null`);
  } catch {}

  // 7. Register LaunchAgent in the GUI domain (macOS 13+ requires bootstrap, not load)
  execSync(`launchctl bootstrap ${GUI_DOMAIN} "${PLIST_PATH}"`);
  console.log(`LaunchAgent registered: ${LAUNCHD_TARGET}`);
  console.log('');
  console.log('escribano-recorder installed successfully!');
  console.log('');
  console.log('NEXT STEP — Grant Screen Recording permission:');
  console.log(
    '  1. Open: System Settings > Privacy & Security > Screen Recording'
  );
  console.log(`  2. Enable: ${BINARY_DEST}`);
  console.log('');
  console.log('The recorder will retry automatically every 30 seconds.');
  console.log('Once permission is granted it will start capturing within 30s.');
  console.log(`Logs: ${LOGS_DIR}/escribano-recorder.log`);
}

function generatePlist(binaryPath: string): string {
  const stdout = path.join(LOGS_DIR, 'escribano-recorder.log');
  const stderr = path.join(LOGS_DIR, 'escribano-recorder.error.log');

  // Collect Escribano environment variables to inject into the LaunchAgent
  const envVars = Object.entries(process.env)
    .filter(([key]) => key.startsWith('ESCRIBANO_'))
    .map(
      ([key, value]) =>
        `        <key>${key}</key>\n        <string>${value}</string>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${binaryPath}</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
${envVars}
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${stdout}</string>
    <key>StandardErrorPath</key>
    <string>${stderr}</string>
</dict>
</plist>
`;
}

function copyBridgeScript(): void {
  if (!existsSync(BRIDGE_SRC)) {
    console.error(`Error: mlx_bridge.py not found at ${BRIDGE_SRC}`);
    process.exit(1);
  }
  mkdirSync(SCRIPTS_DIR, { recursive: true });
  execSync(`cp -f "${BRIDGE_SRC}" "${BRIDGE_DEST}"`);
  execSync(`chmod +x "${BRIDGE_DEST}"`);
  console.log(`Bridge script copied: ${BRIDGE_DEST}`);
}

// ── status ───────────────────────────────────────────────────────────────────

export async function recorderStatus(follow = false): Promise<void> {
  // LaunchAgent plist
  const plistInstalled = existsSync(PLIST_PATH);
  console.log(
    `LaunchAgent plist : ${plistInstalled ? `installed (${PLIST_PATH})` : 'not installed'}`
  );

  if (!plistInstalled) {
    console.log('Run: escribano recorder install');
    return;
  }

  // launchd status — use `launchctl print` (modern API, macOS 13+)
  try {
    const result = execSync(`launchctl print ${LAUNCHD_TARGET} 2>&1`, {
      encoding: 'utf8',
    });
    const pidMatch = result.match(/\bpid\s*=\s*(\d+)/i);
    let running: string;
    if (pidMatch) {
      const pid = Number(pidMatch[1]);
      running = pid > 0 ? `running (PID ${pid})` : 'stopped (will restart)';
    } else {
      running = 'stopped (will restart)';
    }
    console.log(`Agent status      : ${running}`);
  } catch {
    console.log(
      'Agent status      : not registered (run: escribano recorder install)'
    );
  }
  // Pending frames from DB
  if (existsSync(DB_PATH)) {
    try {
      const db = new Database(DB_PATH, { readonly: true });
      const row = db
        .prepare('SELECT COUNT(*) as cnt FROM frames WHERE analyzed = 0')
        .get() as { cnt: number };
      const tot = db.prepare('SELECT COUNT(*) as cnt FROM frames').get() as {
        cnt: number;
      };
      db.close();
      console.log(`Pending frames    : ${row.cnt} / ${tot.cnt} total`);
    } catch {
      console.log('Pending frames    : (DB unavailable)');
    }
  } else {
    console.log(`Pending frames    : (DB not found at ${DB_PATH})`);
  }

  // Bridge socket & logs
  if (existsSync(RECORDER_SOCKET_PATH)) {
    console.log(`VLM bridge socket : alive (${RECORDER_SOCKET_PATH})`);
  } else {
    console.log(`VLM bridge socket : missing (${RECORDER_SOCKET_PATH})`);
  }

  const logFile = path.join(LOGS_DIR, 'escribano-recorder.log');
  if (existsSync(logFile)) {
    try {
      const result = spawnSync('tail', ['-n', '20', logFile], { encoding: 'utf8' });
      console.log('Recent logs:');
      for (const line of (result.stdout ?? '').trimEnd().split('\n')) {
        console.log(`  ${line}`);
      }
    } catch {
      console.log(`Recent logs       : (error reading ${logFile})`);
    }
  } else {
    console.log('Recent logs       : (no log file yet)');
  }

  if (follow) {
    const errorLogFile = path.join(LOGS_DIR, 'escribano-recorder.error.log');
    console.log('\nFollowing logs (Ctrl+C to stop):\n');
    const filesToTail = [logFile];
    if (existsSync(errorLogFile)) {
      filesToTail.push(errorLogFile);
    }
    const tail = spawn('tail', ['-f', ...filesToTail], { stdio: 'inherit' });
    process.on('SIGINT', () => { tail.kill('SIGTERM'); process.exit(0); });
    process.on('SIGTERM', () => { tail.kill('SIGTERM'); process.exit(0); });
    await new Promise<void>((resolve) => tail.on('exit', () => resolve()));
  }
}

export async function recorderRestart(): Promise<void> {
  if (!existsSync(PLIST_PATH)) {
    console.error('Recorder not installed. Run: escribano recorder install');
    process.exit(1);
  }

  console.log('Stopping recorder...');
  try {
    // bootout unregisters the service from the GUI domain (macOS 13+ modern API)
    execSync(`launchctl bootout ${LAUNCHD_TARGET} 2>/dev/null`);
  } catch {
    console.warn(
      'Warning: unable to bootout LaunchAgent (it may not be registered)'
    );
  }

  await new Promise((resolve) => setTimeout(resolve, 1500));

  console.log('Starting recorder...');
  // bootstrap registers the service in the GUI domain (macOS 13+ modern API)
  execSync(`launchctl bootstrap ${GUI_DOMAIN} "${PLIST_PATH}"`);
  console.log('Recorder restarted. Run `escribano recorder status` to verify.');
}

function dirSizeBytes(dir: string): number {
  let total = 0;
  if (!existsSync(dir)) return 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += dirSizeBytes(full);
    } else {
      total += statSync(full).size;
    }
  }
  return total;
}
