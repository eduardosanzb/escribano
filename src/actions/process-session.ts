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
  TranscriptionService,
  Transcript,
} from '../0_types.js';

/**
 * Check if a transcript is empty (no content)
 */
function isEmptyTranscript(transcript: Transcript): boolean {
  return !transcript.fullText.trim() || transcript.segments.length === 0;
}

/**
 * Process a recording by transcribing all available audio sources
 */
export async function processSession(
  recording: Recording,
  transcriber: TranscriptionService
): Promise<Session> {
  console.log(`Processing recording: ${recording.id}`);

  const transcripts: TaggedTranscript[] = [];
  const parallelTranscription =
    process.env.ESCRIBANO_PARALLEL_TRANSCRIPTION === 'true';

  // Collect audio sources to transcribe
  const audioSources: Array<{ source: 'mic' | 'system'; path: string }> = [];

  if (recording.audioMicPath) {
    audioSources.push({ source: 'mic', path: recording.audioMicPath });
  }

  if (recording.audioSystemPath) {
    audioSources.push({ source: 'system', path: recording.audioSystemPath });
  }

  if (audioSources.length === 0) {
    throw new Error(`No audio sources found for recording: ${recording.id}`);
  }

  // Transcribe audio sources
  if (parallelTranscription) {
    console.log('Transcribing audio sources in parallel...');
    const transcriptionPromises = audioSources.map(async ({ source, path }) => {
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
    });

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
        // Continue with other audio sources
      }
    }
  }

  // Fail fast if all transcripts are empty
  if (transcripts.length === 0) {
    throw new Error(
      `All audio sources produced empty transcripts for recording: ${recording.id}`
    );
  }

  console.log(
    `Transcription complete. Successfully transcribed ${transcripts.length} audio source(s)`
  );

  // Create session
  const session: Session = {
    id: recording.id,
    recording,
    transcripts,
    status: 'transcribed',
    type: null,
    classification: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return session;
}
