/**
 * Cap Adapter Tests
 */

import { describe, it, expect } from 'vitest';
import { createCapSource } from '../adapters/cap.adapter';
import type { Recording } from '../0_types';

describe('Cap Adapter', () => {
  it('should create a CapSource', () => {
    const capSource = createCapSource({
      recordingsPath: '~/tmp/recordings',
    });

    expect(capSource).toBeDefined();
    expect(capSource.getLatestRecording).toBeInstanceOf(Function);
  });

  it('should handle nonexistent directory gracefully', async () => {
    const capSource = createCapSource({
      recordingsPath: '/nonexistent/path',
    });

    const latest = await capSource.getLatestRecording();
    expect(latest).toBeNull();
  });
});
