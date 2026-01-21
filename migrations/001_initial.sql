-- ============================================================================
-- RECORDINGS
-- ============================================================================
CREATE TABLE recordings (
  id TEXT PRIMARY KEY,
  video_path TEXT,
  audio_mic_path TEXT,
  audio_system_path TEXT,
  duration REAL NOT NULL,
  captured_at TEXT NOT NULL,           -- ISO8601
  status TEXT NOT NULL DEFAULT 'raw',  -- raw, processing, processed, error
  processing_step TEXT,                -- extraction, clustering, context_derivation, block_formation, complete
  source_type TEXT NOT NULL,           -- cap, meetily, raw
  source_metadata TEXT,                -- JSON
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_recordings_status ON recordings(status);
CREATE INDEX idx_recordings_captured_at ON recordings(captured_at);

-- ============================================================================
-- OBSERVATIONS
-- ============================================================================
CREATE TABLE observations (
  id TEXT PRIMARY KEY,                 -- UUIDv7
  recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                  -- visual, audio
  timestamp REAL NOT NULL,             -- seconds from start
  end_timestamp REAL,                  -- for audio segments
  -- Visual fields
  image_path TEXT,
  ocr_text TEXT,
  vlm_description TEXT,
  -- Audio fields
  text TEXT,
  audio_source TEXT,                   -- mic, system
  audio_type TEXT,                     -- speech, music, silence
  -- Embedding
  embedding BLOB,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_obs_recording_type ON observations(recording_id, type);
CREATE INDEX idx_obs_recording_time ON observations(recording_id, timestamp);

-- ============================================================================
-- CONTEXTS
-- ============================================================================
CREATE TABLE contexts (
  id TEXT PRIMARY KEY,                 -- UUIDv7
  type TEXT NOT NULL,                  -- project, app, url, topic, etc.
  name TEXT NOT NULL,
  metadata TEXT,                       -- JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_context_type_name ON contexts(type, name);

-- ============================================================================
-- OBSERVATION_CONTEXTS (Join Table)
-- ============================================================================
CREATE TABLE observation_contexts (
  observation_id TEXT NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  context_id TEXT NOT NULL REFERENCES contexts(id) ON DELETE CASCADE,
  confidence REAL DEFAULT 1.0,
  PRIMARY KEY (observation_id, context_id)
);

CREATE INDEX idx_obs_ctx_context ON observation_contexts(context_id);

-- ============================================================================
-- TOPIC_BLOCKS
-- ============================================================================
CREATE TABLE topic_blocks (
  id TEXT PRIMARY KEY,                 -- UUIDv7
  recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  context_ids TEXT NOT NULL,           -- JSON array of context IDs
  classification TEXT,                 -- JSON: { meeting: 85, debugging: 10, ... }
  duration REAL,                       -- total duration in seconds
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_topic_blocks_recording ON topic_blocks(recording_id);

-- ============================================================================
-- ARTIFACTS
-- ============================================================================
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,                 -- UUIDv7
  type TEXT NOT NULL,                  -- summary, action-items, runbook, etc.
  content TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'markdown',
  source_block_ids TEXT,               -- JSON array (single recording)
  source_context_ids TEXT,             -- JSON array (cross-recording)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_artifacts_type ON artifacts(type);

-- ============================================================================
-- SCHEMA VERSION (for migrations)
-- ============================================================================
CREATE TABLE _schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
