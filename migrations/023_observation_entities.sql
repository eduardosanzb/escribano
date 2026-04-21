-- Entity enrichment table: stores named entities extracted from observations via GLiNER.
-- Each row links an entity (kind + value + confidence) to a specific observation.
-- UNIQUE constraint on (observation_id, entity_kind, entity_value) prevents duplicates from re-analysis.
CREATE TABLE IF NOT EXISTS observation_entities (
    entity_id TEXT PRIMARY KEY,
    observation_id TEXT NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
    entity_kind TEXT NOT NULL,
    entity_value TEXT NOT NULL,
    confidence REAL NOT NULL,
    created_at REAL NOT NULL,
    UNIQUE(observation_id, entity_kind, entity_value)
);

-- Index for FK lookups (joining entities to their parent observation)
CREATE INDEX IF NOT EXISTS idx_observation_entities_obs_id ON observation_entities(observation_id);

-- Index for kind filtering (e.g. WHERE entity_kind = 'software_tool')
CREATE INDEX IF NOT EXISTS idx_observation_entities_kind ON observation_entities(entity_kind);

-- FTS5 virtual table for full-text search on entity values.
-- Uses Porter stemmer for English word stemming, unicode61 for accent folding,
-- and tokenchars for preserving identifiers with hyphens/dots/underscores.
CREATE VIRTUAL TABLE IF NOT EXISTS observation_entities_fts USING fts5(
    entity_value,
    content='observation_entities',
    content_rowid='rowid',
    tokenize='porter unicode61 tokenchars ''_-.'' '
);

-- Backfill/rebuild: populate the FTS index from existing observation_entities.
-- Using FTS5's rebuild command keeps this migration idempotent if the table
-- already exists (for example in a dev database from another branch).
INSERT INTO observation_entities_fts(observation_entities_fts) VALUES ('rebuild');

-- Keep FTS index in sync: INSERT trigger
CREATE TRIGGER IF NOT EXISTS observation_entities_fts_insert AFTER INSERT ON observation_entities
WHEN NEW.entity_value IS NOT NULL
BEGIN
    INSERT INTO observation_entities_fts(rowid, entity_value)
    VALUES (NEW.rowid, NEW.entity_value);
END;

-- Keep FTS index in sync: UPDATE triggers
CREATE TRIGGER IF NOT EXISTS observation_entities_fts_update_delete AFTER UPDATE OF entity_value ON observation_entities
WHEN OLD.entity_value IS NOT NULL
BEGIN
    INSERT INTO observation_entities_fts(observation_entities_fts, rowid, entity_value)
    VALUES ('delete', OLD.rowid, OLD.entity_value);
END;

CREATE TRIGGER IF NOT EXISTS observation_entities_fts_update_insert AFTER UPDATE OF entity_value ON observation_entities
WHEN NEW.entity_value IS NOT NULL
BEGIN
    INSERT INTO observation_entities_fts(rowid, entity_value)
    VALUES (NEW.rowid, NEW.entity_value);
END;

-- Keep FTS index in sync: DELETE trigger
CREATE TRIGGER IF NOT EXISTS observation_entities_fts_delete BEFORE DELETE ON observation_entities
WHEN OLD.entity_value IS NOT NULL
BEGIN
    INSERT INTO observation_entities_fts(observation_entities_fts, rowid, entity_value)
    VALUES ('delete', OLD.rowid, OLD.entity_value);
END;

PRAGMA user_version = 23;
