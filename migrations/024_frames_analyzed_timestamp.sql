-- Composite index for claimFrames: covers both the WHERE filter (analyzed=0)
-- and the ORDER BY (timestamp ASC), eliminating the temp B-tree sort.
CREATE INDEX IF NOT EXISTS idx_frames_analyzed_timestamp ON frames(analyzed, timestamp);

PRAGMA user_version = 24;
