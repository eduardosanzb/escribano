/**
 * Recorder CLI Commands
 *
 * recorder install — install pre-built escribano binary, register LaunchAgent plist
 * recorder status  — show agent state, pending frames, disk usage
 */

import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { ensureDb } from '../db/index.js';
import { rotateIfNeeded } from '../utils/log-rotation.js';

const __filename = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = path.resolve(path.dirname(__filename), '..', '..');
const BUNDLED_BINARY = path.join(PACKAGE_ROOT, 'bin', 'recorder-macos-arm64');
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
const DB_PATH = path.join(homedir(), '.escribano', 'escribano.db');
const BRIDGE_SRC = path.join(PACKAGE_ROOT, 'scripts', 'mlx_bridge.py');
const SCRIPTS_DIR = path.join(homedir(), '.escribano', 'scripts');
const BRIDGE_DEST = path.join(SCRIPTS_DIR, 'mlx_bridge.py');
const DEFAULT_RECORDER_SOCKET_PATH = '/tmp/escribano-recorder-vlm.sock';
const RECORDER_SOCKET_PATH =
  process.env.ESCRIBANO_MLX_RECORDER_SOCKET ?? DEFAULT_RECORDER_SOCKET_PATH;
const RECORDER_MLX_LOG = path.join(LOGS_DIR, 'mlx-bridge-recorder-vlm.log');

function rotateRecorderLogs(): void {
  rotateIfNeeded(path.join(LOGS_DIR, 'escribano-recorder.log'));
  rotateIfNeeded(path.join(LOGS_DIR, 'escribano-recorder.error.log'));
  rotateIfNeeded(RECORDER_MLX_LOG);
}

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

  // 2. Run Node.js DB migrations (ensures user_version is current)
  console.log('Initializing database and running migrations...');
  ensureDb();
  console.log('Database ready.');

  // 3. Copy binary to ~/.escribano/bin/
  mkdirSync(BIN_DIR, { recursive: true });
  execSync(`cp -f "${BUNDLED_BINARY}" "${BINARY_DEST}"`);
  execSync(`chmod +x "${BINARY_DEST}"`);
  console.log(`Binary installed: ${BINARY_DEST}`);

  // 4. Copy mlx_bridge.py for the Python VLM bridge
  copyBridgeScript();

  // 5. Rotate logs and generate LaunchAgent plist
  mkdirSync(LOGS_DIR, { recursive: true });
  rotateRecorderLogs();
  mkdirSync(path.dirname(PLIST_PATH), { recursive: true });
  const plist = generatePlist(BINARY_DEST);
  writeFileSync(PLIST_PATH, plist, 'utf8');
  console.log(`Plist written: ${PLIST_PATH}`);

  // 6. Unload existing agent if present (ignore errors)
  try {
    execSync(`launchctl bootout ${LAUNCHD_TARGET} 2>/dev/null`);
  } catch {}

  // 7. Load LaunchAgent
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
  console.log(
    'The recorder will retry automatically every 30 seconds. (Unless you are using dev mode; then you must restart it manually with `pnpm recorder:dev`.)'
  );
  console.log('Once permission is granted it will start capturing within 30s.');
  console.log(`Logs: ${LOGS_DIR}/escribano-recorder.log`);
}

function generatePlist(binaryPath: string): string {
  const stdout = path.join(LOGS_DIR, 'escribano-recorder.log');
  const stderr = path.join(LOGS_DIR, 'escribano-recorder.error.log');

  // Collect Escribano environment variables to inject into the LaunchAgent
  const envMap: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('ESCRIBANO_') && value !== undefined) {
      envMap[key] = value;
    }
  }
  envMap.ESCRIBANO_MLX_LOG_FILE = RECORDER_MLX_LOG;

  const envVars = Object.entries(envMap)
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
    <key>ThrottleInterval</key>
    <integer>30</integer>
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
      const content = readFileSync(logFile, 'utf8').trim().split('\n');
      const tail = content.slice(-20);
      console.log('Recent logs:');
      for (const line of tail) {
        console.log(`  ${line}`);
      }
    } catch (_error) {
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
    if (existsSync(RECORDER_MLX_LOG)) {
      filesToTail.push(RECORDER_MLX_LOG);
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
    execSync(`launchctl bootout ${LAUNCHD_TARGET} 2>/dev/null`);
  } catch (_error) {
    console.warn(
      'Warning: unable to bootout LaunchAgent (it may not be running)'
    );
  }

  // Wait for the process to exit cleanly, then force-kill any stragglers.
  // 1.5s is not enough when the process is mid-inference or waiting for backpressure.
  await new Promise((resolve) => setTimeout(resolve, 2000));
  try {
    execSync(`pkill -KILL -f "${BINARY_DEST}" 2>/dev/null`);
  } catch {} // ignore: process already gone
  await new Promise((resolve) => setTimeout(resolve, 500));

  rotateRecorderLogs();
  console.log('Starting recorder...');
  execSync(`launchctl bootstrap ${GUI_DOMAIN} "${PLIST_PATH}"`);
  console.log('Recorder restarted. Run `escribano recorder status` to verify.');
}
