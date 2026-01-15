/**
 * Process Session Action
 *
 * Takes a recording and transcribes all available audio sources, creating a Session.
 * Supports multiple audio sources (mic, system) with parallel transcription option.
 */

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
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
 * Calculate overlap between a time range and transcript segments
 */
function calculateAudioOverlap(
  timeRange: [number, number],
  transcripts: TaggedTranscript[]
): number {
  let overlapSeconds = 0;
  const [start, end] = timeRange;

  for (const tagged of transcripts) {
    for (const segment of tagged.transcript.segments) {
      const segStart = segment.start;
      const segEnd = segment.end;

      // Calculate intersection
      const intersectStart = Math.max(start, segStart);
      const intersectEnd = Math.min(end, segEnd);

      if (intersectEnd > intersectStart) {
        overlapSeconds += intersectEnd - intersectStart;
      }
    }
  }

  return overlapSeconds;
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
  await storageService.saveSession(theSession);

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
      // Scene detection for the visual log (sampling at 1 FPS for indexing)
      // We use detectAndExtractScenes as our base extraction step
      const sceneResults = await videoService.detectAndExtractScenes(
        recording.videoPath,
        0.3,
        visualLogDir
      );

      if (sceneResults.length > 0) {
        console.log('Running visual analysis (OCR + CLIP)...');
        const indexPath = path.join(visualLogDir, 'visual-index.json');

        // Phase 1: Base Indexing
        const visualIndex = await videoService.runVisualIndexing(
          visualLogDir,
          indexPath
        );
        console.log(
          `✓ Indexed ${visualIndex.frames.length} frames into ${visualIndex.clusters.length} clusters`
        );

        // Phase 2: Discriminator logic for VLM
        const clustersNeedingVLM = determineClustersNeedingVLM(
          visualIndex.clusters,
          transcripts
        );

        let descriptions: VisualDescription[] = [];
        if (clustersNeedingVLM.length > 0 && intelligenceService) {
          console.log(
            `Describing ${clustersNeedingVLM.length} visual-heavy segments...`
          );

          // Build list of images to describe (representative frame from each cluster)
          const imagesToDescribe = clustersNeedingVLM
            .map((clusterId) => {
              const cluster = visualIndex.clusters.find(
                (c) => c.id === clusterId
              );
              const repFrame = visualIndex.frames.find(
                (f) => f.index === cluster?.representativeIdx
              );
              return {
                imagePath: repFrame?.imagePath || '',
                clusterId,
                timestamp: repFrame?.timestamp || 0,
              };
            })
            .filter((img) => img.imagePath); // Filter out any without valid paths

          try {
            const descResult =
              await intelligenceService.describeImages(imagesToDescribe);
            descriptions = descResult.descriptions;
            console.log(`✓ Described ${descriptions.length} segments.`);

            // Save to file for caching/reference
            const descPath = path.join(
              visualLogDir,
              'visual-descriptions.json'
            );
            await writeFile(descPath, JSON.stringify(descResult, null, 2));
          } catch (descError) {
            console.warn(`  Warning: Visual description failed: ${descError}`);
            // Non-fatal, we continue with OCR context
          }
        } else if (clustersNeedingVLM.length > 0) {
          console.log(
            '  Skipping VLM descriptions (no intelligence service provided)'
          );
        }

        // Phase 3: Build VisualLog entries
        const entries: VisualLogEntry[] = visualIndex.clusters.map(
          (cluster) => {
            const repFrame = visualIndex.frames.find(
              (f) => f.index === cluster.representativeIdx
            );
            const vlmDesc = descriptions.find(
              (d) => d.clusterId === cluster.id
            );

            return {
              timestamp: repFrame?.timestamp || cluster.timeRange[0],
              imagePath: repFrame?.imagePath || '',
              description: vlmDesc?.description,
              ocrSummary: repFrame?.ocrText
                .substring(0, 200)
                .replace(/\n/g, ' '),
              heuristicLabel: cluster.heuristicLabel,
            };
          }
        );

        visualLogs.push({
          entries,
          source: 'screen',
        });
      }
    } catch (error) {
      console.error('Failed to extract visual log:', error);
    }
  }

  theSession.visualLogs = visualLogs;
  theSession.updatedAt = new Date();
  await storageService.saveSession(theSession);

  // 3. Validation
  const hasAudioContent = transcripts.length > 0;
  const hasVisualContent =
    visualLogs.length > 0 && visualLogs[0].entries.length > 0;

  if (!hasAudioContent && !hasVisualContent) {
    theSession.updatedAt = new Date();
    theSession.status = 'error';
    const message = `Session processing failed: No audio content AND no visual changes detected for recording: ${recording.id}`;
    theSession.errorMessage = message;
    throw new Error(message);
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
