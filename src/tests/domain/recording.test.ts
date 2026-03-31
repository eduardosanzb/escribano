import { describe, expect, it } from 'vitest';
import {
  advanceStep,
  completeProcessing,
  failProcessing,
  type Recording,
  startProcessing,
} from '../../domain/recording.js';

function createRecording(overrides?: Partial<Recording>): Recording {
  return {
    id: 'test',
    status: 'raw',
    processingStep: null,
    errorMessage: null,
    videoPath: '/test.mov',
    audioMicPath: null,
    audioSystemPath: null,
    capturedAt: '2024-01-01',
    duration: 3600,
    ...overrides,
  };
}

describe('Recording State Machine', () => {
  describe('startProcessing', () => {
    it('should set status to processing', () => {
      const recording = createRecording();
      const result = startProcessing(recording);
      expect(result.status).toBe('processing');
    });

    it('should set processingStep to vad', () => {
      const recording = createRecording();
      const result = startProcessing(recording);
      expect(result.processingStep).toBe('vad');
    });

    it('should clear errorMessage', () => {
      const recording = createRecording({
        errorMessage: 'some previous error',
      });
      const result = startProcessing(recording);
      expect(result.errorMessage).toBeNull();
    });

    it('should preserve other fields', () => {
      const recording = createRecording();
      const result = startProcessing(recording);
      expect(result.id).toBe(recording.id);
      expect(result.videoPath).toBe(recording.videoPath);
      expect(result.capturedAt).toBe(recording.capturedAt);
      expect(result.duration).toBe(recording.duration);
    });
  });

  describe('advanceStep', () => {
    it('should update processingStep to given step', () => {
      const recording = createRecording({
        status: 'processing',
        processingStep: 'vad',
      });
      const result = advanceStep(recording, 'transcription');
      expect(result.processingStep).toBe('transcription');
    });

    it('should preserve status', () => {
      const recording = createRecording({
        status: 'processing',
        processingStep: 'vad',
      });
      const result = advanceStep(recording, 'transcription');
      expect(result.status).toBe('processing');
    });

    it('should preserve other fields', () => {
      const recording = createRecording({
        status: 'processing',
        processingStep: 'vad',
      });
      const result = advanceStep(recording, 'vlm_enrichment');
      expect(result.id).toBe(recording.id);
      expect(result.videoPath).toBe(recording.videoPath);
      expect(result.capturedAt).toBe(recording.capturedAt);
      expect(result.duration).toBe(recording.duration);
      expect(result.errorMessage).toBe(recording.errorMessage);
    });
  });

  describe('completeProcessing', () => {
    it('should set status to processed', () => {
      const recording = createRecording({
        status: 'processing',
        processingStep: 'complete',
      });
      const result = completeProcessing(recording);
      expect(result.status).toBe('processed');
    });

    it('should clear processingStep', () => {
      const recording = createRecording({
        status: 'processing',
        processingStep: 'complete',
      });
      const result = completeProcessing(recording);
      expect(result.processingStep).toBeNull();
    });

    it('should preserve other fields', () => {
      const recording = createRecording({
        status: 'processing',
        processingStep: 'complete',
      });
      const result = completeProcessing(recording);
      expect(result.id).toBe(recording.id);
      expect(result.videoPath).toBe(recording.videoPath);
      expect(result.capturedAt).toBe(recording.capturedAt);
      expect(result.duration).toBe(recording.duration);
    });
  });

  describe('failProcessing', () => {
    it('should set status to error', () => {
      const recording = createRecording({
        status: 'processing',
        processingStep: 'transcription',
      });
      const result = failProcessing(recording, 'whisper crashed');
      expect(result.status).toBe('error');
    });

    it('should set errorMessage', () => {
      const recording = createRecording({
        status: 'processing',
        processingStep: 'transcription',
      });
      const result = failProcessing(recording, 'whisper crashed');
      expect(result.errorMessage).toBe('whisper crashed');
    });

    it('should preserve processingStep for resume', () => {
      const recording = createRecording({
        status: 'processing',
        processingStep: 'transcription',
      });
      const result = failProcessing(recording, 'whisper crashed');
      expect(result.processingStep).toBe('transcription');
    });

    it('should preserve other fields', () => {
      const recording = createRecording({
        status: 'processing',
        processingStep: 'transcription',
      });
      const result = failProcessing(recording, 'whisper crashed');
      expect(result.id).toBe(recording.id);
      expect(result.videoPath).toBe(recording.videoPath);
      expect(result.capturedAt).toBe(recording.capturedAt);
      expect(result.duration).toBe(recording.duration);
    });
  });

  describe('immutability', () => {
    it('startProcessing should not mutate the original recording', () => {
      const recording = createRecording();
      const originalStatus = recording.status;
      const originalStep = recording.processingStep;
      startProcessing(recording);
      expect(recording.status).toBe(originalStatus);
      expect(recording.processingStep).toBe(originalStep);
    });

    it('advanceStep should not mutate the original recording', () => {
      const recording = createRecording({
        status: 'processing',
        processingStep: 'vad',
      });
      const originalStep = recording.processingStep;
      advanceStep(recording, 'transcription');
      expect(recording.processingStep).toBe(originalStep);
    });

    it('completeProcessing should not mutate the original recording', () => {
      const recording = createRecording({
        status: 'processing',
        processingStep: 'complete',
      });
      const originalStatus = recording.status;
      const originalStep = recording.processingStep;
      completeProcessing(recording);
      expect(recording.status).toBe(originalStatus);
      expect(recording.processingStep).toBe(originalStep);
    });

    it('failProcessing should not mutate the original recording', () => {
      const recording = createRecording({
        status: 'processing',
        processingStep: 'transcription',
      });
      const originalStatus = recording.status;
      const originalError = recording.errorMessage;
      failProcessing(recording, 'error');
      expect(recording.status).toBe(originalStatus);
      expect(recording.errorMessage).toBe(originalError);
    });
  });

  describe('full lifecycle', () => {
    it('should transition raw → processing → vlm_enrichment → processed', () => {
      const raw = createRecording();

      const processing = startProcessing(raw);
      expect(processing.status).toBe('processing');
      expect(processing.processingStep).toBe('vad');

      const atTranscription = advanceStep(processing, 'transcription');
      expect(atTranscription.status).toBe('processing');
      expect(atTranscription.processingStep).toBe('transcription');

      const atVlm = advanceStep(atTranscription, 'vlm_enrichment');
      expect(atVlm.status).toBe('processing');
      expect(atVlm.processingStep).toBe('vlm_enrichment');

      const completed = completeProcessing(atVlm);
      expect(completed.status).toBe('processed');
      expect(completed.processingStep).toBeNull();

      // Verify original is still raw
      expect(raw.status).toBe('raw');
    });
  });
});
