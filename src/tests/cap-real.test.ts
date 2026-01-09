/**
 * Real Cap Recording Test
 *
 * Tests against actual Cap recordings on this machine.
 */

import { describe, expect, it } from 'vitest';
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
      expect(first.audioMicPath || first.audioSystemPath).toBeTruthy();
      if (first.audioMicPath) expect(first.audioMicPath).toContain('audio');
      if (first.audioSystemPath)
        expect(first.audioSystemPath).toContain('audio');
      expect(first.videoPath).toContain('display.mp4');
      expect(first.duration).toBe(0);

      console.log('First recording:', {
        id: first.id,
        prettyName: first.source.metadata?.pretty_name,
        audioMicPath: first.audioMicPath,
        audioSystemPath: first.audioSystemPath,
        videoPath: first.videoPath,
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
      expect(latest.audioMicPath || latest.audioSystemPath).toBeTruthy();
      expect(latest.videoPath).toContain('display.mp4');
      expect(latest.duration).toBe(0);
      expect(latest.capturedAt).toBeInstanceOf(Date);
    }
  }, 30000);

  it('should only return recordings with audio', async () => {
    const capSource = createCapSource({
      recordingsPath: '~/Library/Application Support/so.cap.desktop/recordings',
    });

    const recordings = await capSource.listRecordings(10);

    console.log(`Found ${recordings.length} recordings with audio`);

    recordings.forEach((recording) => {
      expect(recording.audioMicPath || recording.audioSystemPath).toBeTruthy();
      if (recording.audioMicPath) {
        expect(recording.audioMicPath).toContain('audio');
      }
      if (recording.audioSystemPath) {
        expect(recording.audioSystemPath).toContain('audio');
      }
    });
  }, 30000);
});
