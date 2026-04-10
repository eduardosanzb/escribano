-- Replace full indexes with partial indexes for compacted_at and effort_seconds.
-- Partial indexes exclude NULL rows, which dominate for raw (Layer 1) blocks.
-- This reduces index size and speeds up queries that filter on compacted blocks.
DROP INDEX IF EXISTS idx_topic_blocks_compacted;
CREATE INDEX idx_topic_blocks_compacted ON topic_blocks(compacted_at) WHERE compacted_at IS NOT NULL;
DROP INDEX IF EXISTS idx_topic_blocks_effort;
CREATE INDEX idx_topic_blocks_effort ON topic_blocks(effort_seconds) WHERE effort_seconds IS NOT NULL;
