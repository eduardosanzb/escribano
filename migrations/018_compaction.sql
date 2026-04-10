-- Layer 2: Topic Block Compaction
-- Adds compacted_at to distinguish raw (Layer 1) blocks from compacted (Layer 2) blocks.
-- Stored as a REAL Unix epoch timestamp in seconds (fractional seconds allowed for sub-second precision).
-- NULL = raw block from SessionAggregator; non-NULL = block has been processed by compaction.
ALTER TABLE topic_blocks ADD COLUMN compacted_at REAL;
CREATE INDEX idx_topic_blocks_compacted ON topic_blocks(compacted_at) WHERE compacted_at IS NOT NULL;
