-- Audio transcript FTS index for audio observations.
-- External-content FTS5 over observations.text for rows with type = 'audio'.
-- Uses the same Porter stemmer + tokenchars configuration as 022 so audio
-- transcripts and visual descriptions share tokenization semantics.
CREATE VIRTUAL TABLE IF NOT EXISTS observations_audio_fts USING fts5(
    text,
    content='observations',
    content_rowid='rowid',
    tokenize='porter unicode61 tokenchars ''_-.'' '
);

-- Backfill/rebuild: populate the index from pre-existing audio observations.
INSERT INTO observations_audio_fts(observations_audio_fts) VALUES ('rebuild');

-- Keep FTS index in sync: INSERT trigger (audio rows with nonblank text only)
CREATE TRIGGER IF NOT EXISTS observations_audio_fts_insert AFTER INSERT ON observations
WHEN NEW.type = 'audio' AND NEW.text IS NOT NULL AND trim(NEW.text) != ''
BEGIN
    INSERT INTO observations_audio_fts(rowid, text)
    VALUES (NEW.rowid, NEW.text);
END;

-- Keep FTS index in sync: UPDATE triggers
CREATE TRIGGER IF NOT EXISTS observations_audio_fts_update_delete AFTER UPDATE OF type, text ON observations
WHEN OLD.type = 'audio' AND OLD.text IS NOT NULL AND trim(OLD.text) != ''
BEGIN
    INSERT INTO observations_audio_fts(observations_audio_fts, rowid, text)
    VALUES ('delete', OLD.rowid, OLD.text);
END;

CREATE TRIGGER IF NOT EXISTS observations_audio_fts_update_insert AFTER UPDATE OF type, text ON observations
WHEN NEW.type = 'audio' AND NEW.text IS NOT NULL AND trim(NEW.text) != ''
BEGIN
    INSERT INTO observations_audio_fts(rowid, text)
    VALUES (NEW.rowid, NEW.text);
END;

-- Keep FTS index in sync: DELETE trigger
CREATE TRIGGER IF NOT EXISTS observations_audio_fts_delete BEFORE DELETE ON observations
WHEN OLD.type = 'audio' AND OLD.text IS NOT NULL AND trim(OLD.text) != ''
BEGIN
    INSERT INTO observations_audio_fts(observations_audio_fts, rowid, text)
    VALUES ('delete', OLD.rowid, OLD.text);
END;

-- Partial index for time-ranged audio queries.
CREATE INDEX IF NOT EXISTS idx_observations_audio_timestamp
    ON observations (timestamp)
    WHERE type = 'audio';

PRAGMA user_version = 25;
