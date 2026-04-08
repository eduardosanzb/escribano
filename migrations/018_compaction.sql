-- Layer 2: Topic Block Compaction
-- Adds compacted_at timestamp to distinguish raw (Layer 1) blocks from compacted (Layer 2) blocks.
-- NULL = raw block from SessionAggregator; non-NULL = block has been processed by compaction.
ALTER TABLE topic_blocks ADD COLUMN compacted_at REAL;
CREATE INDEX idx_topic_blocks_compacted ON topic_blocks(compacted_at);
