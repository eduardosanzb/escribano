import {
  access,
  chmod,
  constants,
  mkdir,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const VIDEO_EXTENSIONS = ['.mov', '.mp4', '.mkv', '.avi', '.webm'];

function expandPath(inputPath: string): string {
  if (!inputPath.startsWith('~')) {
    return inputPath;
  }

  const homeDir = homedir();
  if (!homeDir) {
    return inputPath;
  }

  if (inputPath === '~' || inputPath === '~/') {
    return homeDir;
  }

  if (inputPath.startsWith('~/')) {
    return path.join(homeDir, inputPath.slice(2));
  }

  return inputPath;
}

async function findLatestVideo(dirPath: string): Promise<string> {
  const resolvedPath = expandPath(dirPath);

  const entries = await readdir(resolvedPath, { withFileTypes: true });

  const videoFiles = entries.filter(
    (entry) =>
      entry.isFile() &&
      VIDEO_EXTENSIONS.some((ext) => entry.name.toLowerCase().endsWith(ext))
  );

  if (videoFiles.length === 0) {
    throw new Error(`No video files found in: ${resolvedPath}`);
  }

  let latestFilePath: string | null = null;
  let latestMtime = -Infinity;

  for (const entry of videoFiles) {
    const fullPath = path.join(resolvedPath, entry.name);
    try {
      await access(fullPath, constants.R_OK);
      const fileStat = await stat(fullPath);
      const mtimeMs = fileStat.mtime.getTime();
      if (mtimeMs > latestMtime) {
        latestMtime = mtimeMs;
        latestFilePath = fullPath;
      }
    } catch {
      // Skip files that are inaccessible (permission denied, broken symlink, etc.)
    }
  }

  if (!latestFilePath) {
    throw new Error(`No accessible video files found in: ${resolvedPath}`);
  }

  return latestFilePath;
}

describe('findLatestVideo', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `escribano-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('returns the most recently modified video file', async () => {
    const file1 = path.join(testDir, 'old.mp4');
    const file2 = path.join(testDir, 'new.mov');

    await writeFile(file1, 'old');
    await new Promise((r) => setTimeout(r, 10));
    await writeFile(file2, 'new');

    const result = await findLatestVideo(testDir);
    expect(result).toBe(file2);
  });

  it('skips broken symlinks and returns valid file', async () => {
    const validFile = path.join(testDir, 'valid.mp4');
    const brokenLink = path.join(testDir, 'broken.mov');

    await writeFile(validFile, 'content');
    await symlink('/nonexistent/path.mp4', brokenLink);

    const result = await findLatestVideo(testDir);
    expect(result).toBe(validFile);
  });

  it('skips files with permission denied and returns valid file', async () => {
    const readable = path.join(testDir, 'readable.mp4');
    const unreadable = path.join(testDir, 'unreadable.mov');

    await writeFile(readable, 'content');
    await writeFile(unreadable, 'content');
    await chmod(unreadable, 0o000);

    const result = await findLatestVideo(testDir);
    expect(result).toBe(readable);
  });

  it('throws when no video files exist', async () => {
    await writeFile(path.join(testDir, 'file.txt'), 'not a video');

    await expect(findLatestVideo(testDir)).rejects.toThrow(
      'No video files found'
    );
  });

  it('throws when all video files are inaccessible', async () => {
    const broken = path.join(testDir, 'broken.mov');
    await symlink('/nonexistent', broken);

    await chmod(testDir, 0o111);

    try {
      await expect(findLatestVideo(testDir)).rejects.toThrow();
    } finally {
      await chmod(testDir, 0o755);
    }
  });

  it('expands ~ to home directory', () => {
    const result = expandPath('~/Videos/test.mp4');
    expect(result).toMatch(/\/Videos\/test\.mp4$/);
    expect(result).not.toContain('~');
  });

  it('handles various video extensions', async () => {
    const files = ['a.mov', 'b.mp4', 'c.mkv', 'd.avi', 'e.webm'];
    for (const f of files) {
      await writeFile(path.join(testDir, f), 'content');
    }

    const result = await findLatestVideo(testDir);
    expect(result).toMatch(/\.(mov|mp4|mkv|avi|webm)$/);
  });
});
