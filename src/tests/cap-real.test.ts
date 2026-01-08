/**
 * Real Cap Recording Test
 *
 * Tests against actual Cap recordings on this machine.
 */

import { describe, it, expect } from 'vitest';
import { createCapSource } from '../adapters/cap.adapter';

describe('Cap Adapter - Real Recordings', () => {
  it('should list Cap recordings from filesystem', async () => {
    const capSource = createCapSource({
      recordingsPath: '~/Library/Application Support/so.cap.desktop/recordings',
    });

    const recordings = await capSource.listRecordings(5);

    console.log(`Found ${recordings.length} recordings`);

    // Should find at least 0 recordings (or fail gracefully)
    expect(Array.isArray(recordings)).toBe(true);

    if (recordings.length > 0) {
      const first = recordings[0];

      expect(first.id).toBeDefined();
      expect(first.source.type).toBe('cap');
      expect(first.audioPath).toContain('audio-input');

      console.log('First recording:', {
        id: first.id,
        prettyName: first.source.metadata?.prettyName,
        audioPath: first.audioPath,
        duration: first.duration,
      });
    }
  }, 30000); // 30s timeout

  it('should get latest recording', async () => {
    const capSource = createCapSource({
      recordingsPath: '~/Library/Application Support/so.cap.desktop/recordings',
    });

    const latest = await capSource.getLatestRecording();

    console.log('Latest recording:', latest);

    if (latest) {
      expect(latest).toBeDefined();
      expect(latest.audioPath).toBeDefined();
      expect(latest.capturedAt).toBeInstanceOf(Date);
    }
  }, 30000);
});
