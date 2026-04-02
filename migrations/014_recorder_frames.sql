-- SHARED SCHEMA: This migration is part of the contract between
-- escribano (public TS pipeline) and escribano-app (private Swift recorder).
-- Both repos must agree on this schema version before changing this file.
--
-- ============================================================================
-- Recorder Frames Table (Phase 1 — Fotógrafo Capture Agent)
-- ============================================================================
-- Stores frame metadata captured by the Swift agent.
-- JPEGs live at ~/.escribano/frames/{YYYY-MM-DD}/{epochMs}_{displayId}.jpg
-- analyzed: 0=pending, 1=complete, 2=failed (max retries exceeded)

CREATE TABLE IF NOT EXISTS frames (
  id                    TEXT PRIMARY KEY,
  display_id            TEXT NOT NULL,
  captured_at           TEXT NOT NULL,        -- ISO 8601
  timestamp             REAL NOT NULL,        -- Unix epoch (seconds)
  image_path            TEXT NOT NULL,
  phash                 TEXT,                 -- hex string
  width                 INTEGER,
  height                INTEGER,
  analyzed              INTEGER DEFAULT 0,    -- 0=pending, 1=complete, 2=failed
  processing_lock_id    TEXT,
  processing_started_at TEXT,
  retry_count           INTEGER DEFAULT 0,
  failed_at             TEXT,
  created_at            TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_frames_analyzed   ON frames(analyzed);
CREATE INDEX IF NOT EXISTS idx_frames_captured   ON frames(timestamp);
CREATE INDEX IF NOT EXISTS idx_frames_processing ON frames(processing_lock_id);
