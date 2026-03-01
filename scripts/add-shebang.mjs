#!/usr/bin/env node
/**
 * Post-build script: Prepends shebang to dist/index.js
 * Required because tsc strips shebang from source files
 */

import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distPath = join(__dirname, '..', 'dist', 'index.js');
const SHEBANG = '#!/usr/bin/env node\n';

try {
  const content = readFileSync(distPath, 'utf-8');
  
  if (content.startsWith('#!')) {
    console.log('Shebang already present in dist/index.js');
    process.exit(0);
  }
  
  writeFileSync(distPath, SHEBANG + content, 'utf-8');
  chmodSync(distPath, 0o755);
  
  console.log('Added shebang to dist/index.js');
} catch (error) {
  console.error('Failed to add shebang:', error.message);
  process.exit(1);
}
