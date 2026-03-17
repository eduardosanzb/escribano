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
  readFileSync,
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
  // 1. Check for the Swift CLI
  const swiftCheck = spawnSync('swift', ['--version'], {
    encoding: 'utf8',
  });
  if (swiftCheck.error || swiftCheck.status !== 0) {
    console.error('Error: swift command not found.');
    console.error(
      'Install Xcode or the Swift toolchain (https://developer.apple.com/xcode/ or https://swift.org/download/)'
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

  // 7. Unload existing agent if present (ignore errors)
  try {
    execSync(`launchctl unload "${PLIST_PATH}" 2>/dev/null`);
  } catch {}

  // 8. Load LaunchAgent
  execSync(`launchctl load "${PLIST_PATH}"`);
  console.log(`LaunchAgent loaded: ${PLIST_LABEL}`);
  console.log('escribano-recorder is now running and will start on login.');
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

  // launchd status
  try {
    const result = execSync(`launchctl list ${PLIST_LABEL} 2>&1`, {
      encoding: 'utf8',
    });
    const pidMatch = result.match(/"PID"\s*=\s*(\d+)/);
    const running = pidMatch
      ? `running (PID ${pidMatch[1]})`
      : 'stopped (will restart)';
    console.log(`Agent status      : ${running}`);
  } catch {
    console.log('Agent status      : stopped');
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
      const content = readFileSync(logFile, 'utf8').trim().split('\n');
      const tail = content.slice(-20);
      console.log('Recent logs:');
      for (const line of tail) {
        console.log(`  ${line}`);
      }
    } catch (error) {
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
    tail.on('exit', () => process.exit(0));
    await new Promise(() => {});
  }
}

export async function recorderRestart(): Promise<void> {
  if (!existsSync(PLIST_PATH)) {
    console.error('Recorder not installed. Run: escribano recorder install');
    process.exit(1);
  }

  console.log('Stopping recorder...');
  try {
    execSync(`launchctl unload "${PLIST_PATH}"`);
  } catch (error) {
    console.warn(
      'Warning: unable to unload LaunchAgent (it may not be running)'
    );
  }

  await new Promise((resolve) => setTimeout(resolve, 1500));

  console.log('Starting recorder...');
  execSync(`launchctl load "${PLIST_PATH}"`);
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
