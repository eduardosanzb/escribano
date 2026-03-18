import { ensureEscribanoVenv } from '../src/python-deps.js';

async function main(): Promise<void> {
  try {
    const pythonPath = ensureEscribanoVenv();
    console.log(`[VLM] Using Python at ${pythonPath}`);
  } catch (error) {
    console.error('[VLM] Failed to prepare Python environment:', error);
    process.exit(1);
  }
}

main();
