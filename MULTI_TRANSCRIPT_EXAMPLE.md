# Multi-Transcript Example

This shows how Escribano now handles multiple audio sources (mic and system audio) from recordings.

## Example Recording Structure

```typescript
// A Cap recording with both mic and system audio
const recording: Recording = {
  id: "example-session-2026",
  source: {
    type: "cap",
    originalPath: "~/Library/.../example.cap"
  },
  videoPath: ".../display.mp4",
  audioMicPath: ".../mic_audio.ogg",      // User's microphone
  audioSystemPath: ".../system_audio.ogg", // System sounds
  duration: 300,
  capturedAt: new Date()
};
```

## Processing Flow

1. **Transcription Phase** - Both audio sources are transcribed:
   ```typescript
   // Transcribes both audio files (in parallel if ESCRIBANO_PARALLEL_TRANSCRIPTION=true)
   const session = await processSession(recording, transcriber);
   
   // Result:
   session.transcripts = [
     {
       source: 'mic',
       transcript: { /* mic audio transcript */ }
     },
     {
       source: 'system', 
       transcript: { /* system audio transcript */ }
     }
   ];
   ```

2. **Classification Phase** - Transcripts are interleaved by timestamp:
   ```typescript
   // The classifier receives an interleaved view:
   [00:00 MIC] "Let me debug this authentication issue"
   [00:03 SYSTEM] Error notification sound
   [00:05 MIC] "I see the error in the console"
   [00:08 SYSTEM] Build failed notification
   [00:10 MIC] "The JWT token is malformed"
   ```

## Benefits

1. **Complete Context**: LLM gets both human narration and system feedback
2. **Better Classification**: Can correlate user actions with system responses
3. **Richer Artifacts**: Future artifacts can use appropriate audio source
   - Meeting notes: Focus on mic audio
   - Debug runbooks: Include system notifications
   - Tutorials: Both instructor voice and demo sounds

## Configuration

Enable parallel transcription for faster processing:
```bash
export ESCRIBANO_PARALLEL_TRANSCRIPTION=true
pnpm run transcribe-latest
```

## CLI Output Example

```bash
$ pnpm run transcribe-latest

Transcribing: example-session-2026
Captured:  2026-01-09 14:30:00
Duration:   5m 0s
Audio Mic:      ~/Library/.../mic_audio.ogg
Audio System:   ~/Library/.../system_audio.ogg

Processing transcription...
Transcribing audio sources in parallel...
Transcribing mic audio from: ~/Library/.../mic_audio.ogg
Transcribing system audio from: ~/Library/.../system_audio.ogg

✅ Transcription complete!
Session ID: example-session-2026
Session saved to: ~/.escribano/sessions/example-session-2026.json

MIC Audio Transcript:
  - Duration: 5m 0s
  - Segments: 45
  - Text length: 3842 characters
  - First segment: "Alright, let's debug this authentication issue..."

SYSTEM Audio Transcript:
  - Duration: 5m 0s
  - Segments: 12
  - Text length: 256 characters
  - First segment: "Error notification sound..."
```