import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CapConfig, CaptureSource, Recording } from '../0_types.js';
import { capConfigSchema } from '../0_types.js';

function expandPath(path: string): string {
  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

async function parseCapRecording(
  capDirPath: string
): Promise<Recording | null> {
  try {
    const metaPath = join(capDirPath, 'recording-meta.json');
    const metaContent = await readFile(metaPath, 'utf-8');
    const meta = JSON.parse(metaContent);

    if (
      !meta.segments ||
      !Array.isArray(meta.segments) ||
      meta.segments.length === 0
    ) {
      throw new Error(
        `Invalid metadata in ${capDirPath}: missing or empty segments array`
      );
    }

    const firstSegment = meta.segments[0];

    const videoPath = firstSegment.display?.path
      ? join(capDirPath, firstSegment.display.path)
      : null;

    // we fked up cuz we have mic but also system_audio.ogg
    const micAudio = firstSegment.mic?.path
      ? join(capDirPath, firstSegment.mic.path)
      : null;

    const systemAudio = firstSegment.system_audio?.path
      ? join(capDirPath, firstSegment.system_audio.path)
      : null;

    const audioToStat = micAudio || systemAudio;

    if (!audioToStat) {
      console.log(`Skipping ${capDirPath}: none audio track found`);
      return null;
    }

    const stats = await stat(audioToStat);
    const capturedAt = stats.mtime;

    const recordingId = capDirPath.split('/').pop() || 'unknown';

    return {
      id: recordingId,
      source: {
        type: 'cap',
        originalPath: capDirPath,
        metadata: meta,
      },
      videoPath,
      audioMicPath: micAudio ? micAudio : null,
      audioSystemPath: systemAudio ? systemAudio : null,
      duration: 0,
      capturedAt,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Recording directory or files not found: ${capDirPath}`);
    }
    if ((error as SyntaxError).name === 'SyntaxError') {
      throw new Error(`Invalid JSON in recording-meta.json at ${capDirPath}`);
    }
    throw new Error(
      `Failed to parse recording at ${capDirPath}: ${(error as Error).message}`
    );
  }
}

export function createCapSource(
  config: Partial<CapConfig> = {}
): CaptureSource {
  const parsedConfig = capConfigSchema.parse(config);
  const recordingsPath = expandPath(parsedConfig.recordingsPath);

  const innerList = async (limit = 10): Promise<Recording[]> => {
    try {
      //
      // 7 directories, 5 files
      const entries = await readdir(recordingsPath, { withFileTypes: true });

      const capDirs = entries.filter(
        (entry) => entry.isDirectory() && entry.name.endsWith('.cap')
      );

      const recordings = await Promise.allSettled(
        capDirs.map(async (dir) =>
          parseCapRecording(join(recordingsPath, dir.name))
        )
      );
      // logging errors
      console.log(
        recordings
          .filter((p) => p.status === 'rejected')
          .map((p) => (p as PromiseRejectedResult).reason + '\n')
      );

      return recordings
        .filter((p) => p.status === 'fulfilled')
        .map((x) => x.value)
        .filter((r) => r !== null)
        .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())
        .slice(0, limit);
    } catch (error) {
      console.error('Failed to list Cap recordings:', error);
      return [];
    }
  };

  return {
    getLatestRecording: () =>
      innerList(1).then((recordings) => recordings[0] ?? null),
    listRecordings: innerList,
  };
}
