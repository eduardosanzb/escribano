#!/usr/bin/env node
import { spawnSync, execSync } from 'node:child_process';
import process from 'node:process';

const REFRESH_INTERVAL_MS = Number(process.env.RESOURCE_MONITOR_INTERVAL_MS ?? '2000');
const RECORDER_PATTERN = 'recorder/.build/release/escribano';
const BRIDGE_PATTERN = 'mlx_bridge.py';
const CLEAR = '\u001b[2J\u001b[0;0H';

type ProcessSample = {
  pid: number;
  cpu: number;
  mem: number;
  rssKb: number;
  etime: string;
  command: string;
};

const prevRss = new Map<number, number>();

function pad(value: string, width: number, rightAlign = false): string {
  const str = value ?? '';
  if (str.length >= width) {
    return rightAlign ? str.slice(-width) : str.slice(0, width);
  }
  return rightAlign
    ? ' '.repeat(width - str.length) + str
    : str + ' '.repeat(width - str.length);
}

function findPids(pattern: string): number[] {
  const result = spawnSync('pgrep', ['-f', pattern], { encoding: 'utf-8' });
  if (result.status !== 0 || !result.stdout.trim()) {
    return [];
  }
  return result.stdout
    .trim()
    .split(/\s+/)
    .map((pid) => Number(pid))
    .filter((pid) => !Number.isNaN(pid));
}

function fetchProcess(pid: number): ProcessSample | null {
  const result = spawnSync(
    'ps',
    ['-o', 'pid=,%cpu=,%mem=,rss=,etime=,command=', '-p', String(pid)],
    { encoding: 'utf-8' }
  );
  if (result.status !== 0 || !result.stdout.trim()) {
    return null;
  }
  const line = result.stdout.trim();
  const parts = line.split(/\s+/);
  if (parts.length < 6) {
    return null;
  }
  const pidValue = Number(parts[0]);
  const cpu = Number(parts[1]);
  const mem = Number(parts[2]);
  const rssKb = Number(parts[3]);
  const etime = parts[4];
  const command = parts.slice(5).join(' ');
  if ([pidValue, cpu, mem, rssKb].some((n) => Number.isNaN(n))) {
    return null;
  }
  return { pid: pidValue, cpu, mem, rssKb, etime, command };
}

function sampleProcesses(pids: number[]): ProcessSample[] {
  const seen = new Set<number>();
  return pids
    .filter((pid) => {
      if (seen.has(pid)) return false;
      seen.add(pid);
      return true;
    })
    .map(fetchProcess)
    .filter((sample): sample is ProcessSample => sample !== null);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) {
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  }
  if (bytes >= 1024 ** 2) {
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  }
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatRss(kb: number): string {
  return formatBytes(kb * 1024);
}

function convertUnit(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const unit = trimmed.slice(-1).toUpperCase();
  const num = Number(trimmed.slice(0, -1));
  if (Number.isNaN(num)) return 0;
  switch (unit) {
    case 'G':
      return num * 1024 ** 3;
    case 'M':
      return num * 1024 ** 2;
    case 'K':
      return num * 1024;
    default:
      return num;
  }
}

function getMemoryInfo(): { text: string } | null {
  try {
    const totalBytes = Number(execSync('sysctl -n hw.memsize', { encoding: 'utf-8' }).trim());
    if (Number.isNaN(totalBytes) || totalBytes <= 0) {
      return null;
    }
    const physMem = execSync('top -l 1 -n 0 | grep PhysMem', { encoding: 'utf-8' }).trim();
    const usedMatch = physMem.match(/PhysMem:\s+([\d.]+[GMK])\s+used/);
    if (!usedMatch) {
      return null;
    }
    const usedBytes = convertUnit(usedMatch[1]);
    const percent = ((usedBytes / totalBytes) * 100).toFixed(1);
    return {
      text: `System RAM: ${formatBytes(usedBytes)} / ${formatBytes(totalBytes)} (${percent}%)`,
    };
  } catch {
    return null;
  }
}

function isRecorder(command: string): boolean {
  return command.includes(RECORDER_PATTERN);
}

function isBridge(command: string): boolean {
  return /mlx_bridge\.py|escribano-bridge/i.test(command);
}

type Row = {
  label: string;
  pid: number;
  cpu: string;
  mem: string;
  rss: string;
  trend: string;
  etime: string;
};

function buildRow(label: string, sample: ProcessSample): Row {
  const previousRss = prevRss.get(sample.pid);
  let trend = '─';
  if (previousRss !== undefined) {
    trend = sample.rssKb > previousRss ? '▲' : sample.rssKb < previousRss ? '▼' : '─';
  }
  prevRss.set(sample.pid, sample.rssKb);
  return {
    label,
    pid: sample.pid,
    cpu: `${sample.cpu.toFixed(1)}%`,
    mem: `${sample.mem.toFixed(1)}%`,
    rss: formatRss(sample.rssKb),
    trend,
    etime: sample.etime,
  };
}

function render(rows: Row[], memoryInfo: string | null): void {
  process.stdout.write(CLEAR);
  const timestamp = new Date().toLocaleTimeString();
  console.log(`Escribano Resource Monitor • refresh ${(REFRESH_INTERVAL_MS / 1000).toFixed(1)}s • ${timestamp}`);
  console.log();
  if (!rows.length) {
    console.log('No recorder or bridge processes detected. Start `pnpm recorder:dev` to monitor resource usage.');
  } else {
    console.log('  Process               PID    CPU%   MEM%    RSS        △    Uptime');
    console.log('  ────────────────────────────────────────────────────────────────────────');
    for (const row of rows) {
      console.log(
        `  ${pad(row.label, 20)} ${pad(String(row.pid), 6, true)} ${pad(row.cpu, 7, true)} ${pad(row.mem, 7, true)} ${pad(row.rss, 10, true)} ${pad(row.trend, 3, true)} ${pad(row.etime, 12, true)}`
      );
    }
  }
  console.log();
  console.log(memoryInfo ?? 'System RAM: (unavailable)');
  console.log('Press Ctrl+C to exit.');
}

function gatherRows(): Row[] {
  const recorderPids = findPids(RECORDER_PATTERN);
  const bridgePids = findPids(BRIDGE_PATTERN);
  const samples = sampleProcesses([...recorderPids, ...bridgePids]);
  const rows: Row[] = [];
  for (const sample of samples) {
    if (isRecorder(sample.command)) {
      rows.push(buildRow('recorder (Swift)', sample));
    }
  }
  let bridgeIndex = 1;
  for (const sample of samples) {
    if (isBridge(sample.command)) {
      rows.push(buildRow(`bridge-vlm #${bridgeIndex}`, sample));
      bridgeIndex += 1;
    }
  }
  return rows;
}

function main(): void {
  render([], null);
  const interval = setInterval(() => {
    const memory = getMemoryInfo();
    const rows = gatherRows();
    render(rows, memory?.text ?? null);
  }, REFRESH_INTERVAL_MS);

  process.on('SIGINT', () => {
    clearInterval(interval);
    console.log('\nStopping Escribano resource monitor.');
    process.exit(0);
  });
}

main();
