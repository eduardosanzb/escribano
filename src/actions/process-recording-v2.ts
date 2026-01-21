import os from 'node:os';
import path from 'node:path';
import type {
  DbObservationInsert,
  DbRecording,
  IntelligenceService,
  Repositories,
  TranscriptionService,
  VideoService,
} from '../0_types.js';
import type {
  AudioPreprocessor,
  SpeechSegment,
} from '../adapters/audio.silero.adapter.js';
import { generateId } from '../db/helpers.js';
import { createAudioObservation } from '../domain/observation.js';
import {
  advanceStep,
  completeProcessing,
  failProcessing,
  ProcessingStep,
  type Recording,
  startProcessing,
} from '../domain/recording.js';
import { log, step } from '../pipeline/context.js';

export interface ProcessRecordingV2Options {
  parallel?: boolean;
}

export async function processRecordingV2(
  recordingId: string,
  repos: Repositories,
  adapters: {
    preprocessor: AudioPreprocessor;
    transcription: TranscriptionService;
    video: VideoService;
    intelligence: IntelligenceService;
  },
  options: ProcessRecordingV2Options = {}
): Promise<void> {
  const dbRecording = repos.recordings.findById(recordingId);
  if (!dbRecording) {
    throw new Error(`Recording ${recordingId} not found`);
  }

  // Map DB to Domain
  let recording: Recording = {
    id: dbRecording.id,
    status: dbRecording.status as any,
    processingStep: dbRecording.processing_step as any,
    errorMessage: dbRecording.error_message,
    videoPath: dbRecording.video_path,
    audioMicPath: dbRecording.audio_mic_path,
    audioSystemPath: dbRecording.audio_system_path,
    capturedAt: dbRecording.captured_at,
    duration: dbRecording.duration,
  };

  try {
    // 1. Start processing
    recording = startProcessing(recording);
    updateRecordingInDb(repos, recording);

    const observations: DbObservationInsert[] = [];

    // 2. VAD & Transcription
    const processSource = async (
      audioPath: string | null,
      source: 'mic' | 'system'
    ) => {
      if (!audioPath) return;

      log('info', `Processing ${source} audio: ${audioPath}`);

      // Step: VAD
      const { segments, tempDir } = await step(`vad-${source}`, async () => {
        recording = advanceStep(recording, 'vad');
        updateRecordingInDb(repos, recording);
        return await adapters.preprocessor.extractSpeechSegments(
          audioPath,
          recording.id
        );
      });

      if (segments.length === 0) {
        log('info', `No speech segments found in ${source} audio`);
        await adapters.preprocessor.cleanup(tempDir);
        return;
      }

      log('info', `Found ${segments.length} segments in ${source} audio`);

      // Step: Transcription
      await step(`transcription-${source}`, async () => {
        recording = advanceStep(recording, 'transcription');
        updateRecordingInDb(repos, recording);

        let successCount = 0;
        for (const segment of segments) {
          try {
            const text = await adapters.transcription.transcribeSegment(
              segment.audioPath
            );

            if (text.length > 0) {
              successCount++;
              const obs = createAudioObservation({
                recordingId: recording.id,
                timestamp: segment.start,
                endTimestamp: segment.end,
                text,
                audioSource: source,
              });

              observations.push({
                id: obs.id,
                recording_id: obs.recordingId,
                type: obs.type,
                timestamp: obs.timestamp,
                end_timestamp: obs.endTimestamp,
                text: obs.text,
                audio_source: obs.audioSource,
                audio_type: obs.audioType,
                image_path: null,
                ocr_text: null,
                vlm_description: null,
                embedding: null,
              });
            }
          } catch (error) {
            log(
              'warn',
              `Failed to transcribe segment at ${segment.start}s: ${(error as Error).message}`
            );
          }
        }
        log(
          'info',
          `Successfully transcribed ${successCount}/${segments.length} segments for ${source}`
        );
      });

      // Cleanup
      await step(`cleanup-${source}`, async () => {
        await adapters.preprocessor.cleanup(tempDir);
      });
    };

    if (options.parallel) {
      await Promise.all([
        processSource(recording.audioMicPath, 'mic'),
        processSource(recording.audioSystemPath, 'system'),
      ]);
    } else {
      await processSource(recording.audioMicPath, 'mic');
      await processSource(recording.audioSystemPath, 'system');
    }

    // ============================================
    // VISUAL PROCESSING
    // ============================================

    const visualObservations: DbObservationInsert[] = [];

    if (recording.videoPath) {
      // Step: Frame Extraction
      const frames = await step('frame-extraction', async () => {
        const intervalSeconds = parseInt(
          process.env.ESCRIBANO_FRAME_INTERVAL || '2'
        );
        const width = parseInt(process.env.ESCRIBANO_FRAME_WIDTH || '1920');

        const extractedFrames = await adapters.video.extractFramesAtInterval(
          recording.videoPath!,
          0.3, // threshold
          path.join(os.tmpdir(), 'escribano', recording.id, 'frames')
        );

        log(
          'info',
          `Extracted ${extractedFrames.length} frames (interval: ${intervalSeconds}s)`
        );
        return extractedFrames;
      });

      // Step: OCR Processing
      const ocrResults = await step('ocr-processing', async () => {
        const framesDir = path.join(
          os.tmpdir(),
          'escribano',
          recording.id,
          'frames'
        );
        const outputPath = path.join(
          os.tmpdir(),
          'escribano',
          recording.id,
          'visual-index.json'
        );

        const visualIndex = await adapters.video.runVisualIndexing(
          framesDir,
          outputPath
        );
        log('info', `OCR processed ${visualIndex.frames.length} frames`);

        return visualIndex.frames.map((f) => ({
          imagePath: f.imagePath,
          timestamp: f.timestamp,
          ocrText: f.ocrText || '',
        }));
      });

      // Step: VLM Descriptions (every Nth frame)
      const vlmInterval = 2; // Process every 2nd frame
      const framesToDescribe = ocrResults.filter(
        (_, i) => i % vlmInterval === 0
      );

      const descriptions: Map<number, string> = new Map();

      if (framesToDescribe.length > 0) {
        await step('vlm-descriptions', async () => {
          const descResult = await adapters.intelligence.describeImages(
            framesToDescribe.map((f) => ({
              imagePath: f.imagePath,
              timestamp: f.timestamp,
              clusterId: 0, // Placeholder
            }))
          );

          for (const desc of descResult.descriptions) {
            descriptions.set(desc.timestamp, desc.description);
          }

          log('info', `Generated ${descriptions.size} VLM descriptions`);
        });
      }

      // Step: Generate Embeddings
      const embeddings = await step('generate-embeddings', async () => {
        const textsToEmbed = ocrResults.map((f) => f.ocrText);
        const results = await adapters.intelligence.embedText(textsToEmbed, {
          batchSize: 10,
        });
        log(
          'info',
          `Generated ${results.filter((e) => e.length > 0).length} embeddings`
        );
        return results;
      });

      // Build Visual Observations
      for (let i = 0; i < ocrResults.length; i++) {
        const frame = ocrResults[i];
        const embedding = embeddings[i];
        const vlmDescription = descriptions.get(frame.timestamp) || null;

        visualObservations.push({
          id: generateId(),
          recording_id: recording.id,
          type: 'visual',
          timestamp: frame.timestamp,
          end_timestamp: frame.timestamp,
          text: null,
          audio_source: null,
          audio_type: null,
          image_path: frame.imagePath,
          ocr_text: frame.ocrText || null,
          vlm_description: vlmDescription,
          embedding:
            embedding && embedding.length > 0
              ? Buffer.from(new Float32Array(embedding).buffer)
              : null,
        });
      }

      log('info', `Created ${visualObservations.length} visual observations`);
    }

    // 3. Save observations
    const allObservations = [...observations, ...visualObservations];

    if (allObservations.length > 0) {
      await step('save-observations', async () => {
        log(
          'info',
          `Saving ${observations.length} audio + ${visualObservations.length} visual observations`
        );
        repos.observations.saveBatch(allObservations);
      });
    }

    // 4. Complete
    recording = completeProcessing(recording);
    updateRecordingInDb(repos, recording);
  } catch (error) {
    log(
      'error',
      `Processing v2 failed for ${recordingId}: ${(error as Error).message}`
    );
    recording = failProcessing(recording, (error as Error).message);
    updateRecordingInDb(repos, recording);
    throw error;
  }
}

function updateRecordingInDb(repos: Repositories, recording: Recording) {
  repos.recordings.updateStatus(
    recording.id,
    recording.status as any,
    recording.processingStep as any,
    recording.errorMessage
  );
}
