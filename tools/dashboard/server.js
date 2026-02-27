import express from 'express';
import Database from 'better-sqlite3';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { homedir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = join(homedir(), '.escribano', 'escribano.db');
const ARTIFACTS_DIR = join(homedir(), '.escribano', 'artifacts');
const ESCRIBANO_DIR = join(homedir(), '.escribano');
const PORT = 3456;

const app = express();
let db;

try {
  db = new Database(DB_PATH, { readonly: true });
  console.log(`[db] Connected to ${DB_PATH}`);
} catch (err) {
  console.error(`[db] Failed to open database: ${err.message}`);
  process.exit(1);
}

// No-cache middleware for all API routes
app.use('/api', (req, res, next) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store'
  });
  next();
});

app.use(express.static(__dirname));
app.use('/frames', express.static(ESCRIBANO_DIR));
app.use('/frames-temp', express.static('/var/folders'));

// ============================================
// AGGREGATE STATS API
// ============================================

app.get('/api/stats/aggregate', (req, res) => {
  try {
    // Recording counts by status
    const recordingStats = db
      .prepare(
        `SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) as processed,
          SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
          SUM(CASE WHEN status IN ('raw', 'error') THEN 1 ELSE 0 END) as pending
         FROM recordings`
      )
      .get();

    // Total processing time (only from latest successful run per recording)
    const processingStats = db
      .prepare(
        `SELECT 
          COALESCE(SUM(pr.total_duration_ms), 0) as total_time_ms,
          COALESCE(AVG(pr.total_duration_ms), 0) as avg_time_ms,
          COUNT(*) as run_count
         FROM processing_runs pr
         WHERE pr.status = 'completed'
           AND pr.id IN (
             SELECT MAX(id) FROM processing_runs 
             WHERE status = 'completed' 
             GROUP BY recording_id
           )`
      )
      .get();

    // Frame stats from VLM phase (only from latest successful run per recording)
    const frameStats = db
      .prepare(
        `SELECT 
          COALESCE(SUM(ps.items_processed), 0) as total_frames,
          COUNT(*) as recording_count
         FROM processing_stats ps
         WHERE ps.phase = 'vlm-batch-inference' 
           AND ps.status = 'success'
           AND ps.run_id IN (
             SELECT MAX(id) FROM processing_runs 
             WHERE status = 'completed' 
             GROUP BY recording_id
           )`
      )
      .get();

    // VLM performance - only from latest successful runs
    const vlmStats = db
      .prepare(
        `SELECT 
          AVG(CAST(items_processed AS REAL) / (duration_ms / 1000.0)) as avg_fps,
          MAX(CAST(items_processed AS REAL) / (duration_ms / 1000.0)) as max_fps,
          MIN(CAST(items_processed AS REAL) / NULLIF(duration_ms, 0)) as min_fps
         FROM processing_stats 
         WHERE phase = 'vlm-batch-inference' 
           AND status = 'success' 
           AND duration_ms > 0
           AND items_processed > 0
           AND run_id IN (
             SELECT MAX(id) FROM processing_runs 
             WHERE status = 'completed' 
             GROUP BY recording_id
           )`
      )
      .get();

    // Memory stats from metadata
    const memoryStats = db
      .prepare(
        `SELECT metadata 
         FROM processing_stats 
         WHERE metadata IS NOT NULL 
           AND metadata LIKE '%peakMemoryMB%'
         ORDER BY started_at DESC 
         LIMIT 50`
      )
      .all();

    let peakVlmMemory = 0;
    let avgVlmMemory = 0;
    let peakCpu = 0;
    let avgCpu = 0;
    let vlmMemoryCount = 0;

    for (const row of memoryStats) {
      try {
        const meta = JSON.parse(row.metadata);
        if (meta.resources?.mlx || meta.resources?.['mlx-vlm']) {
          const mlx = meta.resources.mlx || meta.resources['mlx-vlm'];
          if (mlx.peakMemoryMB > peakVlmMemory) peakVlmMemory = mlx.peakMemoryMB;
          if (mlx.avgMemoryMB) {
            avgVlmMemory += mlx.avgMemoryMB;
            vlmMemoryCount++;
          }
          if (mlx.peakCpuPercent > peakCpu) peakCpu = mlx.peakCpuPercent;
          if (mlx.avgCpuPercent) avgCpu += mlx.avgCpuPercent;
        }
      } catch {}
    }
    if (vlmMemoryCount > 0) avgVlmMemory /= vlmMemoryCount;

    // Phase breakdown (averages) - only from latest successful run per recording
    const phaseBreakdown = db
      .prepare(
        `SELECT 
          phase,
          AVG(duration_ms) as avg_duration_ms,
          SUM(duration_ms) as total_duration_ms,
          COUNT(*) as run_count,
          AVG(items_processed) as avg_items
         FROM processing_stats 
         WHERE status = 'success' AND duration_ms > 0
           AND run_id IN (
             SELECT MAX(id) FROM processing_runs 
             WHERE status = 'completed' 
             GROUP BY recording_id
           )
         GROUP BY phase
         ORDER BY total_duration_ms DESC`
      )
      .all();

    // Calculate percentage of total time per phase
    const totalPhaseTime = phaseBreakdown.reduce((sum, p) => sum + (p.total_duration_ms || 0), 0);
    const phasesWithPercent = phaseBreakdown.map(p => ({
      phase: p.phase,
      avg_duration_sec: Math.round((p.avg_duration_ms || 0) / 1000),
      total_duration_sec: Math.round((p.total_duration_ms || 0) / 1000),
      pct_total: totalPhaseTime > 0 ? Math.round((p.total_duration_ms / totalPhaseTime) * 100) : 0,
      run_count: p.run_count,
      avg_items: Math.round(p.avg_items || 0)
    }));

    // Ollama baseline for comparison (historical data shows ~0.6 fps)
    const ollamaBaselineFps = 0.6;
    const speedup = vlmStats.avg_fps ? (vlmStats.avg_fps / ollamaBaselineFps).toFixed(1) : 0;

    res.json({
      recordings: {
        total: recordingStats.total || 0,
        processed: recordingStats.processed || 0,
        processing: recordingStats.processing || 0,
        pending: recordingStats.pending || 0
      },
      processing: {
        total_time_sec: Math.round((processingStats.total_time_ms || 0) / 1000),
        avg_time_sec: Math.round((processingStats.avg_time_ms || 0) / 1000),
        run_count: processingStats.run_count || 0
      },
      frames: {
        total: frameStats.total_frames || 0,
        avg_per_recording: frameStats.recording_count > 0 
          ? Math.round(frameStats.total_frames / frameStats.recording_count) 
          : 0
      },
      vlm: {
        avg_fps: vlmStats.avg_fps ? parseFloat(vlmStats.avg_fps.toFixed(2)) : 0,
        max_fps: vlmStats.max_fps ? parseFloat(vlmStats.max_fps.toFixed(2)) : 0,
        min_fps: vlmStats.min_fps ? parseFloat(vlmStats.min_fps.toFixed(2)) : 0,
        peak_memory_mb: Math.round(peakVlmMemory),
        avg_memory_mb: Math.round(avgVlmMemory),
        peak_cpu_pct: Math.round(peakCpu),
        avg_cpu_pct: Math.round(avgCpu),
        speedup_vs_ollama: parseFloat(speedup)
      },
      phases: phasesWithPercent
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// RECORDINGS OVERVIEW API
// ============================================

app.get('/api/recordings/overview', (req, res) => {
  try {
    const recordings = db
      .prepare(
        `SELECT 
          r.id, 
          r.captured_at, 
          r.duration, 
          r.status, 
          r.source_type,
          r.video_path,
          r.source_metadata,
          (SELECT MAX(pr.started_at) FROM processing_runs pr WHERE pr.recording_id = r.id) as last_run_at
         FROM recordings r
         ORDER BY COALESCE(
           (SELECT MAX(pr.started_at) FROM processing_runs pr WHERE pr.recording_id = r.id),
           r.captured_at
         ) DESC
         LIMIT 50`
      )
      .all();

    // Get stats for each recording
    const overview = recordings.map(rec => {
      // Get frame count and VLM stats from LATEST successful run
      const vlmStats = db
        .prepare(
          `SELECT 
            ps.items_processed as frames,
            ps.duration_ms,
            CAST(ps.items_processed AS REAL) / NULLIF(ps.duration_ms / 1000.0, 0) as fps
           FROM processing_stats ps
           WHERE ps.run_id IN (
             SELECT id FROM processing_runs 
             WHERE recording_id = ? AND status = 'completed'
             ORDER BY started_at DESC LIMIT 1
           )
           AND ps.phase = 'vlm-batch-inference' 
           AND ps.status = 'success'`
        )
        .get(rec.id);

      // Get total processing time: sum of LATEST duration per distinct phase
      // This correctly aggregates time across multiple runs (initial + artifact re-runs)
      const runStats = db
        .prepare(
          `WITH latest_phases AS (
            SELECT ps.phase, MAX(ps.started_at) as last_started
            FROM processing_stats ps
            JOIN processing_runs pr ON ps.run_id = pr.id
            WHERE pr.recording_id = ?
              AND ps.status = 'success'
              AND ps.duration_ms > 0
            GROUP BY ps.phase
          )
          SELECT SUM(ps.duration_ms) as total_ms
          FROM processing_stats ps
          JOIN processing_runs pr ON ps.run_id = pr.id
          JOIN latest_phases lp ON ps.phase = lp.phase AND ps.started_at = lp.last_started
          WHERE pr.recording_id = ?
            AND ps.status = 'success'`
        )
        .get(rec.id, rec.id);

      // Get outline URL from metadata
      let outlineUrl = null;
      if (rec.source_metadata) {
        try {
          const meta = JSON.parse(rec.source_metadata);
          outlineUrl = meta.outline?.url || null;
        } catch {}
      }

      // Get artifacts from database
      const artifacts = db
        .prepare(
          `SELECT id, type, format, created_at
           FROM artifacts 
           WHERE recording_id = ?
           ORDER BY created_at DESC`
        )
        .all(rec.id);

      // Get artifact_subjects mapping
      const artifactSubjects = {};
      for (const artifact of artifacts) {
        const links = db
          .prepare(
            `SELECT subject_id FROM artifact_subjects WHERE artifact_id = ?`
          )
          .all(artifact.id);
        artifactSubjects[artifact.id] = links.map(l => l.subject_id);
      }

      // Count artifacts by type
      const artifactCounts = { total: artifacts.length, summary: 0, card: 0, standup: 0, narrative: 0 };
      for (const a of artifacts) {
        if (artifactCounts[a.type] !== undefined) {
          artifactCounts[a.type]++;
        }
      }

      // Find summary file (legacy fallback)
      const summaryFile = findSummaryFile(rec.id);

      // Determine if summary is present (DB artifacts OR file fallback)
      const summaryPresent = artifactCounts.summary > 0 || !!summaryFile;

      // Calculate real-time factor
      const procTime = (runStats?.total_ms || 0) / 1000;
      const recDuration = rec.duration || 0;
      const rtFactor = procTime > 0 && recDuration > 0 
        ? (procTime / recDuration).toFixed(2) 
        : null;

      return {
        id: rec.id,
        captured_at: rec.captured_at,
        last_run_at: rec.last_run_at,
        duration: rec.duration,
        status: rec.status,
        source_type: rec.source_type,
        video_path: rec.video_path,
        stats: {
          frames: vlmStats?.frames || 0,
          vlm_fps: vlmStats?.fps ? parseFloat(vlmStats.fps.toFixed(2)) : null,
          processing_time_sec: Math.round(procTime),
          real_time_factor: rtFactor ? parseFloat(rtFactor) : null
        },
        summary: {
          path: summaryFile,
          outline_url: outlineUrl
        },
        artifacts: artifacts.map(a => ({
          id: a.id,
          type: a.type,
          format: a.format,
          created_at: a.created_at,
          outline_url: outlineUrl,
          subject_ids: artifactSubjects[a.id] || []
        })),
        artifact_counts: artifactCounts,
        summary_present: summaryPresent,
        outline_url: outlineUrl
      };
    });

    res.json(overview);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// RECORDING DETAIL API
// ============================================

app.get('/api/recording/:id/detail', (req, res) => {
  try {
    const { id } = req.params;

    // Get recording
    const recording = db
      .prepare(
        `SELECT * FROM recordings WHERE id = ?`
      )
      .get(id);

    if (!recording) {
      return res.status(404).json({ error: 'Recording not found' });
    }

    // Get latest run stats
    const runStats = db
      .prepare(
        `SELECT 
          ps.phase,
          ps.status,
          ps.duration_ms,
          ps.items_total,
          ps.items_processed,
          ps.metadata
         FROM processing_stats ps
         JOIN processing_runs pr ON ps.run_id = pr.id
         WHERE pr.recording_id = ?
         ORDER BY pr.started_at DESC, ps.started_at ASC
         LIMIT 20`
      )
      .all(id);

    // Process stats with resource info
    const phases = runStats.map(s => {
      let resources = null;
      if (s.metadata) {
        try {
          const meta = JSON.parse(s.metadata);
          resources = meta.resources || null;
        } catch {}
      }
      return {
        phase: s.phase,
        status: s.status,
        duration_sec: Math.round((s.duration_ms || 0) / 1000),
        items_total: s.items_total,
        items_processed: s.items_processed,
        resources
      };
    });

    // Get frames (visual observations)
    const frames = db
      .prepare(
        `SELECT 
          id,
          timestamp,
          image_path,
          vlm_description,
          vlm_raw_response,
          activity_type,
          apps,
          topics
         FROM observations 
         WHERE recording_id = ? AND type = 'visual'
         ORDER BY timestamp ASC`
      )
      .all(id);

    // Parse JSON fields in frames
    const parsedFrames = frames.map(f => ({
      ...f,
      apps: f.apps ? JSON.parse(f.apps) : [],
      topics: f.topics ? JSON.parse(f.topics) : []
    }));

    // Get summary content
    const summaryFile = findSummaryFile(id);
    let summaryContent = null;
    if (summaryFile && existsSync(summaryFile)) {
      try {
        summaryContent = readFileSync(summaryFile, 'utf-8');
      } catch {}
    }

    // Get outline URL from metadata
    let outlineUrl = null;
    if (recording.source_metadata) {
      try {
        const meta = JSON.parse(recording.source_metadata);
        outlineUrl = meta.outline?.url || null;
      } catch {}
    }

    // Get subjects for this recording
    const subjects = db
      .prepare(
        `SELECT 
          id,
          label,
          is_personal,
          duration,
          activity_breakdown,
          metadata
         FROM subjects 
         WHERE recording_id = ?
         ORDER BY created_at ASC`
      )
      .all(id);

    // Parse subjects data
    const parsedSubjects = subjects.map(s => {
      let activityBreakdown = {};
      let apps = [];
      try {
        activityBreakdown = s.activity_breakdown ? JSON.parse(s.activity_breakdown) : {};
      } catch {}
      try {
        const meta = s.metadata ? JSON.parse(s.metadata) : {};
        apps = meta.apps || [];
      } catch {}
      return {
        id: s.id,
        label: s.label,
        is_personal: s.is_personal === 1,
        duration: s.duration,
        activity_breakdown: activityBreakdown,
        apps: apps
      };
    });

    // Get artifacts from database
    const dbArtifacts = db
      .prepare(
        `SELECT id, type, format, content, created_at
         FROM artifacts 
         WHERE recording_id = ?
         ORDER BY created_at DESC`
      )
      .all(id);

    // Get artifact_subjects mapping
    const artifactsWithSubjects = dbArtifacts.map(a => {
      const links = db
        .prepare(
          `SELECT subject_id FROM artifact_subjects WHERE artifact_id = ?`
        )
        .all(a.id);
      return {
        id: a.id,
        type: a.type,
        format: a.format,
        content: a.content,
        created_at: a.created_at,
        outline_url: outlineUrl,
        subject_ids: links.map(l => l.subject_id)
      };
    });

    // Count artifacts by type
    const artifactCounts = { total: dbArtifacts.length, summary: 0, card: 0, standup: 0, narrative: 0 };
    for (const a of dbArtifacts) {
      if (artifactCounts[a.type] !== undefined) {
        artifactCounts[a.type]++;
      }
    }

    const summaryPresent = artifactCounts.summary > 0 || !!summaryContent;

    // Get total processing time: sum of LATEST duration per distinct phase
    const totalProcessingStats = db
      .prepare(
        `WITH latest_phases AS (
          SELECT ps.phase, MAX(ps.started_at) as last_started
          FROM processing_stats ps
          JOIN processing_runs pr ON ps.run_id = pr.id
          WHERE pr.recording_id = ?
            AND ps.status = 'success'
            AND ps.duration_ms > 0
          GROUP BY ps.phase
        )
        SELECT SUM(ps.duration_ms) as total_ms
        FROM processing_stats ps
        JOIN processing_runs pr ON ps.run_id = pr.id
        JOIN latest_phases lp ON ps.phase = lp.phase AND ps.started_at = lp.last_started
        WHERE pr.recording_id = ?
          AND ps.status = 'success'`
      )
      .get(id, id);

    const totalProcessingSec = Math.round((totalProcessingStats?.total_ms || 0) / 1000);

    res.json({
      recording: {
        id: recording.id,
        captured_at: recording.captured_at,
        duration: recording.duration,
        status: recording.status,
        source_type: recording.source_type,
        video_path: recording.video_path
      },
      stats: {
        phases,
        frame_count: frames.length,
        total_processing_sec: totalProcessingSec
      },
      summary: {
        content: summaryContent,
        path: summaryFile,
        outline_url: outlineUrl
      },
      subjects: parsedSubjects,
      frames: parsedFrames,
      artifacts: artifactsWithSubjects,
      artifact_counts: artifactCounts,
      summary_present: summaryPresent,
      outline_url: outlineUrl
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// SUMMARY API
// ============================================

app.get('/api/summary/:recordingId', (req, res) => {
  try {
    const { recordingId } = req.params;
    const summaryFile = findSummaryFile(recordingId);

    if (!summaryFile || !existsSync(summaryFile)) {
      return res.status(404).json({ error: 'Summary not found' });
    }

    const content = readFileSync(summaryFile, 'utf-8');

    // Get outline URL
    const recording = db
      .prepare(`SELECT source_metadata FROM recordings WHERE id = ?`)
      .get(recordingId);

    let outlineUrl = null;
    if (recording?.source_metadata) {
      try {
        const meta = JSON.parse(recording.source_metadata);
        outlineUrl = meta.outline?.url || null;
      } catch {}
    }

    res.json({
      content,
      path: summaryFile,
      outline_url: outlineUrl
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// LEGACY APIs (kept for compatibility)
// ============================================

app.get('/api/recordings', (req, res) => {
  try {
    const recordings = db
      .prepare(
        `SELECT id, captured_at, duration, status, source_type 
         FROM recordings 
         ORDER BY captured_at DESC 
         LIMIT 50`
      )
      .all();
    res.json(recordings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/observations/:recordingId', (req, res) => {
  try {
    const { recordingId } = req.params;
    const observations = db
      .prepare(
        `SELECT id, timestamp, image_path, vlm_description, vlm_raw_response, activity_type, apps, topics, type
         FROM observations 
         WHERE recording_id = ? AND type = 'visual'
         ORDER BY timestamp ASC`
      )
      .all(recordingId);
    res.json(observations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/recording/:id', (req, res) => {
  try {
    const { id } = req.params;
    const recording = db
      .prepare(
        `SELECT id, captured_at, duration, status, source_type, video_path
         FROM recordings 
         WHERE id = ?`
      )
      .get(id);
    res.json(recording);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/runs', (req, res) => {
  try {
    const runs = db
      .prepare(
        `SELECT 
          pr.id, 
          pr.recording_id, 
          pr.run_type, 
          pr.status, 
          pr.started_at, 
          pr.completed_at, 
          pr.total_duration_ms, 
          pr.error_message,
          pr.metadata
        FROM processing_runs pr
        ORDER BY pr.started_at DESC
        LIMIT 100`
      )
      .all();
    res.json(runs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/runs/:runId/stats', (req, res) => {
  try {
    const { runId } = req.params;
    const stats = db
      .prepare(
        `SELECT 
          ps.id, 
          ps.phase, 
          ps.status, 
          ps.started_at, 
          ps.completed_at, 
          ps.duration_ms, 
          ps.items_total, 
          ps.items_processed, 
          ps.metadata
        FROM processing_stats ps
        WHERE ps.run_id = ?
        ORDER BY ps.started_at ASC`
      )
      .all(runId);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/runs/recording/:recordingId', (req, res) => {
  try {
    const { recordingId } = req.params;
    const runs = db
      .prepare(
        `SELECT 
          pr.id, 
          pr.run_type, 
          pr.status, 
          pr.started_at, 
          pr.completed_at, 
          pr.total_duration_ms, 
          pr.error_message
        FROM processing_runs pr
        WHERE pr.recording_id = ?
        ORDER BY pr.started_at DESC`
      )
      .all(recordingId);
    res.json(runs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// HELPER FUNCTIONS
// ============================================

function findSummaryFile(recordingId) {
  try {
    const { readdirSync } = require('node:fs');
    const files = readdirSync(ARTIFACTS_DIR);
    
    // Look for summary file matching this recording
    const normalizedId = recordingId.toLowerCase().replace(/-/g, '-');
    const match = files.find(f => 
      f.toLowerCase().includes(normalizedId) && f.endsWith('.md')
    );
    
    return match ? join(ARTIFACTS_DIR, match) : null;
  } catch {
    return null;
  }
}

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
  console.log(`Dashboard: http://localhost:${PORT}`);
  console.log(`Overview: http://localhost:${PORT}/overview.html`);
  console.log(`Debug: http://localhost:${PORT}/debug.html`);
  console.log(`Stats: http://localhost:${PORT}/stats.html`);
});
