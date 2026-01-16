/**
 * Process Session Action
 *
 * Takes a recording and transcribes all available audio sources, creating a Session.
 * Supports multiple audio sources (mic, system) with parallel transcription option.
 */

import os from 'node:os';
import path from 'node:path';
import type {
  IntelligenceService,
  Recording,
  Session,
  StorageService,
  TaggedTranscript,
  Transcript,
  TranscriptionService,
  VideoService,
  VisualDescription,
  VisualIndex,
  VisualIndexCluster,
  VisualLog,
  VisualLogEntry,
} from '../0_types.js';

/**
 * Check if a transcript is empty (no content)
 */
function isEmptyTranscript(transcript: Transcript): boolean {
  return !transcript.fullText.trim() || transcript.segments.length === 0;
}

/**
 * Calculate the total seconds of audio that overlap with a given time range.
 * This helps determine if a visual segment has corresponding spoken content.
 */
export function calculateAudioOverlap(
  timeRange: [number, number],
  transcripts: TaggedTranscript[]
): number {
  const [rangeStart, rangeEnd] = timeRange;
  let totalOverlapSeconds = 0;

  for (const { transcript } of transcripts) {
    for (const segment of transcript.segments) {
      // Find the intersection between the segment and the target time range
      const overlapStart = Math.max(rangeStart, segment.start);
      const overlapEnd = Math.min(rangeEnd, segment.end);
      const overlapDuration = overlapEnd - overlapStart;

      if (overlapDuration > 0) {
        totalOverlapSeconds += overlapDuration;
      }
    }
  }

  return totalOverlapSeconds;
}

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
        if (isEmptyTranscript(transcript)) {
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
      if (isEmptyTranscript(transcript)) {
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
): Promise<Session> {
  console.log(`Processing recording: ${recording.id}`);

  const transcripts: TaggedTranscript[] = [];
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
    const transcribed = await transcribeAudioSources(
      audioSources,
      transcriber,
      parallelTranscription
    );
    transcripts.push(...transcribed);
  }

  const theSession: Session = {
    id: recording.id,
    recording,
    transcripts,
    visualLogs: [],
    status: 'transcribed',
    classification: null,
    metadata: null,
    artifacts: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Intermediate save to ensure we don't lose transcription work
  await storageService.saveSession(theSession);

  // 2. Visual Log Extraction
  if (!recording.videoPath) {
    return finalizeSession(theSession, [], storageService);
  }

  const visualLogs = await extractVisualLogs(
    recording,
    videoService,
    transcripts,
    intelligenceService
  );

  return finalizeSession(theSession, visualLogs, storageService);
}

/**
 * Extract visual logs from a video recording
 */
async function extractVisualLogs(
  recording: Recording,
  videoService: VideoService,
  transcripts: TaggedTranscript[],
  intelligenceService?: IntelligenceService
): Promise<VisualLog[]> {
  if (!recording.videoPath) return [];

  console.log(`Extracting visual log from: ${recording.videoPath}`);
  const visualLogDir = path.join(
    os.homedir(),
    '.escribano',
    'sessions',
    recording.id,
    'visual-log'
  );

  try {
    const sceneResults = await videoService.detectAndExtractScenes(
      recording.videoPath,
      0.3,
      visualLogDir
    );

    if (sceneResults.length === 0) return [];

    console.log('Running visual analysis (OCR + CLIP)...');
    const indexPath = path.join(visualLogDir, 'visual-index.json');
    const visualIndex = await videoService.runVisualIndexing(
      visualLogDir,
      indexPath
    );

    console.log(
      `✓ Indexed ${visualIndex.frames.length} frames into ${visualIndex.clusters.length} clusters`
    );

    const descriptions = await getVisualDescriptions(
      visualIndex,
      transcripts,
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

    return [{ entries, source: 'screen' }];
  } catch (error) {
    console.error('Failed to extract visual log:', error);
    return [];
  }
}

/**
 * Determine which clusters need VLM descriptions
 */
function determineClustersNeedingVLM(
  clusters: VisualIndexCluster[],
  transcripts: TaggedTranscript[]
): number[] {
  const needsVLM: number[] = [];

  // TODO: Move to config
  const OCR_DENSITY_THRESHOLD = 500;
  const AUDIO_OVERLAP_MIN_SECONDS = 5;

  for (const cluster of clusters) {
    const audioOverlap = calculateAudioOverlap(cluster.timeRange, transcripts);

    // Rule 1: No meaningful audio overlap
    if (audioOverlap < AUDIO_OVERLAP_MIN_SECONDS) {
      needsVLM.push(cluster.id);
      continue;
    }

    // Rule 2: Low OCR density (likely images/diagrams)
    if (cluster.avgOcrCharacters < OCR_DENSITY_THRESHOLD) {
      needsVLM.push(cluster.id);
      continue;
    }

    // Rule 3: Media indicators (video player, etc.)
    if (cluster.mediaIndicators.length > 0) {
      needsVLM.push(cluster.id);
    }
  }

  return needsVLM;
}

/**
 * Get VLM descriptions for relevant visual clusters
 */
async function getVisualDescriptions(
  visualIndex: VisualIndex,
  transcripts: TaggedTranscript[],
  intelligenceService?: IntelligenceService
): Promise<VisualDescription[]> {
  const clustersNeedingVLM = determineClustersNeedingVLM(
    visualIndex.clusters,
    transcripts
  );

  if (clustersNeedingVLM.length === 0 || !intelligenceService) {
    if (clustersNeedingVLM.length > 0) {
      console.log(
        '  Skipping VLM descriptions (no intelligence service provided)'
      );
    }
    return [];
  }

  console.log(
    `Describing ${clustersNeedingVLM.length} visual-heavy segments...`
  );

  const imagesToDescribe = clustersNeedingVLM
    .map((clusterId: number) => {
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
    return descResult.descriptions;
  } catch (descError) {
    console.warn(`  Warning: Visual description failed: ${descError}`);
    return [];
  }
}

/**
 * Finalize session processing, perform validation and save
 */
async function finalizeSession(
  session: Session,
  visualLogs: VisualLog[],
  storageService: StorageService
): Promise<Session> {
  session.visualLogs = visualLogs;
  session.updatedAt = new Date();

  const hasAudioContent = session.transcripts.length > 0;
  const hasVisualContent =
    visualLogs.length > 0 && visualLogs[0].entries.length > 0;

  if (!hasAudioContent && !hasVisualContent) {
    session.status = 'error';
    const message = `Session processing failed: No audio content AND no visual changes detected for recording: ${session.id}`;
    session.errorMessage = message;
    await storageService.saveSession(session);
    throw new Error(message);
  }

  console.log(
    `Processing complete. Sources: ${session.transcripts.length} audio, ${visualLogs.length} visual.`
  );

  await storageService.saveSession(session);
  return session;
}
