-- Cleanup script: Wipe all recorder-generated TopicBlocks and unclaim observations
-- Run with: sqlite3 ~/.escribano/escribano.db < scripts/cleanup-recorder-tbs.sql
--
-- Why: SessionAggregator bug caused garbage TopicBlocks to be created before the
-- Python bridge was ready. All observations were claimed into fallback TBs with
-- no semantic LLM grouping. This script resets the data so SA can reprocess properly.
--
-- Safe to run multiple times (idempotent).

.headers on
.mode column

SELECT '=== BEFORE CLEANUP ===' AS status;
SELECT COUNT(*) AS recorder_tbs FROM topic_blocks WHERE recording_id = '__recorder__';
SELECT COUNT(*) AS claimed_obs FROM observations WHERE tb_id IS NOT NULL AND frame_id IS NOT NULL;
SELECT COUNT(*) AS unclaimed_obs FROM observations WHERE tb_id IS NULL AND frame_id IS NOT NULL;

BEGIN TRANSACTION;

-- Step 1: Unclaim observations linked to recorder TBs
UPDATE observations
SET tb_id = NULL
WHERE tb_id IN (SELECT id FROM topic_blocks WHERE recording_id = '__recorder__');

-- Step 2: Delete all recorder TBs
DELETE FROM topic_blocks WHERE recording_id = '__recorder__';

COMMIT;

SELECT '=== AFTER CLEANUP ===' AS status;
SELECT COUNT(*) AS recorder_tbs FROM topic_blocks WHERE recording_id = '__recorder__';
SELECT COUNT(*) AS claimed_obs FROM observations WHERE tb_id IS NOT NULL AND frame_id IS NOT NULL;
SELECT COUNT(*) AS unclaimed_obs FROM observations WHERE tb_id IS NULL AND frame_id IS NOT NULL;

SELECT 'Cleanup complete. Restart recorder to reprocess observations.' AS message;
