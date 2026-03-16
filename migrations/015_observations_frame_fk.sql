-- ============================================================================
-- Migration 015: Frame Analysis Integration
-- ============================================================================
-- Adds foreign key for the recorder pipeline (observations linked to frames).
-- Note: process_locks table not needed — VLM analysis now in-process (ADR-010).

-- 1. Create a temporary table with the desired schema
CREATE TABLE observations_new (
  id TEXT PRIMARY KEY,                 -- UUIDv7
  recording_id TEXT REFERENCES recordings(id) ON DELETE CASCADE, -- NULLABLE
  frame_id TEXT REFERENCES frames(id), -- New field
  type TEXT NOT NULL,                  -- visual, audio
  timestamp REAL NOT NULL,             -- seconds from start
  end_timestamp REAL,                  -- for audio segments
  image_path TEXT,
  ocr_text TEXT,
  vlm_description TEXT,
  vlm_raw_response TEXT,
  activity_type TEXT,
  apps TEXT,
  topics TEXT,
  text TEXT,
  audio_source TEXT,                   -- mic, system
  audio_type TEXT,                     -- speech, music, silence
  embedding BLOB,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. Copy data from the old table to the new one
INSERT INTO observations_new (
  id, recording_id, type, timestamp, end_timestamp, image_path, ocr_text, 
  vlm_description, text, audio_source, audio_type, embedding, created_at
)
SELECT 
  id, recording_id, type, timestamp, end_timestamp, image_path, ocr_text, 
  vlm_description, text, audio_source, audio_type, embedding, created_at
FROM observations;

-- 3. Drop the old table and rename the new one
DROP TABLE observations;
ALTER TABLE observations_new RENAME TO observations;

-- 4. Recreate indices
CREATE INDEX idx_obs_recording_type ON observations(recording_id, type);
CREATE INDEX idx_obs_recording_time ON observations(recording_id, timestamp);
CREATE INDEX idx_observations_frame ON observations(frame_id);
CREATE UNIQUE INDEX idx_obs_audio_unique ON observations(recording_id, type, timestamp, audio_source)
WHERE type = 'audio' AND recording_id IS NOT NULL;
