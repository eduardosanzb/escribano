/**
 * Escribano CLI Entry Point
 *
 * Transcribes Cap recordings using whisper.cpp.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspect } from 'node:util';
import type {
  Artifact,
  ArtifactType,
  Classification,
  OutlineConfig,
  Recording,
  Session,
} from './0_types.js';
import { classifySession } from './actions/classify-session.js';
import { extractMetadata } from './actions/extract-metadata.js';
import {
  generateArtifact,
  getRecommendedArtifacts,
} from './actions/generate-artifact.js';
import { processSession } from './actions/process-session.js';
import { syncSessionToOutline } from './actions/sync-to-outline.js';
import { createCapCaptureSource } from './adapters/capture.cap.adapter.js';
import { createOllamaIntelligenceService } from './adapters/intelligence.ollama.adapter.js';
import { createOutlinePublishingService } from './adapters/publishing.outline.adapter.js';
import { createFsStorageService } from './adapters/storage.fs.adapter.js';
import { createWhisperTranscriptionService } from './adapters/transcription.whisper.adapter.js';
import { createFfmpegVideoService } from './adapters/video.ffmpeg.adapter.js';

const MODELS_DIR = path.join(os.homedir(), '.escribano', 'models');
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

    default:
      return { command: 'help', limit: 10 };
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
    args.artifactType as any,
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

async function loadSession(sessionId: string): Promise<Session | null> {
  const sessionDir = path.join(os.homedir(), '.escribano', 'sessions');
  const sessionFile = path.join(sessionDir, `${sessionId}.json`);

  try {
    const content = readFileSync(sessionFile, 'utf-8');
    return JSON.parse(content) as Session;
  } catch {
    return null;
  }
}

async function saveSession(session: Session): Promise<void> {
  const sessionDir = path.join(os.homedir(), '.escribano', 'sessions');
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

function displayMetadata(metadata: any | null): void {
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

  const sessionDir = path.join(os.homedir(), '.escribano', 'sessions');
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
  if (!isNaN(num) && num > 0) {
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
