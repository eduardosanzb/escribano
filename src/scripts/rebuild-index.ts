/**
 * Escribano - Rebuild Index Script
 *
 * Rebuilds the global session index in Outline without reprocessing recordings.
 * Use this when the index gets out of sync with published summaries.
 */

import type { OutlineConfig } from '../0_types.js';
import { updateGlobalIndex } from '../actions/outline-index.js';
import { createOutlinePublishingService } from '../adapters/publishing.outline.adapter.js';
import { getDbPath, getRepositories } from '../db/index.js';

function getOutlineConfig(): OutlineConfig | null {
  const url = process.env.ESCRIBANO_OUTLINE_URL;
  const token = process.env.ESCRIBANO_OUTLINE_TOKEN;

  if (!url || !token) {
    console.error(
      'Error: ESCRIBANO_OUTLINE_URL and ESCRIBANO_OUTLINE_TOKEN must be set'
    );
    return null;
  }

  return {
    url,
    token,
    collectionName:
      process.env.ESCRIBANO_OUTLINE_COLLECTION ?? 'Escribano Sessions',
  };
}

async function main(): Promise<void> {
  console.log('Escribano - Rebuild Index');
  console.log('');

  const outlineConfig = getOutlineConfig();
  if (!outlineConfig) {
    process.exit(1);
  }

  // Initialize database
  console.log('Initializing database...');
  const repos = getRepositories();
  console.log(`Database ready: ${getDbPath()}`);
  console.log('');

  // Get count of published recordings
  const publishedRecordings = repos.recordings.findByStatus('published');
  console.log(`Found ${publishedRecordings.length} published recordings`);
  console.log('');

  // Initialize publishing service
  const publishing = createOutlinePublishingService(outlineConfig);

  // Update global index
  console.log('Rebuilding global index...');
  const indexResult = await updateGlobalIndex(repos, publishing, {
    collectionName: outlineConfig.collectionName,
  });

  console.log('');
  console.log('✓ Index rebuilt successfully!');
  console.log(`Index URL: ${indexResult.url}`);
}

main().catch((error) => {
  console.error('Error:', (error as Error).message);
  process.exit(1);
});
