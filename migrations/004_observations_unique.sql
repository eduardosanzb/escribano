-- ============================================================================
-- Migration: 004_observations_unique
-- Description: Add unique index on observations to prevent duplicate entries
--              Cleans up existing duplicates before adding index
-- ============================================================================

-- Step 1: Delete duplicate observations (keep oldest by id per unique combo)
DELETE FROM observations
WHERE id NOT IN (
  SELECT MIN(id)
  FROM observations
  GROUP BY recording_id, type, timestamp, audio_source
);

-- Step 2: Add unique index for audio observations only
-- (visual observations can have different data at same timestamp)
CREATE UNIQUE INDEX idx_obs_audio_unique ON observations(recording_id, type, timestamp, audio_source)
WHERE type = 'audio';

-- Step 3: Update schema version
INSERT OR IGNORE INTO _schema_version (version) VALUES (4);
