/**
 * Process Session Action
 *
 * Takes a recording and transcribes all available audio sources, creating a Session.
 * Supports multiple audio sources (mic, system) with parallel transcription option.
 */

import type {
  Recording,
  Session,
  TaggedTranscript,
  Transcript,
  TranscriptionService,
  VideoService,
  VisualLog,
} from '../0_types.js';
import path from 'node:path';
import os from 'node:os';

/**
 * Check if a transcript is empty (no content)
 */
function isEmptyTranscript(transcript: Transcript): boolean {
  return !transcript.fullText.trim() || transcript.segments.length === 0;
}

/**
 * Process a recording by transcribing all available audio sources and extracting visual logs
 */
export async function processSession(
  recording: Recording,
  transcriber: TranscriptionService,
  videoService: VideoService
): Promise<Session> {
  console.log(`Processing recording: ${recording.id}`);

  const transcripts: TaggedTranscript[] = [];
  const visualLogs: VisualLog[] = [];
  const parallelTranscription =
    process.env.ESCRIBANO_PARALLEL_TRANSCRIPTION === 'true';

  // 1. Audio Transcription
  const audioSources: Array<{ source: 'mic' | 'system'; path: string }> = [];

  if (recording.audioMicPath) {
    audioSources.push({ source: 'mic', path: recording.audioMicPath });
  }

  if (recording.audioSystemPath) {
    audioSources.push({ source: 'system', path: recording.audioSystemPath });
  }

  if (audioSources.length > 0) {
    if (parallelTranscription) {
      console.log('Transcribing audio sources in parallel...');
      const transcriptionPromises = audioSources.map(
        async ({ source, path }) => {
          console.log(`Transcribing ${source} audio from: ${path}`);
          try {
            const transcript = await transcriber.transcribe(path);
            if (!isEmptyTranscript(transcript)) {
              return { source, transcript };
            }
            console.log(`Warning: ${source} audio produced empty transcript`);
            return null;
          } catch (error) {
            console.error(`Failed to transcribe ${source} audio:`, error);
            return null;
          }
        }
      );

      const results = await Promise.all(transcriptionPromises);
      transcripts.push(
        ...results.filter((r): r is TaggedTranscript => r !== null)
      );
    } else {
      console.log('Transcribing audio sources sequentially...');
      for (const { source, path } of audioSources) {
        console.log(`Transcribing ${source} audio from: ${path}`);
        try {
          const transcript = await transcriber.transcribe(path);
          if (!isEmptyTranscript(transcript)) {
            transcripts.push({ source, transcript });
          } else {
            console.log(`Warning: ${source} audio produced empty transcript`);
          }
        } catch (error) {
          console.error(`Failed to transcribe ${source} audio:`, error);
        }
      }
    }
  }

  // 2. Visual Log Extraction
  if (recording.videoPath) {
    console.log(`Extracting visual log from: ${recording.videoPath}`);
    const visualLogDir = path.join(
      os.homedir(),
      '.escribano',
      'sessions',
      recording.id,
      'visual-log'
    );

    try {
      // Scene detection for the visual log
      // Threshold 0.3 is a good balance for detecting significant screen changes
      const sceneResults = await videoService.detectAndExtractScenes(
        recording.videoPath,
        0.3,
        visualLogDir
      );

      if (sceneResults.length > 0) {
        // Create the visual log object
        const entries = sceneResults.map((result) => {
          return {
            timestamp: result.timestamp,
            imagePath: result.imagePath,
          };
        });

        visualLogs.push({
          entries,
          source: 'screen',
        });
        console.log(
          `Visual log extracted: ${sceneResults.length} scenes found.`
        );
      }
    } catch (error) {
      console.error('Failed to extract visual log:', error);
    }
  }

  // 3. Validation
  const hasAudioContent = transcripts.length > 0;
  const hasVisualContent =
    visualLogs.length > 0 && visualLogs[0].entries.length > 0;

  if (!hasAudioContent && !hasVisualContent) {
    throw new Error(
      `Session processing failed: No audio content AND no visual changes detected for recording: ${recording.id}`
    );
  }

  console.log(
    `Processing complete. Sources: ${transcripts.length} audio, ${visualLogs.length} visual.`
  );

  // Create session
  const session: Session = {
    id: recording.id,
    recording,
    transcripts,
    visualLogs,
    status: 'transcribed',
    classification: null,
    metadata: null,
    artifacts: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return session;
}
