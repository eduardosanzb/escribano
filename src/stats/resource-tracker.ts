import os from 'node:os';
import pidusage from 'pidusage';
import type {
  ResourceSnapshot,
  ResourceStats,
  ResourceTrackable,
  SystemInfo,
} from './types.js';

export class ResourceTracker {
  private resources: Map<string, ResourceTrackable> = new Map();
  private samples: Map<string, { memories: number[]; cpus: number[] }> =
    new Map();
  private interval: NodeJS.Timeout | null = null;
  private running = false;

  register(resource: ResourceTrackable): void {
    const name = resource.getResourceName();
    if (!this.resources.has(name)) {
      this.resources.set(name, resource);
      this.samples.set(name, { memories: [], cpus: [] });
    }
  }

  async start(intervalMs = 1000): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Register nodejs itself if not already registered
    if (!this.resources.has('nodejs')) {
      this.register({
        getResourceName: () => 'nodejs',
        getPid: () => process.pid,
      });
    }

    // Initial sample
    await this.sample();

    this.interval = setInterval(() => {
      this.sample().catch(() => {});
    }, intervalMs);
  }

  private async sample(): Promise<void> {
    for (const [name, resource] of this.resources) {
      const pid = resource.getPid();
      if (!pid) continue;

      try {
        const stats = await pidusage(pid);
        const sample = this.samples.get(name);
        if (sample) {
          sample.memories.push(stats.memory / 1024 / 1024);
          sample.cpus.push(stats.cpu);
        }
      } catch {
        // Process exited or not found - skip
      }
    }
  }

  stop(): ResourceSnapshot {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.running = false;

    const result: ResourceSnapshot = {};
    for (const [name, sample] of this.samples) {
      if (sample.memories.length === 0) continue;

      const avgMem =
        sample.memories.reduce((a, b) => a + b, 0) / sample.memories.length;
      const avgCpu =
        sample.cpus.reduce((a, b) => a + b, 0) / sample.cpus.length;

      result[name] = {
        peakMemoryMB: Math.round(Math.max(...sample.memories)),
        avgMemoryMB: Math.round(avgMem),
        peakCpuPercent: Math.round(Math.max(...sample.cpus) * 10) / 10,
        avgCpuPercent: Math.round(avgCpu * 10) / 10,
        sampleCount: sample.memories.length,
      };
    }

    // Reset samples for next phase
    for (const name of this.samples.keys()) {
      this.samples.set(name, { memories: [], cpus: [] });
    }

    return result;
  }

  getSystemInfo(): SystemInfo {
    return {
      totalMemoryGB: Math.round(os.totalmem() / 1024 / 1024 / 1024),
      cpuCores: os.cpus().length,
      platform: process.platform,
    };
  }

  isRunning(): boolean {
    return this.running;
  }
}
