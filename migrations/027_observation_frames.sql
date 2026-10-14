-- Windowed-observation links: additive link table mapping an observation to the
-- ordered sequence of frames it was derived from (a window).
--
-- Additive only: this migration does not rewrite historical rows, does not touch
-- `frames.observation_id`, and does not alter any existing table, index, FTS
-- table or trigger. Existing single-frame observations simply have no link rows.
--
-- The Swift recorder discovers this file by numeric sort via MigrationRunner,
-- which owns the surrounding transaction (`_schema_version` insert included);
-- this file therefore contains no BEGIN/COMMIT.

CREATE TABLE IF NOT EXISTS observation_frames (
    observation_id TEXT NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
    frame_id TEXT NOT NULL REFERENCES frames(id) ON DELETE RESTRICT,
    position INTEGER NOT NULL CHECK(position >= 0),
    PRIMARY KEY(observation_id, position),
    UNIQUE(observation_id, frame_id)
);

-- Reverse lookup: which observations reference a given frame.
CREATE INDEX IF NOT EXISTS idx_observation_frames_frame ON observation_frames(frame_id);

PRAGMA user_version = 27;
