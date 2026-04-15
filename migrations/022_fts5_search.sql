-- FTS5 full-text search index on observation VLM descriptions.
-- Uses Porter stemmer for English word stemming, unicode61 for accent folding,
-- tokenchars for preserving identifiers with hyphens/dots/underscores,
-- and prefix indexing for fast prefix queries.
CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
    vlm_description,
    content='observations',
    content_rowid='rowid',
    tokenize='porter unicode61 tokenchars ''_-.'' '
);

-- Backfill: index all existing observations that have a VLM description.
INSERT INTO observations_fts(rowid, vlm_description)
SELECT rowid, vlm_description FROM observations WHERE vlm_description IS NOT NULL;

-- Keep FTS index in sync: INSERT trigger
CREATE TRIGGER IF NOT EXISTS observations_fts_insert AFTER INSERT ON observations
WHEN NEW.vlm_description IS NOT NULL
BEGIN
    INSERT INTO observations_fts(rowid, vlm_description)
    VALUES (NEW.rowid, NEW.vlm_description);
END;

-- Keep FTS index in sync: UPDATE trigger
CREATE TRIGGER IF NOT EXISTS observations_fts_update AFTER UPDATE OF vlm_description ON observations
WHEN NEW.vlm_description IS NOT NULL
BEGIN
    INSERT INTO observations_fts(observations_fts, rowid, vlm_description)
    VALUES ('delete', OLD.rowid, OLD.vlm_description);
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
