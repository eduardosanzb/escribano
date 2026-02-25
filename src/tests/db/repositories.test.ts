/**
 * Repository Interface Tests
 *
 * These tests run against the interface, not the implementation.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  ContextRepository,
  ObservationRepository,
  RecordingRepository,
} from '../../0_types.js';
import { generateId } from '../../db/helpers.js';
import { createTestRepositories } from '../../db/index.js';

// =============================================================================
// Interface Test Factories
// =============================================================================

function runRecordingRepositoryTests(
  name: string,
  createRepo: () => { repo: RecordingRepository; cleanup: () => void }
) {
  describe(`RecordingRepository: ${name}`, () => {
    let repo: RecordingRepository;
    let cleanup: () => void;

    beforeEach(() => {
      const result = createRepo();
      repo = result.repo;
      cleanup = result.cleanup;
    });

    afterEach(() => {
      cleanup();
    });

    it('saves and retrieves a recording', () => {
      const id = generateId();
      repo.save({
        id,
        video_path: '/path/to/video.mp4',
        audio_mic_path: '/path/to/mic.ogg',
        audio_system_path: null,
        duration: 120.5,
        captured_at: '2026-01-20T10:00:00Z',
        status: 'raw',
        processing_step: null,
        source_type: 'cap',
        source_metadata: null,
        error_message: null,
      });

      const found = repo.findById(id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(id);
      expect(found!.duration).toBe(120.5);
      expect(found!.status).toBe('raw');
    });

    it('returns null for non-existent recording', () => {
      const found = repo.findById('nonexistent');
      expect(found).toBeNull();
    });

    it('updates status and processing step', () => {
      const id = generateId();
      repo.save({
        id,
        video_path: null,
        audio_mic_path: '/path/to/mic.ogg',
        audio_system_path: null,
        duration: 60,
        captured_at: '2026-01-20T10:00:00Z',
        status: 'raw',
        processing_step: null,
        source_type: 'cap',
        source_metadata: null,
        error_message: null,
      });

      repo.updateStatus(id, 'processing', 'clustering');

      const found = repo.findById(id);
      expect(found!.status).toBe('processing');
      expect(found!.processing_step).toBe('clustering');
    });

    it('finds pending recordings', () => {
      const id1 = generateId();
      const id2 = generateId();

      repo.save({
        id: id1,
        video_path: null,
        audio_mic_path: '/path/1.ogg',
        audio_system_path: null,
        duration: 60,
        captured_at: '2026-01-20T10:00:00Z',
        status: 'raw',
        processing_step: null,
        source_type: 'cap',
        source_metadata: null,
        error_message: null,
      });

      repo.save({
        id: id2,
        video_path: null,
        audio_mic_path: '/path/2.ogg',
        audio_system_path: null,
        duration: 60,
        captured_at: '2026-01-20T11:00:00Z',
        status: 'processed',
        processing_step: 'complete',
        source_type: 'cap',
        source_metadata: null,
        error_message: null,
      });

      const pending = repo.findPending();
      expect(pending.some((p) => p.id === id1)).toBe(true);
      expect(pending.some((p) => p.id === id2)).toBe(false);
    });

    it('deletes a recording', () => {
      const id = generateId();
      repo.save({
        id,
        video_path: null,
        audio_mic_path: '/path/to/mic.ogg',
        audio_system_path: null,
        duration: 60,
        captured_at: '2026-01-20T10:00:00Z',
        status: 'raw',
        processing_step: null,
        source_type: 'cap',
        source_metadata: null,
        error_message: null,
      });

      repo.delete(id);

      const found = repo.findById(id);
      expect(found).toBeNull();
    });
  });
}

function runContextRepositoryTests(
  name: string,
  createRepos: () => {
    contextRepo: ContextRepository;
    recordingRepo: RecordingRepository;
    observationRepo: ObservationRepository;
    cleanup: () => void;
  }
) {
  describe(`ContextRepository: ${name}`, () => {
    let contextRepo: ContextRepository;
    let recordingRepo: RecordingRepository;
    let observationRepo: ObservationRepository;
    let cleanup: () => void;

    beforeEach(() => {
      const result = createRepos();
      contextRepo = result.contextRepo;
      recordingRepo = result.recordingRepo;
      observationRepo = result.observationRepo;
      cleanup = result.cleanup;
    });

    afterEach(() => {
      cleanup();
    });

    it('saves and retrieves a context', () => {
      const id = generateId();
      contextRepo.save({
        id,
        type: 'project',
        name: 'escribano',
        metadata: JSON.stringify({ version: '1.0' }),
      });

      const found = contextRepo.findById(id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(id);
      expect(found!.name).toBe('escribano');
    });

    it('finds by type and name', () => {
      const id = generateId();
      contextRepo.save({
        id,
        type: 'app',
        name: 'vscode',
        metadata: null,
      });

      const found = contextRepo.findByTypeAndName('app', 'vscode');
      expect(found).not.toBeNull();
      expect(found!.id).toBe(id);
    });

    it('links and unlinks observations', () => {
      const recordingId = generateId();
      const contextId = generateId();
      const observationId = generateId();

      // 1. Save Recording (required for observation FK)
      recordingRepo.save({
        id: recordingId,
        video_path: null,
        audio_mic_path: null,
        audio_system_path: null,
        duration: 0,
        captured_at: new Date().toISOString(),
        status: 'raw',
        processing_step: null,
        source_type: 'raw',
        source_metadata: null,
        error_message: null,
      });

      // 2. Save Observation (required for link FK)
      observationRepo.saveBatch([
        {
          id: observationId,
          recording_id: recordingId,
          type: 'visual',
          timestamp: 0,
          end_timestamp: null,
          image_path: null,
          ocr_text: 'test',
          vlm_description: null,
          vlm_raw_response: null,
          activity_type: null,
          apps: null,
          topics: null,
          text: null,
          audio_source: null,
          audio_type: null,
          embedding: null,
        },
      ]);

      // 3. Save Context
      contextRepo.save({
        id: contextId,
        type: 'topic',
        name: 'database',
        metadata: null,
      });

      // 4. Link
      contextRepo.linkObservation(observationId, contextId, 0.95);

      const links = contextRepo.getObservationLinks(contextId);
      expect(links).toHaveLength(1);
      expect(links[0].observation_id).toBe(observationId);
      expect(links[0].confidence).toBe(0.95);

      // 5. Unlink
      contextRepo.unlinkObservation(observationId, contextId);
      const linksAfter = contextRepo.getObservationLinks(contextId);
      expect(linksAfter).toHaveLength(0);
    });
  });
}

// =============================================================================
// Run Tests Against SQLite Implementation
// =============================================================================

runRecordingRepositoryTests('SQLite', () => {
  // Create fresh test repositories for each test
  const testRepos = createTestRepositories();
  return {
    repo: testRepos.recordings,
    cleanup: testRepos.cleanup,
  };
});

runContextRepositoryTests('SQLite', () => {
  // Create fresh test repositories for each test
  const testRepos = createTestRepositories();
  return {
    contextRepo: testRepos.contexts,
    recordingRepo: testRepos.recordings,
    observationRepo: testRepos.observations,
    cleanup: testRepos.cleanup,
  };
});
