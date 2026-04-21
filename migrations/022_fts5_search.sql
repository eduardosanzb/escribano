-- FTS5 full-text search index on observation VLM descriptions.
-- Uses Porter stemmer for English word stemming, unicode61 for accent folding,
-- and tokenchars for preserving identifiers with hyphens/dots/underscores.
CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
    vlm_description,
    content='observations',
    content_rowid='rowid',
    tokenize='porter unicode61 tokenchars ''_-.'' '
);

-- Backfill/rebuild: populate the FTS index from existing observations.
-- Using FTS5's rebuild command keeps this migration idempotent if the table
-- already exists (for example in a dev database from another branch).
INSERT INTO observations_fts(observations_fts) VALUES ('rebuild');

-- Keep FTS index in sync: INSERT trigger
CREATE TRIGGER IF NOT EXISTS observations_fts_insert AFTER INSERT ON observations
WHEN NEW.vlm_description IS NOT NULL
BEGIN
    INSERT INTO observations_fts(rowid, vlm_description)
    VALUES (NEW.rowid, NEW.vlm_description);
END;

-- Keep FTS index in sync: UPDATE triggers
CREATE TRIGGER IF NOT EXISTS observations_fts_update_delete AFTER UPDATE OF vlm_description ON observations
WHEN OLD.vlm_description IS NOT NULL
BEGIN
    INSERT INTO observations_fts(observations_fts, rowid, vlm_description)
    VALUES ('delete', OLD.rowid, OLD.vlm_description);
END;

CREATE TRIGGER IF NOT EXISTS observations_fts_update_insert AFTER UPDATE OF vlm_description ON observations
WHEN NEW.vlm_description IS NOT NULL
BEGIN
    INSERT INTO observations_fts(rowid, vlm_description)
    VALUES (NEW.rowid, NEW.vlm_description);
END;

-- Keep FTS index in sync: DELETE trigger
CREATE TRIGGER IF NOT EXISTS observations_fts_delete BEFORE DELETE ON observations
WHEN OLD.vlm_description IS NOT NULL
BEGIN
    INSERT INTO observations_fts(observations_fts, rowid, vlm_description)
    VALUES ('delete', OLD.rowid, OLD.vlm_description);
END;
