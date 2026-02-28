-- Migration 007: Add subjects and subject_topic_blocks tables
-- Subjects are per-recording groupings of TopicBlocks into coherent work threads

CREATE TABLE IF NOT EXISTS subjects (
  id TEXT PRIMARY KEY,
  recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  is_personal INTEGER DEFAULT 0,
  duration REAL DEFAULT 0,
  activity_breakdown TEXT,
  metadata TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subject_topic_blocks (
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  topic_block_id TEXT NOT NULL REFERENCES topic_blocks(id) ON DELETE CASCADE,
  PRIMARY KEY (subject_id, topic_block_id)
);

CREATE INDEX IF NOT EXISTS idx_subjects_recording ON subjects(recording_id);
CREATE INDEX IF NOT EXISTS idx_subject_topic_blocks_subject ON subject_topic_blocks(subject_id);
CREATE INDEX IF NOT EXISTS idx_subject_topic_blocks_block ON subject_topic_blocks(topic_block_id);
