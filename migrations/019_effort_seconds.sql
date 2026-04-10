-- Effort seconds: true time spent on a thread.
-- For raw blocks: stores the block's own non-overlapping duration (same as duration column).
-- For compacted blocks: stores the sum of constituent raw block effort_seconds.
-- Contrast with duration (elapsed span = to_ts - from_ts).
ALTER TABLE topic_blocks ADD COLUMN effort_seconds REAL;
CREATE INDEX idx_topic_blocks_effort ON topic_blocks(effort_seconds) WHERE effort_seconds IS NOT NULL;
