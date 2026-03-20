-- Phase 3a: Session Aggregation Schema
-- Adds support for continuous TopicBlock generation by the recorder daemon

-- Link observations to their TopicBlock
ALTER TABLE observations ADD COLUMN tb_id TEXT REFERENCES topic_blocks(id) ON DELETE SET NULL;
CREATE INDEX idx_observations_tb ON observations(tb_id);

-- Time-range columns on topic_blocks
ALTER TABLE topic_blocks ADD COLUMN from_ts REAL;
ALTER TABLE topic_blocks ADD COLUMN to_ts REAL;
ALTER TABLE topic_blocks ADD COLUMN observation_count INTEGER DEFAULT 0;

-- Index for time-range queries
CREATE INDEX idx_topic_blocks_time_range ON topic_blocks(from_ts, to_ts);

-- Sentinel recording for recorder-generated TopicBlocks.
-- The topic_blocks table has recording_id NOT NULL, so we use this sentinel
-- instead of recreating the table. Batch pipeline recordings are unaffected.
INSERT OR IGNORE INTO recordings (
    id, video_path, audio_mic_path, audio_system_path,
    duration, captured_at, status, processing_step,
    source_type, source_metadata, error_message
) VALUES (
    '__recorder__', NULL, NULL, NULL,
    0, datetime('now'), 'processed', 'complete',
    'raw', '{"type":"recorder_sentinel"}', NULL
);
