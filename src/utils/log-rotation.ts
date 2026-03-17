import { existsSync, renameSync, statSync, unlinkSync } from 'node:fs';

const DEFAULT_MAX_BYTES = Number(
  process.env.ESCRIBANO_LOG_MAX_BYTES ?? '10485760'
);

export function rotateIfNeeded(
  filePath: string,
  maxBytes = DEFAULT_MAX_BYTES
): void {
  try {
    if (!existsSync(filePath)) {
      return;
    }

    const { size } = statSync(filePath);
    if (size < maxBytes) {
      return;
    }

    const rotated = `${filePath}.1`;
    if (existsSync(rotated)) {
      unlinkSync(rotated);
    }
    renameSync(filePath, rotated);
  } catch {
    // ignore rotation failures; best-effort only
  }
}
