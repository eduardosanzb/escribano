/**
 * Process Session Action
 *
 * Takes a recording and transcribes it, creating a Session.
 * Simple flow: Recording → Transcript → Session
 */

import type { Recording, Session, TranscriptionService } from '../0_types.js';

/**
 * Process a recording by transcribing it
 */
export async function processSession(
  recording: Recording,
  transcriber: TranscriptionService
): Promise<Session> {
  console.log(`Processing recording: ${recording.id}`);

  // Transcribe the audio
  const transcript = await transcriber.transcribe(recording.audioPath);

  console.log(`Transcription complete. Duration: ${transcript.duration}s`);

  // Create session
  const session: Session = {
    id: recording.id,
    recording,
    transcript,
    status: 'transcribed',
    type: null,
    classification: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return session;
}
