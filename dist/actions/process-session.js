/**
 * Process Session Action
 *
 * Takes a recording and transcribes it, creating a Session.
 * Simple flow: Recording → Transcript → Session
 */
/**
 * Process a recording by transcribing it
 */
export async function processSession(recording, transcriber) {
    console.log(`Processing recording: ${recording.id}`);
    // Transcribe the audio
    const transcript = await transcriber.transcribe(recording.audioPath);
    console.log(`Transcription complete. Duration: ${transcript.duration}s`);
    // Create session
    const session = {
        id: recording.id,
        recording,
        transcript,
        status: 'transcribed',
        type: null, // Will be classified later
        createdAt: new Date(),
        updatedAt: new Date(),
    };
    return session;
}
