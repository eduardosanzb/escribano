/**
 * Escribano CLI Entry Point
 *
 * Transcribes Cap recordings using whisper.cpp.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  type ArtifactType,
  type Classification,
  DEFAULT_INTELLIGENCE_CONFIG,
  type OutlineConfig,
  type Recording,
  type Session,
  type TranscriptMetadata,
} from './0_types.js';
import { classifySession } from './actions/classify-session.js';
import { extractMetadata } from './actions/extract-metadata.js';
import {
  generateArtifact,
  getRecommendedArtifacts,
} from './actions/generate-artifact.js';
import { processRecordingV2 } from './actions/process-recording-v2.js';
import { processSession } from './actions/process-session.js';
import { syncSessionToOutline } from './actions/sync-to-outline.js';
import { createSileroPreprocessor } from './adapters/audio.silero.adapter.js';
import { createCapCaptureSource } from './adapters/capture.cap.adapter.js';
import { createOllamaEmbeddingService } from './adapters/embedding.ollama.adapter.js';
import { createOllamaIntelligenceService } from './adapters/intelligence.ollama.adapter.js';
import { createOutlinePublishingService } from './adapters/publishing.outline.adapter.js';
import { createFsStorageService } from './adapters/storage.fs.adapter.js';
import { createWhisperTranscriptionService } from './adapters/transcription.whisper.adapter.js';
import { createFfmpegVideoService } from './adapters/video.ffmpeg.adapter.js';
import { generateId } from './db/helpers.js';
import { getRepositories } from './db/index.js';
import { Classification as ClassificationModule } from './domain/classification.js';
import { Segment } from './domain/segment.js';
import { Session as SessionModule } from './domain/session.js';
import { TimeRange } from './domain/time-range.js';
import { withPipeline } from './pipeline/context.js';

const MODELS_DIR = path.join(homedir(), '.escribano', 'models');
const MODEL_FILE = 'ggml-large-v3.bin';
const MODEL_PATH = path.join(MODELS_DIR, MODEL_FILE);
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_FILE}`;

interface ParsedArgs {
  command: string;
  limit: number;
  recordingId?: string;
  sessionId?: string;
  sessionRef?: string;
  artifactType?: string;
  force?: boolean;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  try {
    switch (args.command) {
      case 'list':
        executeList(args.limit);
        break;

      case 'transcribe-latest':
        executeTranscribeLatest(args);
        break;

      case 'transcribe':
        executeTranscribeById(args);
        break;

      case 'classify-latest':
        executeClassifyLatest(args);
        break;

      case 'classify':
        executeClassifyById(args);
        break;

      case 'extract-metadata-latest':
        executeExtractMetadataLatest(args);
        break;

      case 'extract-metadata':
        executeExtractMetadataById(args);
        break;

      case 'restart-latest':
        executeRestartLatest();
        break;

      case 'list-artifacts':
        executeListArtifacts(args);
        break;

      case 'generate-artifact':
        executeGenerateArtifact(args);
        break;

      case 'sessions':
        executeSessions();
        break;

      case 'generate':
        executeGenerate(args);
        break;

      case 'artifacts':
        executeArtifactsList(args);
        break;

      case 'sync':
        executeSync(args);
        break;

      case 'sync-all':
        executeSyncAll();
        break;

      case 'segments':
        executeSegments(args);
        break;

      case 'activities':
        executeActivities(args);
        break;

      case 'benchmark-latest':
        executeBenchmarkLatest();
        break;

      case 'process-v2':
        executeProcessV2(args);
        break;

      case 'recordings-v2':
        executeRecordingsV2();
        break;

      default:
        showHelp();
        process.exit(1);
    }
  } catch (error) {
    console.error('Error:', (error as Error).message);
    console.error((error as Error).stack);
    process.exit(1);
  }
}

function parseArgs(argsArray: string[]): ParsedArgs {
  if (argsArray.length === 0) {
    return { command: 'help', limit: 10 };
  }

  const command = argsArray[0];

  switch (command) {
    case 'list':
      return {
        command: 'list',
        limit: argsArray[1] ? parseInt(argsArray[1], 10) : 10,
        recordingId: undefined,
        sessionId: undefined,
      };

    case 'transcribe-latest':
      return { command: 'transcribe-latest', limit: 10, sessionId: undefined };

    case 'transcribe':
      if (argsArray.length < 2) {
        return { command: 'help', limit: 10 };
      }
      return {
        command: 'transcribe',
        recordingId: argsArray[1],
        limit: 10,
        sessionId: undefined,
      };

    case 'classify-latest':
      return { command: 'classify-latest', limit: 10, sessionId: undefined };

    case 'classify':
      if (argsArray.length < 2) {
        return { command: 'help', limit: 10 };
      }
      return {
        command: 'classify',
        sessionId: argsArray[1],
        limit: 10,
        recordingId: undefined,
      };

    case 'extract-metadata-latest':
      return {
        command: 'extract-metadata-latest',
        limit: 10,
        sessionId: undefined,
      };

    case 'extract-metadata':
      if (argsArray.length < 2) {
        return { command: 'help', limit: 10 };
      }
      return {
        command: 'extract-metadata',
        sessionId: argsArray[1],
        limit: 10,
        recordingId: undefined,
      };

    case 'restart-latest':
      return { command: 'restart-latest', limit: 10 };

    case 'list-artifacts':
      if (argsArray.length < 2) {
        return { command: 'help', limit: 10 };
      }
      return {
        command: 'list-artifacts',
        sessionId: argsArray[1],
        limit: 10,
      };

    case 'generate-artifact':
      if (argsArray.length < 3) {
        return { command: 'help', limit: 10 };
      }
      return {
        command: 'generate-artifact',
        sessionId: argsArray[1],
        artifactType: argsArray[2],
        limit: 10,
      };

    case 'sessions':
      return { command: 'sessions', limit: 10 };

    case 'generate':
      return {
        command: 'generate',
        sessionRef: argsArray[1],
        artifactType: argsArray[2],
        limit: 10,
      };

    case 'artifacts':
      return {
        command: 'artifacts',
        sessionRef: argsArray[1],
        limit: 10,
      };

    case 'sync':
      return {
        command: 'sync',
        sessionRef: argsArray[1],
        limit: 10,
      };

    case 'sync-all':
      return { command: 'sync-all', limit: 10 };

    case 'benchmark-latest':
      return { command: 'benchmark-latest', limit: 10 };

    case 'process-v2':
      return {
        command: 'process-v2',
        recordingId: argsArray[1] || 'latest',
        force: argsArray.includes('--force'),
        limit: 10,
      };

    case 'recordings-v2':
      return { command: 'recordings-v2', limit: 10 };

    case 'segments':
      return {
        command: 'segments',
        sessionRef: argsArray[1],
        limit: 10,
      };

    case 'activities':
      return {
        command: 'activities',
        sessionRef: argsArray[1],
        limit: 10,
      };

    default:
      return { command: 'help', limit: 10 };
  }
}

async function executeProcessV2(args: ParsedArgs): Promise<void> {
  const repos = getRepositories();
  const capSource = createCapCaptureSource();
  let recordingId = args.recordingId;

  if (recordingId === 'latest') {
    const latest = await capSource.getLatestRecording();
    if (!latest) {
      console.error('No Cap recordings found');
      return;
    }
    recordingId = latest.id;
  }

  // 1. Ensure recording is in SQLite
  const dbRecording = repos.recordings.findById(recordingId!);
  if (!dbRecording) {
    console.log(`Importing recording ${recordingId} into database...`);
    const capRecordings = await capSource.listRecordings(100);
    const recording = capRecordings.find((r) => r.id === recordingId);

    if (!recording) {
      console.error(`Recording ${recordingId} not found in Cap`);
      return;
    }

    repos.recordings.save({
      id: recording.id,
      video_path: recording.videoPath,
      audio_mic_path: recording.audioMicPath,
      audio_system_path: recording.audioSystemPath,
      duration: recording.duration,
      captured_at: recording.capturedAt.toISOString(),
      status: 'raw',
      processing_step: null,
      source_type: 'cap',
      source_metadata: JSON.stringify(recording.source.metadata || {}),
      error_message: null,
    });
  }

  // 2. Run Pipeline
  const parallel = process.env.ESCRIBANO_PARALLEL_TRANSCRIPTION === 'true';
  const preprocessor = createSileroPreprocessor();
  const transcription = createWhisperTranscriptionService({
    binaryPath: 'whisper-cli',
    model: MODEL_PATH,
    cwd: MODELS_DIR,
    outputFormat: 'json',
  });
  const video = createFfmpegVideoService();
  const intelligence = createOllamaIntelligenceService();
  const embedding = createOllamaEmbeddingService(DEFAULT_INTELLIGENCE_CONFIG);

  await withPipeline(recordingId!, async () => {
    await processRecordingV2(
      recordingId!,
      repos,
      { preprocessor, transcription, video, intelligence, embedding },
      { parallel, force: args.force }
    );
  });

  console.log(`\n✅ Processing complete for ${recordingId}`);
}

async function executeRecordingsV2(): Promise<void> {
  const repos = getRepositories();
  const recordings = repos.recordings.findPending(); // Or all?
  const allRecordings = repos.recordings.findByStatus('processed');
  const errorRecordings = repos.recordings.findByStatus('error');
  const processingRecordings = repos.recordings.findByStatus('processing');
  const rawRecordings = repos.recordings.findByStatus('raw');

  const list = [
    ...rawRecordings,
    ...processingRecordings,
    ...allRecordings,
    ...errorRecordings,
  ];

  if (list.length === 0) {
    console.log(
      'No recordings in database. Use process-v2 to import and process.'
    );
    return;
  }

  console.log(`\n📦 Database Recordings (${list.length} total):`);
  console.log('='.repeat(80));

  for (const r of list) {
    const statusIcon =
      r.status === 'processed'
        ? '✅'
        : r.status === 'error'
          ? '❌'
          : r.status === 'processing'
            ? '⏳'
            : '⚪';
    const step = r.processing_step ? `[${r.processing_step}]` : '';
    const obsCount = repos.observations.findByRecording(r.id).length;

    console.log(
      `${statusIcon} ${r.id.padEnd(40)} ${r.status.padEnd(12)} ${step.padEnd(15)} ${obsCount} obs`
    );
    if (r.error_message) {
      console.log(`   ⚠️ Error: ${r.error_message}`);
    }
  }
}

async function executeList(limit: number): Promise<void> {
  console.log('Fetching Cap recordings...');

  const capSource = createCapCaptureSource({});
  const recordings = await capSource.listRecordings(limit);

  if (recordings.length === 0) {
    console.log('No recordings found.');
    return;
  }

  console.log(`Found ${recordings.length} recordings:\n`);

  recordings.forEach((recording, index) => {
    console.log('='.repeat(60));
    console.log(`[${index + 1}] ${recording.id}`);
    console.log('');
    console.log(`  Captured:  ${formatDate(recording.capturedAt)}`);
    console.log(`  Duration:   ${formatDuration(recording.duration)}`);
    console.log(`  Mic Audio:      ${recording.audioMicPath}`);
    console.log(`  System Audio:   ${recording.audioSystemPath}`);
    if (recording.videoPath) {
      console.log(`  Video:      ${recording.videoPath}`);
    }
  });
}

async function executeTranscribeLatest(_args: ParsedArgs): Promise<void> {
  await ensureModel();
  const capSource = createCapCaptureSource();
  const recording = await capSource.getLatestRecording();

  if (recording === null) {
    console.error('No recordings found.');
    process.exit(1);
  }

  await transcribeRecording(recording);
}

async function executeTranscribeById(args: ParsedArgs): Promise<void> {
  if (!args.recordingId) {
    console.error('Recording ID required');
    process.exit(1);
  }

  await ensureModel();
  const capSource = createCapCaptureSource();
  const recordings = await capSource.listRecordings(100);
  const recording = recordings.find((r) => r.id === args.recordingId);

  if (recording === undefined) {
    console.error(`Recording not found: ${args.recordingId}`);
    process.exit(1);
  }

  await transcribeRecording(recording);
}

async function executeClassifyLatest(_args: ParsedArgs): Promise<void> {
  const capSource = createCapCaptureSource({});
  const recording = await capSource.getLatestRecording();

  if (!recording) {
    console.error('No recordings found.');
    process.exit(1);
  }

  let session = await getOrCreateSession(recording);

  if (session.status === 'transcribed' || !session.classification) {
    console.log('\nClassifying session...');
    const intelligence = createOllamaIntelligenceService({});
    session = await classifySession(session, intelligence);
    await saveSession(session);
  }

  displayClassification(session);
}

async function executeClassifyById(args: ParsedArgs): Promise<void> {
  if (!args.sessionId) {
    console.error('Session ID required');
    process.exit(1);
  }

  const storage = createFsStorageService();
  let session = await storage.loadSession(args.sessionId);

  if (!session) {
    // Check if it's a recording ID instead
    const capSource = createCapCaptureSource();
    const recordings = await capSource.listRecordings(100);
    const recording = recordings.find((r) => r.id === args.sessionId);
    if (recording) {
      session = await getOrCreateSession(recording);
    } else {
      console.error(`Session or Recording not found: ${args.sessionId}`);
      process.exit(1);
    }
  }

  if (session.status === 'transcribed' || !session.classification) {
    console.log('\nClassifying session...');
    const intelligence = createOllamaIntelligenceService({});
    session = await classifySession(session, intelligence);
    await saveSession(session);
  }

  displayClassification(session);
}

async function executeExtractMetadataLatest(_args: ParsedArgs): Promise<void> {
  const capSource = createCapCaptureSource({});
  const recording = await capSource.getLatestRecording();

  if (!recording) {
    console.error('No recordings found.');
    process.exit(1);
  }

  let session = await getOrCreateSession(recording);

  if (!session.classification) {
    console.log('\nSession not classified. Classifying first...');
    const intelligence = createOllamaIntelligenceService({});
    session = await classifySession(session, intelligence);
    await saveSession(session);
    displayClassification(session);
  }

  if (session.status === 'classified' || !session.metadata) {
    console.log(`\nExtracting metadata from session: ${session.id}\n`);
    const intelligence = createOllamaIntelligenceService({});
    session = await extractMetadata(session, intelligence);
    await saveSession(session);
  }

  displayMetadata(session.metadata);
}

async function executeExtractMetadataById(args: ParsedArgs): Promise<void> {
  if (!args.sessionId) {
    console.error('Usage: extract-metadata <session-id>');
    process.exit(1);
  }

  const storage = createFsStorageService();
  let session = await storage.loadSession(args.sessionId);

  if (!session) {
    console.error(`Session not found: ${args.sessionId}`);
    process.exit(1);
  }

  if (!session.classification) {
    console.log('\nSession not classified. Classifying first...');
    const intelligence = createOllamaIntelligenceService({});
    session = await classifySession(session, intelligence);
    await saveSession(session);
  }

  if (session.status === 'classified' || !session.metadata) {
    console.log(`\nExtracting metadata from session: ${session.id}\n`);
    const intelligence = createOllamaIntelligenceService({});
    session = await extractMetadata(session, intelligence);
    await saveSession(session);
  }

  displayMetadata(session.metadata);
}

async function executeGenerateArtifact(args: ParsedArgs): Promise<void> {
  if (!args.sessionId || !args.artifactType) {
    console.error('Usage: generate-artifact <session-id> <artifact-type>');
    process.exit(1);
  }

  const storage = createFsStorageService();
  let session = await storage.loadSession(args.sessionId);

  if (!session) {
    console.error(`Session not found: ${args.sessionId}`);
    process.exit(1);
  }

  if (!session.classification) {
    console.log('\nSession not classified. Classifying first...');
    const intelligence = createOllamaIntelligenceService({});
    session = await classifySession(session, intelligence);
    await saveSession(session);
  }

  if (!session.metadata) {
    console.log('Metadata missing. Extracting metadata first...');
    const intelligence = createOllamaIntelligenceService({});
    session = await extractMetadata(session, intelligence);
    await saveSession(session);
    console.log('✓ Metadata extracted.');
  }

  console.log(`\nGenerating ${args.artifactType} for session ${session.id}...`);

  const intelligence = createOllamaIntelligenceService({});
  const videoService = createFfmpegVideoService();
  const artifact = await generateArtifact(
    session,
    intelligence,
    args.artifactType as ArtifactType,
    videoService
  );

  // Update session with new artifact
  if (!session.artifacts) {
    session.artifacts = [];
  }
  const existingIndex = session.artifacts.findIndex(
    (a) => a.type === args.artifactType
  );
  if (existingIndex >= 0) {
    session.artifacts[existingIndex] = artifact;
  } else {
    session.artifacts.push(artifact);
  }

  await saveSession(session);
  await storage.saveArtifact(session.id, artifact);

  console.log(`\n✅ ${args.artifactType} generated successfully!`);
  console.log('Content preview:');
  console.log('-'.repeat(40));
  console.log(
    artifact.content.substring(0, 500) +
      (artifact.content.length > 500 ? '...' : '')
  );
  console.log('-'.repeat(40));
}

async function executeListArtifacts(args: ParsedArgs): Promise<void> {
  if (!args.sessionId) {
    console.error('Session ID required');
    process.exit(1);
  }

  const storage = createFsStorageService();
  const session = await storage.loadSession(args.sessionId);

  if (!session) {
    console.error(`Session not found: ${args.sessionId}`);
    process.exit(1);
  }

  displayClassification(session);

  const recommendations = getRecommendedArtifacts(session);
  console.log('\n💡 Recommended Artifacts:');
  if (recommendations.length === 0) {
    console.log('   (No specific recommendations based on scores)');
  } else {
    for (const type of recommendations) {
      const exists = session.artifacts?.some((a) => a.type === type);
      const status = exists ? '[Generated]' : '[Pending]';
      console.log(`   • ${type.padEnd(15)} ${status}`);
    }
  }

  console.log(
    '\nAvailable types: summary, action-items, runbook, step-by-step, notes, code-snippets, blog-research, blog-draft'
  );
}

/**
 * Helper to get an existing session or process a recording to create one
 */
async function getOrCreateSession(recording: Recording): Promise<Session> {
  const storage = createFsStorageService();
  let session = await storage.loadSession(recording.id);

  if (!session) {
    console.log('No existing session found, processing recording...');
    await ensureModel(); // Ensure model is there if we need to transcribe
    const transcriber = createWhisperTranscriptionService({
      binaryPath: 'whisper-cli',
      model: MODEL_PATH,
      cwd: MODELS_DIR,
      outputFormat: 'json',
    });
    const videoService = createFfmpegVideoService();
    const intelligenceService = createOllamaIntelligenceService({});
    const storageService = createFsStorageService();

    session = await processSession(
      recording,
      transcriber,
      videoService,
      storageService,
      intelligenceService
    );
    await saveSession(session);
    console.log('✓ Session created and transcribed.');
  }

  return session;
}

async function transcribeRecording(recording: Recording): Promise<void> {
  console.log(`\nTranscribing: ${recording.id}`);
  console.log(`Captured:  ${formatDate(recording.capturedAt)}`);
  console.log(`Duration:   ${formatDuration(recording.duration)}s`);
  console.log(`Audio Mic:      ${recording.audioMicPath}`);
  console.log(`Audio System:   ${recording.audioSystemPath}`);
  console.log('');
  console.log('Processing transcription...');

  const transcriber = createWhisperTranscriptionService({
    binaryPath: 'whisper-cli',
    model: MODEL_PATH,
    cwd: MODELS_DIR,
    outputFormat: 'json',
  });
  const videoService = createFfmpegVideoService();
  const intelligenceService = createOllamaIntelligenceService({});
  const storageService = createFsStorageService();

  const session = await processSession(
    recording,
    transcriber,
    videoService,
    storageService,
    intelligenceService
  );

  // Save the session after transcription
  await saveSession(session);

  // Display summary of transcription results
  console.log('\n✅ Transcription complete!');
  console.log(`Session ID: ${session.id}`);
  console.log(`Session saved to: ~/.escribano/sessions/${session.id}.json\n`);

  // Display info about each transcript
  for (const taggedTranscript of session.transcripts) {
    const { source, transcript } = taggedTranscript;
    console.log(`${source.toUpperCase()} Audio Transcript:`);
    console.log(`  - Duration: ${formatDuration(transcript.duration)}`);
    console.log(`  - Segments: ${transcript.segments.length}`);
    console.log(`  - Text length: ${transcript.fullText.length} characters`);
    if (transcript.segments.length > 0) {
      console.log(
        `  - First segment: "${transcript.segments[0].text.substring(0, 50)}..."`
      );
    }
    console.log('');
  }
}

async function saveSession(session: Session): Promise<void> {
  const sessionDir = path.join(homedir(), '.escribano', 'sessions');
  await mkdir(sessionDir, { recursive: true });

  const sessionFile = path.join(sessionDir, `${session.id}.json`);
  await writeFile(sessionFile, JSON.stringify(session, null, 2), 'utf-8');
}

function displayClassification(session: Session): void {
  const classification = session.classification;
  if (!classification) {
    console.error('No classification found.');
    return;
  }

  const RELEVANCE_THRESHOLD = 25;

  console.log(`
╔═════════════════════════════╗
║     Session Classification Results            ║
╚═════════════════════════════════════════╝

  📝 Session ID: ${session.id}`);

  const scores = Object.entries(classification)
    .sort(([, a], [, b]) => b - a)
    .filter(([, score]) => score >= RELEVANCE_THRESHOLD);

  if (scores.length === 0) {
    console.log('  ⚠️  No clear session type detected (all scores < 25%)');
    return;
  }

  console.log('\n📊 Session Type Analysis:');
  scores.forEach(([type, score], index) => {
    const bar = '█'.repeat(Math.floor(score / 5));
    const icon = index === 0 ? '🎯' : '📌';
    console.log(`   ${icon} ${type.padEnd(10)} ${bar} ${score}%`);
  });

  if (scores.length > 1) {
    const primaryType = scores[0][0];
    const primaryScore = scores[0][1];
    const secondary = scores
      .slice(1)
      .filter(([, s]) => s >= RELEVANCE_THRESHOLD);

    console.log(
      `\n🏷️  Primary Type: ${primaryType.toUpperCase()} (${primaryScore}%)`
    );

    if (secondary.length > 0) {
      console.log(
        `  📌 Secondary: ${secondary.map(([t, s]) => `${t} (${s}%)`).join(', ')}`
      );
    }
  }

  console.log('\n💡 Suggested Artifacts:');
  if (classification.meeting > 50)
    console.log('   • Meeting summary & action items');
  if (classification.debugging > 50)
    console.log('   • Debugging runbook & error screenshots');
  if (classification.tutorial > 50)
    console.log('   • Step-by-step guide & screenshots');
  if (classification.learning > 50)
    console.log('   • Study notes & resource links');
  if (classification.working > 50)
    console.log('   • Code snippets & commit message');
}

function displayMetadata(metadata: TranscriptMetadata | null): void {
  if (!metadata) {
    console.log('No metadata extracted');
    return;
  }

  console.log('\n📊 Extracted Metadata:\n');

  if (metadata.speakers?.length) {
    console.log('👥 Speakers:');
    for (const speaker of metadata.speakers) {
      console.log(
        `   • ${speaker.name}${speaker.role ? ` (${speaker.role})` : ''}`
      );
    }
    console.log('');
  }

  if (metadata.keyMoments?.length) {
    console.log('⭐ Key Moments:');
    for (const moment of metadata.keyMoments) {
      const time = formatTime(moment.timestamp);
      const icon =
        moment.importance === 'high'
          ? '🔴'
          : moment.importance === 'medium'
            ? '🟡'
            : '⚪';
      console.log(`   ${icon} [${time}] ${moment.description}`);
    }
    console.log('');
  }

  if (metadata.actionItems?.length) {
    console.log('✅ Action Items:');
    for (const item of metadata.actionItems) {
      const priority = item.priority ? ` [${item.priority}]` : '';
      const owner = item.owner ? ` - ${item.owner}` : '';
      console.log(`   • ${item.description}${priority}${owner}`);
    }
    console.log('');
  }

  if (metadata.technicalTerms?.length) {
    console.log('🔧 Technical Terms:');
    for (const term of metadata.technicalTerms.slice(0, 5)) {
      console.log(`   • ${term.term} (${term.type})`);
    }
    if (metadata.technicalTerms.length > 5) {
      console.log(`   ... and ${metadata.technicalTerms.length - 5} more`);
    }
    console.log('');
  }

  if (metadata.codeSnippets?.length) {
    console.log('💻 Code Snippets:');
    for (const snippet of metadata.codeSnippets.slice(0, 3)) {
      console.log(
        `   • ${snippet.language || 'code'}: ${snippet.description || 'snippet'}`
      );
    }
    if (metadata.codeSnippets.length > 3) {
      console.log(`   ... and ${metadata.codeSnippets.length - 3} more`);
    }
    console.log('');
  }
}

async function ensureModel(): Promise<void> {
  if (!existsSync(MODELS_DIR)) {
    await mkdir(MODELS_DIR, { recursive: true });
  }

  if (!existsSync(MODEL_PATH)) {
    console.log('Model not found. Downloading...');
    console.log(`From: ${MODEL_URL}`);
    console.log(`To:   ${MODEL_PATH}`);
    console.log('');

    await downloadModel();

    console.log('\nModel downloaded successfully!');
  } else {
    // console.log('Model already downloaded.');
  }
}

function downloadModel(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('curl', [
      '-L',
      '--progress-bar',
      '-o',
      MODEL_PATH,
      MODEL_URL,
    ]);

    child.stdout.on('data', (data) => {
      process.stdout.write(data);
    });

    child.stderr.on('data', (data) => {
      process.stderr.write(data);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Download failed with code ${code}`));
      }
    });

    child.on('error', reject);
  });
}

function formatDate(date: Date): string {
  const isoDate = date.toISOString().split('T')[0];
  const timePart = date.toTimeString().split(' ')[0];
  return `${isoDate} ${timePart}`;
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}m ${secs}s`;
}

async function executeRestartLatest(): Promise<void> {
  const capSource = createCapCaptureSource({});
  const recording = await capSource.getLatestRecording();

  if (!recording) {
    console.error('No recordings found.');
    process.exit(1);
  }

  const sessionDir = path.join(homedir(), '.escribano', 'sessions');
  const sessionFile = path.join(sessionDir, `${recording.id}.json`);
  const visualLogDir = path.join(sessionDir, recording.id, 'visual-log');

  console.log(`Restarting session: ${recording.id}`);

  // Delete session file
  if (existsSync(sessionFile)) {
    const { rm } = await import('node:fs/promises');
    await rm(sessionFile);
    console.log(`  ✓ Deleted session file: ${recording.id}.json`);
  }

  // Delete visual log directory
  if (existsSync(visualLogDir)) {
    const { rm } = await import('node:fs/promises');
    await rm(visualLogDir, { recursive: true, force: true });
    console.log('  ✓ Deleted existing visual log directory.');
  }

  // Re-run extraction
  console.log('\nStarting fresh extraction...');
  const transcriber = createWhisperTranscriptionService({
    binaryPath: 'whisper-cli',
    model: MODEL_PATH,
    cwd: MODELS_DIR,
    outputFormat: 'json',
  });
  const videoService = createFfmpegVideoService();
  const intelligenceService = createOllamaIntelligenceService({});
  const storageService = createFsStorageService();

  const session = await processSession(
    recording,
    transcriber,
    videoService,
    storageService,
    intelligenceService
  );
  await saveSession(session);
  console.log('\n✅ Extraction complete.');
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

async function executeSync(args: ParsedArgs): Promise<void> {
  if (!args.sessionRef) {
    console.error('Usage: sync <session#|latest>');
    process.exit(1);
  }

  const session = await resolveSessionRef(args.sessionRef);
  if (!session) {
    console.error(`Session not found: ${args.sessionRef}`);
    process.exit(1);
  }

  console.log(`\nSyncing session ${session.id} to Outline...`);

  const config = getOutlineConfig();
  if (!config) {
    console.error(
      'Outline configuration missing in .env (URL, TOKEN required)'
    );
    process.exit(1);
  }

  const publishing = createOutlinePublishingService(config);
  const storage = createFsStorageService();

  const { url } = await syncSessionToOutline(session, publishing, storage);
  console.log(`\n✅ Session synced!`);
  console.log(`URL: ${url}`);
}

async function executeSyncAll(): Promise<void> {
  const storage = createFsStorageService();
  const sessions = await storage.listSessions();

  if (sessions.length === 0) {
    console.log('No sessions found to sync.');
    return;
  }

  const config = getOutlineConfig();
  if (!config) {
    console.error(
      'Outline configuration missing in .env (URL, TOKEN required)'
    );
    process.exit(1);
  }

  const publishing = createOutlinePublishingService(config);

  console.log(`\nSyncing ${sessions.length} sessions to Outline...`);

  for (const session of sessions) {
    process.stdout.write(`  Syncing ${session.id}... `);
    try {
      await syncSessionToOutline(session, publishing, storage);
      console.log('✓');
    } catch (error) {
      console.log(`✗ (${(error as Error).message})`);
    }
  }

  console.log('\n✅ Sync complete.');
}

function getOutlineConfig(): OutlineConfig | null {
  const url = process.env.ESCRIBANO_OUTLINE_URL;
  const token = process.env.ESCRIBANO_OUTLINE_TOKEN;
  const collectionName =
    process.env.ESCRIBANO_OUTLINE_COLLECTION || 'Escribano Sessions';

  if (!url || !token) return null;

  return { url, token, collectionName };
}

async function executeSessions(): Promise<void> {
  const storage = createFsStorageService();
  const sessions = await storage.listSessions();

  if (sessions.length === 0) {
    console.log('No sessions found. Process a recording first.');
    return;
  }

  console.log(`\n📁 Sessions (${sessions.length} total):`);
  sessions.forEach((session, i) => {
    const num = i + 1;
    const date = formatDate(new Date(session.createdAt));
    const scores = formatTopScores(session.classification);
    const artifactCount = session.artifacts?.length ?? 0;

    console.log(
      `  #${num.toString().padEnd(2)} ${date}  ${scores.padEnd(30)}  [${artifactCount} artifacts]`
    );
  });

  console.log('\nUsage: pnpm run generate <#> <type|all>');
}

async function executeGenerate(args: ParsedArgs): Promise<void> {
  if (!args.sessionRef || !args.artifactType) {
    console.error('Usage: generate <session#|latest> <type|all>');
    console.error(
      'Types: summary, action-items, runbook, step-by-step, notes, code-snippets, blog-research, blog-draft'
    );
    process.exit(1);
  }

  const session = await resolveSessionRef(args.sessionRef);
  if (!session) {
    console.error(`Session not found: ${args.sessionRef}`);
    process.exit(1);
  }

  // Ensure classification and metadata
  const prepared = await ensureSessionReady(session);

  if (args.artifactType === 'all') {
    const types = getRecommendedArtifacts(prepared);
    if (types.length === 0) {
      console.log('No recommended artifacts based on classification scores.');
      console.log('Use a specific type instead: summary, notes, etc.');
      return;
    }

    console.log(`\n💡 Generating ${types.length} recommended artifacts...`);
    for (const type of types) {
      await generateAndSave(prepared, type as ArtifactType);
    }
  } else {
    await generateAndSave(prepared, args.artifactType as ArtifactType);
  }
}

async function executeArtifactsList(args: ParsedArgs): Promise<void> {
  if (!args.sessionRef) {
    console.error('Usage: artifacts <session#|latest>');
    process.exit(1);
  }

  const session = await resolveSessionRef(args.sessionRef);
  if (!session) {
    console.error(`Session not found: ${args.sessionRef}`);
    process.exit(1);
  }

  displayClassification(session);

  const storage = createFsStorageService();
  const artifacts = await storage.loadArtifacts(session.id);

  console.log(`\n📄 Artifacts for session ${session.id}:`);
  if (artifacts.length === 0) {
    console.log('   (No artifacts generated yet)');
  } else {
    for (const artifact of artifacts) {
      console.log(`   • ${artifact.type.padEnd(15)} (generated)`);
    }
  }

  const recommendations = getRecommendedArtifacts(session);
  const pending = recommendations.filter(
    (r) => !artifacts.some((a) => a.type === r)
  );

  if (pending.length > 0) {
    console.log('\n💡 Recommended but not generated:');
    for (const type of pending) {
      console.log(`   • ${type}`);
    }
  }

  console.log(
    '\nAvailable types: summary, action-items, runbook, step-by-step, notes, code-snippets, blog-research, blog-draft'
  );
}

async function resolveSessionRef(ref: string): Promise<Session | null> {
  if (ref === 'latest') {
    const capSource = createCapCaptureSource();
    const recording = await capSource.getLatestRecording();
    if (!recording) return null;
    return getOrCreateSession(recording);
  }

  const num = parseInt(ref, 10);
  if (!Number.isNaN(num) && num > 0) {
    const storage = createFsStorageService();
    const sessions = await storage.listSessions();
    if (num > sessions.length) return null;
    return sessions[num - 1]; // #1 = index 0
  }

  // Fallback: treat as full session ID
  const storage = createFsStorageService();
  return storage.loadSession(ref);
}

async function ensureSessionReady(session: Session): Promise<Session> {
  let currentSession = session;

  if (!currentSession.classification) {
    console.log('\nSession not classified. Classifying first...');
    const intelligence = createOllamaIntelligenceService({});
    currentSession = await classifySession(currentSession, intelligence);
    await saveSession(currentSession);
    displayClassification(currentSession);
  }

  if (!currentSession.metadata) {
    console.log('Metadata missing. Extracting metadata first...');
    const intelligence = createOllamaIntelligenceService({});
    currentSession = await extractMetadata(currentSession, intelligence);
    await saveSession(currentSession);
    console.log('✓ Metadata extracted.');
  }

  return currentSession;
}

async function generateAndSave(
  session: Session,
  type: ArtifactType
): Promise<void> {
  console.log(`\nGenerating ${type}...`);

  const intelligence = createOllamaIntelligenceService({});
  const videoService = createFfmpegVideoService();
  const storage = createFsStorageService();

  const artifact = await generateArtifact(
    session,
    intelligence,
    type,
    videoService
  );

  // Update session with new artifact
  if (!session.artifacts) {
    session.artifacts = [];
  }
  const existingIndex = session.artifacts.findIndex((a) => a.type === type);
  if (existingIndex >= 0) {
    session.artifacts[existingIndex] = artifact;
  } else {
    session.artifacts.push(artifact);
  }

  await saveSession(session);
  await storage.saveArtifact(session.id, artifact);

  console.log(`✅ ${type} saved.`);
}

function formatTopScores(classification?: Classification | null): string {
  if (!classification) return '(not classified)';

  const entries = Object.entries(classification)
    .filter(([_, score]) => score >= 25)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 2);

  if (entries.length === 0) return '(low relevance)';

  return entries.map(([type, score]) => `${type} ${score}%`).join(' | ');
}

async function executeSegments(args: ParsedArgs): Promise<void> {
  if (!args.sessionRef) {
    console.error('Usage: segments <session#|latest>');
    process.exit(1);
  }

  const session = await resolveSessionRef(args.sessionRef);
  if (!session) {
    console.error(`Session not found: ${args.sessionRef}`);
    process.exit(1);
  }

  console.log(`\n🎞️  Segments for session: ${session.id}`);
  console.log('='.repeat(60));

  if (session.segments.length === 0) {
    console.log(
      '   (No segments detected yet. Try processing the recording first.)'
    );
    return;
  }

  session.segments.forEach((seg, i) => {
    const timeRange = TimeRange.format(seg.timeRange);
    const type =
      ClassificationModule.getPrimary(
        seg.classification || {
          meeting: 0,
          debugging: 0,
          tutorial: 0,
          learning: 0,
          working: 0,
        }
      ) || 'unknown';
    const noise = seg.isNoise ? ' [NOISE]' : '';
    const contexts = seg.contexts.map((c) => `${c.type}:${c.value}`).join(', ');

    console.log(
      `  #${(i + 1).toString().padEnd(2)} ${timeRange}  [${type.toUpperCase()}]${noise}`
    );
    if (contexts) console.log(`      Contexts: ${contexts}`);
  });
}

async function executeActivities(args: ParsedArgs): Promise<void> {
  if (!args.sessionRef) {
    console.error('Usage: activities <session#|latest>');
    process.exit(1);
  }

  const session = await resolveSessionRef(args.sessionRef);
  if (!session) {
    console.error(`Session not found: ${args.sessionRef}`);
    process.exit(1);
  }

  console.log(`\n📊 Activity Breakdown for session: ${session.id}`);
  console.log('='.repeat(60));

  const breakdown = SessionModule.getActivityBreakdown(session);

  if (Object.keys(breakdown).length === 0) {
    console.log(
      '   (No activities detected yet. Try classifying segments first.)'
    );
    return;
  }

  Object.entries(breakdown)
    .sort(([, a], [, b]) => b - a)
    .forEach(([type, score]) => {
      const bar = '█'.repeat(Math.floor(score / 5));
      console.log(`   • ${type.padEnd(10)} ${bar} ${score}%`);
    });
}

interface BenchmarkStep {
  name: string;
  durationMs: number;
}

async function executeBenchmarkLatest(): Promise<void> {
  const steps: BenchmarkStep[] = [];
  const totalStart = Date.now();

  console.log('\n🔄 Benchmark: Processing latest session...\n');

  // Get latest recording
  const capSource = createCapCaptureSource({});
  const recording = await capSource.getLatestRecording();

  if (!recording) {
    console.error('No recordings found.');
    process.exit(1);
  }

  console.log(`Recording: ${recording.id}`);
  console.log(`Duration: ${formatDuration(recording.duration)}`);
  console.log('');

  // Step 1: Reset
  console.log('Step 1/6: Reset session data');
  let stepStart = Date.now();

  const sessionDir = path.join(homedir(), '.escribano', 'sessions');
  const sessionFile = path.join(sessionDir, `${recording.id}.json`);
  const visualLogDir = path.join(sessionDir, recording.id, 'visual-log');

  if (existsSync(sessionFile)) {
    const { rm } = await import('node:fs/promises');
    await rm(sessionFile);
    console.log(`  ✓ Deleted session file`);
  } else {
    console.log('  ✓ No existing session file');
  }

  if (existsSync(visualLogDir)) {
    const { rm } = await import('node:fs/promises');
    await rm(visualLogDir, { recursive: true, force: true });
    console.log('  ✓ Deleted visual-log directory');
  } else {
    console.log('  ✓ No existing visual-log directory');
  }

  steps.push({ name: 'Reset', durationMs: Date.now() - stepStart });
  console.log(`  ⏱️  ${((Date.now() - stepStart) / 1000).toFixed(2)}s\n`);

  // Step 2: Process Session (transcription + visual)
  console.log('Step 2/6: Process session (transcription + visual)');
  stepStart = Date.now();

  await ensureModel();
  const transcriber = createWhisperTranscriptionService({
    binaryPath: 'whisper-cli',
    model: MODEL_PATH,
    cwd: MODELS_DIR,
    outputFormat: 'json',
  });
  const videoService = createFfmpegVideoService();
  const intelligenceService = createOllamaIntelligenceService({});
  const storageService = createFsStorageService();

  let session = await processSession(
    recording,
    transcriber,
    videoService,
    storageService,
    intelligenceService
  );

  console.log(`  ✓ Transcribed ${session.transcripts.length} audio sources`);
  console.log(`  ✓ Created ${session.segments.length} segments`);
  steps.push({ name: 'Process Session', durationMs: Date.now() - stepStart });
  console.log(`  ⏱️  ${((Date.now() - stepStart) / 1000).toFixed(2)}s\n`);

  // Step 3: Classification
  console.log('Step 3/6: Classification');
  stepStart = Date.now();

  session = await classifySession(session, intelligenceService);
  await saveSession(session);

  if (session.classification) {
    const topScores = Object.entries(session.classification)
      .filter(([, score]) => score >= 25)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 2)
      .map(([type, score]) => `${type} ${score}%`)
      .join(' | ');
    console.log(`  ✓ ${topScores || 'No strong classification'}`);
  }

  steps.push({ name: 'Classification', durationMs: Date.now() - stepStart });
  console.log(`  ⏱️  ${((Date.now() - stepStart) / 1000).toFixed(2)}s\n`);

  // Step 4: Metadata extraction
  console.log('Step 4/6: Metadata extraction');
  stepStart = Date.now();

  session = await extractMetadata(session, intelligenceService);
  await saveSession(session);

  if (session.metadata) {
    const speakers = session.metadata.speakers?.length ?? 0;
    const moments = session.metadata.keyMoments?.length ?? 0;
    const actions = session.metadata.actionItems?.length ?? 0;
    console.log(
      `  ✓ ${speakers} speakers, ${moments} key moments, ${actions} action items`
    );
  }

  steps.push({ name: 'Metadata', durationMs: Date.now() - stepStart });
  console.log(`  ⏱️  ${((Date.now() - stepStart) / 1000).toFixed(2)}s\n`);

  // Step 5: Generate artifacts (recommended)
  console.log('Step 5/6: Generate artifacts (recommended)');
  stepStart = Date.now();

  const recommendedTypes = getRecommendedArtifacts(session);
  console.log(`  Generating ${recommendedTypes.length} artifacts...`);

  for (const artifactType of recommendedTypes) {
    try {
      const artifact = await generateArtifact(
        session,
        intelligenceService,
        artifactType,
        videoService
      );

      if (!session.artifacts) session.artifacts = [];
      const existingIndex = session.artifacts.findIndex(
        (a) => a.type === artifactType
      );
      if (existingIndex >= 0) {
        session.artifacts[existingIndex] = artifact;
      } else {
        session.artifacts.push(artifact);
      }

      await storageService.saveArtifact(session.id, artifact);
      console.log(`  ✓ ${artifactType}`);
    } catch (error) {
      console.log(`  ✗ ${artifactType}: ${(error as Error).message}`);
    }
  }

  await saveSession(session);
  steps.push({ name: 'Artifacts', durationMs: Date.now() - stepStart });
  console.log(`  ⏱️  ${((Date.now() - stepStart) / 1000).toFixed(2)}s\n`);

  // Step 6: Sync to Outline (optional)
  console.log('Step 6/6: Sync to Outline');
  stepStart = Date.now();

  const config = getOutlineConfig();
  if (config) {
    try {
      const publishing = createOutlinePublishingService(config);
      const { url } = await syncSessionToOutline(
        session,
        publishing,
        storageService
      );
      console.log(`  ✓ Synced: ${url}`);
    } catch (error) {
      console.log(`  ✗ Sync failed: ${(error as Error).message}`);
    }
  } else {
    console.log('  ⚠ Skipped (no Outline config in .env)');
  }

  steps.push({ name: 'Outline Sync', durationMs: Date.now() - stepStart });
  console.log(`  ⏱️  ${((Date.now() - stepStart) / 1000).toFixed(2)}s\n`);

  // Final Summary
  printBenchmarkSummary(steps, Date.now() - totalStart);
}

function printBenchmarkSummary(steps: BenchmarkStep[], totalMs: number): void {
  console.log('═'.repeat(50));
  console.log('📊 Benchmark Summary');
  console.log('═'.repeat(50));

  for (const step of steps) {
    const secs = (step.durationMs / 1000).toFixed(1);
    const pct = ((step.durationMs / totalMs) * 100).toFixed(1);
    console.log(`  ${step.name.padEnd(20)} ${secs.padStart(8)}s  (${pct}%)`);
  }

  console.log('─'.repeat(50));
  const totalSecs = totalMs / 1000;
  const mins = Math.floor(totalSecs / 60);
  const secs = Math.floor(totalSecs % 60);
  console.log(
    `  TOTAL${' '.repeat(14)} ${totalSecs.toFixed(1).padStart(8)}s  (${mins}m ${secs}s)`
  );
  console.log('');
}

function showHelp(): void {
  console.log('');
  console.log('Escribano - Session Intelligence Tool');
  console.log('');
  console.log('Usage:');
  console.log(
    '  escribano list [limit]                    List recordings (default: 10)'
  );
  console.log(
    '  escribano transcribe-latest                Transcribe most recent'
  );
  console.log('  escribano transcribe <id>                 Transcribe by ID');
  console.log(
    '  escribano classify-latest                 Classify most recent session'
  );
  console.log(
    '  escribano classify <id>                  Classify session by ID'
  );
  console.log(
    '  escribano extract-metadata-latest      Extract metadata from latest session'
  );
  console.log(
    '  escribano extract-metadata <id>          Extract metadata from session by ID'
  );
  console.log(
    '  escribano restart-latest                 Delete latest session and re-extract'
  );
  console.log(
    '  escribano sessions                      List sessions with # shortcuts'
  );
  console.log(
    '  escribano generate <#/latest> <type|all> Generate artifacts by shortcut'
  );
  console.log(
    '  escribano artifacts <#/latest>          List artifacts for session'
  );
  console.log(
    '  escribano sync <#/latest>               Sync session to Outline'
  );
  console.log(
    '  escribano sync-all                      Sync all sessions + update index'
  );
  console.log(
    '  escribano segments <#/latest>           Show segment timeline'
  );
  console.log(
    '  escribano activities <#/latest>         Show activity breakdown'
  );
  console.log(
    '  escribano benchmark-latest              Reset & run full pipeline with timing'
  );
  console.log(
    '  escribano process-v2 [id|latest]        Run new Audio Observation pipeline (v2)'
  );
  console.log(
    '  escribano recordings-v2                 List recordings in SQLite database'
  );
  console.log(
    '  escribano list-artifacts <id>           List recommended/existing artifacts'
  );
  console.log(
    '  escribano generate-artifact <id> <type> Generate specific artifact'
  );
  console.log('');
  console.log('Examples:');
  console.log('  escribano sessions');
  console.log('  escribano generate 1 summary');
  console.log('  escribano generate 1 all');
  console.log('  escribano generate latest all');
  console.log('  escribano artifacts 1');
  console.log('  escribano list');
  console.log('  escribano list 20');
  console.log('  escribano transcribe-latest');
  console.log('  escribano transcribe "Display 2025-01-08"');
  console.log('  escribano classify-latest');
  console.log('  escribano classify "session-123"');
  console.log('  escribano extract-metadata-latest');
  console.log('  escribano extract-metadata "session-123"');
  console.log('');
  console.log('Prerequisites:');
  console.log('  whisper-cli: brew install whisper-cpp');
  console.log('  ffmpeg:     brew install ffmpeg');
  console.log('  ollama:      brew install ollama && ollama pull qwen3:32b');
  console.log('  Cap:        https://cap.so');
  console.log('');
  console.log('Ollama Setup:');
  console.log('  1. Install: brew install ollama');
  console.log('  2. Pull model: ollama pull qwen3:32b');
  console.log('  3. Start server: ollama serve');
  console.log('');
}

main();
