-- Effort seconds: true time spent on a thread (sum of constituent raw block durations). NULL for raw blocks, populated for compacted blocks. Contrast with duration (elapsed span = to_ts - from_ts).

ALTER TABLE topic_blocks ADD COLUMN effort_seconds REAL;

CREATE INDEX idx_topic_blocks_effort ON topic_blocks(effort_seconds);
