import { existsSync, renameSync, statSync } from 'node:fs';

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

export function rotateIfNeeded(
  filePath: string,
  maxBytes = DEFAULT_MAX_BYTES
): void {
  if (!existsSync(filePath)) return;

  const size = statSync(filePath).size;
  if (size < maxBytes) return;

  const rotatedPath = `${filePath}.1`;
  if (existsSync(rotatedPath)) {
    renameSync(rotatedPath, `${filePath}.2`);
  }

  renameSync(filePath, rotatedPath);
}
