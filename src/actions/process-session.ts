/**
 * Process Session Action
 * @deprecated V2 pipeline - use process-recording-v3.ts instead.
 *
 * Takes a recording and transcribes all available audio sources, creating a Session.
 * Supports multiple audio sources (mic, system) with parallel transcription option.
 */

import os from 'node:os';
import path from 'node:path';
import type {
  IntelligenceService,
  Recording,
  Session as SessionType,
  StorageService,
  TaggedTranscript,
  TranscriptionService,
  VideoService,
  VisualDescription,
  VisualIndex,
  VisualLog,
  VisualLogEntry,
} from '../0_types.js';
import { Session } from '../domain/session.js';
import { Transcript } from '../domain/transcript.js';

/**
 * Transcribe multiple audio sources, optionally in parallel.
 */
async function transcribeAudioSources(
  sources: Array<{ source: 'mic' | 'system'; path: string }>,
  transcriber: TranscriptionService,
  parallel = false
): Promise<TaggedTranscript[]> {
  const results: TaggedTranscript[] = [];

  if (parallel) {
    console.log('Transcribing audio sources in parallel...');
    const promises = sources.map(async ({ source, path }) => {
      try {
        console.log(`Transcribing ${source} audio from: ${path}`);
        const transcript = await transcriber.transcribe(path);
        if (Transcript.isEmpty(transcript)) {
          console.log(`Warning: ${source} audio produced empty transcript`);
          return null;
        }
        return { source, transcript };
      } catch (error) {
        console.error(`Failed to transcribe ${source} audio:`, error);
        return null;
      }
    });

    const transcribed = await Promise.all(promises);
    return transcribed.filter((t): t is TaggedTranscript => t !== null);
  }

  console.log('Transcribing audio sources sequentially...');
  for (const { source, path } of sources) {
    try {
      console.log(`Transcribing ${source} audio from: ${path}`);
      const transcript = await transcriber.transcribe(path);
      if (Transcript.isEmpty(transcript)) {
        console.log(`Warning: ${source} audio produced empty transcript`);
        continue;
      }
      results.push({ source, transcript });
    } catch (error) {
      console.error(`Failed to transcribe ${source} audio:`, error);
    }
  }

  return results;
}

/**
 * Process a recording by transcribing all available audio sources and extracting visual logs
 */
export async function processSession(
  recording: Recording,
  transcriber: TranscriptionService,
  videoService: VideoService,
  storageService: StorageService,
  intelligenceService?: IntelligenceService
): Promise<SessionType> {
  console.log(`Processing recording: ${recording.id}`);

  let session = Session.create(recording);
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
    const transcripts = await transcribeAudioSources(
      audioSources,
      transcriber,
      parallelTranscription
    );
    session = Session.withTranscripts(session, transcripts);
  }

  // Intermediate save to ensure we don't lose transcription work
  await storageService.saveSession(session);

  // 2. Visual Log Extraction
  if (!recording.videoPath) {
    return finalizeSession(session, [], storageService);
  }

  const { visualLogs, updatedSession } = await extractVisualLogs(
    session,
    videoService,
    intelligenceService
  );

  return finalizeSession(updatedSession, visualLogs, storageService);
}

/**
 * Extract visual logs from a video recording
 */
async function extractVisualLogs(
  session: SessionType,
  videoService: VideoService,
  intelligenceService?: IntelligenceService
): Promise<{ visualLogs: VisualLog[]; updatedSession: SessionType }> {
  const { recording } = session;
  if (!recording.videoPath) return { visualLogs: [], updatedSession: session };

  console.log(`Extracting visual log from: ${recording.videoPath}`);
  const visualLogDir = path.join(
    os.homedir(),
    '.escribano',
    'sessions',
    recording.id,
    'visual-log'
  );

  try {
    const sceneResults = await videoService.extractFramesAtInterval(
      recording.videoPath,
      0.3,
      visualLogDir
    );

    if (sceneResults.length === 0)
      return { visualLogs: [], updatedSession: session };

    console.log('Running visual analysis (OCR + CLIP)...');
    const indexPath = path.join(visualLogDir, 'visual-index.json');
    const visualIndex = await videoService.runVisualIndexing(
      visualLogDir,
      indexPath
    );

    console.log(
      `✓ Indexed ${visualIndex.frames.length} frames into ${visualIndex.clusters.length} clusters`
    );

    // Update session with visual index (generates segments)
    const updatedSession = Session.withVisualIndex(session, visualIndex);

    const descriptions = await getVisualDescriptions(
      updatedSession,
      visualIndex,
      intelligenceService
    );

    const entries: VisualLogEntry[] = visualIndex.clusters.map((cluster) => {
      const repFrame = visualIndex.frames.find(
        (f) => f.index === cluster.representativeIdx
      );
      const vlmDesc = descriptions.find((d) => d.clusterId === cluster.id);

      return {
        timestamp: repFrame?.timestamp || cluster.timeRange[0],
        imagePath: repFrame?.imagePath || '',
        description: vlmDesc?.description,
        ocrSummary: repFrame?.ocrText.substring(0, 200).replace(/\n/g, ' '),
        heuristicLabel: cluster.heuristicLabel,
      };
    });

    return {
      visualLogs: [{ entries, source: 'screen' }],
      updatedSession,
    };
  } catch (error) {
    console.error('Failed to extract visual log:', error);
    return { visualLogs: [], updatedSession: session };
  }
}

/**
 * Get VLM descriptions for relevant segments
 */
async function getVisualDescriptions(
  session: SessionType,
  visualIndex: VisualIndex,
  intelligenceService?: IntelligenceService
): Promise<VisualDescription[]> {
  const segmentsNeedingVLM = Session.getSegmentsNeedingVLM(session);

  if (segmentsNeedingVLM.length === 0 || !intelligenceService) {
    if (segmentsNeedingVLM.length > 0) {
      console.log(
        '  Skipping VLM descriptions (no intelligence service provided)'
      );
    }
    return [];
  }

  console.log(
    `Describing ${segmentsNeedingVLM.length} visual-heavy segments...`
  );

  const imagesToDescribe = segmentsNeedingVLM
    .map((seg) => {
      // Find representative frame for the first cluster in segment
      const clusterId = seg.visualClusterIds[0];
      const cluster = visualIndex.clusters.find((c) => c.id === clusterId);
      const repFrame = visualIndex.frames.find(
        (f) => f.index === cluster?.representativeIdx
      );
      return {
        imagePath: repFrame?.imagePath || '',
        clusterId,
        timestamp: repFrame?.timestamp || 0,
      };
    })
    .filter((img: { imagePath: string }) => img.imagePath);

  try {
    const descResult =
      await intelligenceService.describeImages(imagesToDescribe);
    // New interface returns array directly
    return descResult.map((d) => ({
      clusterId: 0,
      timestamp: d.timestamp,
      description: d.description,
    }));
  } catch (descError) {
    console.warn(`  Warning: Visual description failed: ${descError}`);
    return [];
  }
}

/**
 * Finalize session processing, perform validation and save
 */
async function finalizeSession(
  session: SessionType,
  visualLogs: VisualLog[],
  storageService: StorageService
): Promise<SessionType> {
  const finalSession = {
    ...session,
    visualLogs,
    updatedAt: new Date(),
  };

  const hasAudioContent = finalSession.transcripts.length > 0;
  const hasVisualContent =
    visualLogs.length > 0 && visualLogs[0].entries.length > 0;

  if (!hasAudioContent && !hasVisualContent) {
    finalSession.status = 'error';
    const message = `Session processing failed: No audio content AND no visual changes detected for recording: ${finalSession.id}`;
    finalSession.errorMessage = message;
    await storageService.saveSession(finalSession);
    throw new Error(message);
  }

  console.log(
    `Processing complete. Sources: ${finalSession.transcripts.length} audio, ${visualLogs.length} visual. Segments: ${finalSession.segments.length}`
  );

  await storageService.saveSession(finalSession);
  return finalSession;
}
