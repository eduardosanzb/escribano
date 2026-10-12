-- Search tokenizer fix: drop `tokenchars` from all three FTS5 indexes.
-- The shared tokenizer becomes `porter unicode61` (no tokenchars) so that
-- identifiers are tokenized the same way everywhere and punctuation is not
-- glued onto terms (e.g. "Thanks, take care." now indexes `care`, not `care.`).
--
-- All three FTS tables are dropped and recreated explicitly so the new
-- tokenizer spec takes effect on the live index, and every sync trigger is
-- recreated (DROP + CREATE) to heal drift against the 022/023/025 shape.
-- The table definitions are byte-identical to 022/023/025 apart from the
-- tokenize clause. Run inside the migration runner's single transaction: this
-- file contains no BEGIN/COMMIT.

-- Drop FTS sync triggers first (they reference the FTS tables).
DROP TRIGGER IF EXISTS observations_fts_insert;
DROP TRIGGER IF EXISTS observations_fts_update_delete;
DROP TRIGGER IF EXISTS observations_fts_update_insert;
DROP TRIGGER IF EXISTS observations_fts_delete;

DROP TRIGGER IF EXISTS observation_entities_fts_insert;
DROP TRIGGER IF EXISTS observation_entities_fts_update_delete;
DROP TRIGGER IF EXISTS observation_entities_fts_update_insert;
DROP TRIGGER IF EXISTS observation_entities_fts_delete;

DROP TRIGGER IF EXISTS observations_audio_fts_insert;
DROP TRIGGER IF EXISTS observations_audio_fts_update_delete;
DROP TRIGGER IF EXISTS observations_audio_fts_update_insert;
DROP TRIGGER IF EXISTS observations_audio_fts_delete;

-- Drop the FTS tables (and their shadow tables) before recreating.
DROP TABLE IF EXISTS observations_fts;
DROP TABLE IF EXISTS observation_entities_fts;
DROP TABLE IF EXISTS observations_audio_fts;

-- FTS5 full-text search index on observation VLM descriptions.
-- Porter stemmer for English word stemming, unicode61 for accent folding.
CREATE VIRTUAL TABLE observations_fts USING fts5(
    vlm_description,
    content='observations',
    content_rowid='rowid',
    tokenize='porter unicode61'
);

-- FTS5 full-text search index on entity values.
-- Porter stemmer for English word stemming, unicode61 for accent folding.
CREATE VIRTUAL TABLE observation_entities_fts USING fts5(
    entity_value,
    content='observation_entities',
    content_rowid='rowid',
    tokenize='porter unicode61'
);

-- Audio transcript FTS index for audio observations.
-- External-content FTS5 over observations.text for rows with type = 'audio'.
-- Same Porter stemmer + unicode61 configuration as the other two indexes.
CREATE VIRTUAL TABLE observations_audio_fts USING fts5(
    text,
    content='observations',
    content_rowid='rowid',
    tokenize='porter unicode61'
);

-- Keep FTS index in sync: observations_fts INSERT trigger
CREATE TRIGGER observations_fts_insert AFTER INSERT ON observations
WHEN NEW.vlm_description IS NOT NULL
BEGIN
    INSERT INTO observations_fts(rowid, vlm_description)
    VALUES (NEW.rowid, NEW.vlm_description);
END;

-- Keep FTS index in sync: observations_fts UPDATE triggers
CREATE TRIGGER observations_fts_update_delete AFTER UPDATE OF vlm_description ON observations
WHEN OLD.vlm_description IS NOT NULL
BEGIN
    INSERT INTO observations_fts(observations_fts, rowid, vlm_description)
    VALUES ('delete', OLD.rowid, OLD.vlm_description);
END;

CREATE TRIGGER observations_fts_update_insert AFTER UPDATE OF vlm_description ON observations
WHEN NEW.vlm_description IS NOT NULL
BEGIN
    INSERT INTO observations_fts(rowid, vlm_description)
    VALUES (NEW.rowid, NEW.vlm_description);
END;

-- Keep FTS index in sync: observations_fts DELETE trigger
CREATE TRIGGER observations_fts_delete BEFORE DELETE ON observations
WHEN OLD.vlm_description IS NOT NULL
BEGIN
    INSERT INTO observations_fts(observations_fts, rowid, vlm_description)
    VALUES ('delete', OLD.rowid, OLD.vlm_description);
END;

-- Keep FTS index in sync: observation_entities_fts INSERT trigger
CREATE TRIGGER observation_entities_fts_insert AFTER INSERT ON observation_entities
WHEN NEW.entity_value IS NOT NULL
BEGIN
    INSERT INTO observation_entities_fts(rowid, entity_value)
    VALUES (NEW.rowid, NEW.entity_value);
END;

-- Keep FTS index in sync: observation_entities_fts UPDATE triggers
CREATE TRIGGER observation_entities_fts_update_delete AFTER UPDATE OF entity_value ON observation_entities
WHEN OLD.entity_value IS NOT NULL
BEGIN
    INSERT INTO observation_entities_fts(observation_entities_fts, rowid, entity_value)
    VALUES ('delete', OLD.rowid, OLD.entity_value);
END;

CREATE TRIGGER observation_entities_fts_update_insert AFTER UPDATE OF entity_value ON observation_entities
WHEN NEW.entity_value IS NOT NULL
BEGIN
    INSERT INTO observation_entities_fts(rowid, entity_value)
    VALUES (NEW.rowid, NEW.entity_value);
END;

-- Keep FTS index in sync: observation_entities_fts DELETE trigger
CREATE TRIGGER observation_entities_fts_delete BEFORE DELETE ON observation_entities
WHEN OLD.entity_value IS NOT NULL
BEGIN
    INSERT INTO observation_entities_fts(observation_entities_fts, rowid, entity_value)
    VALUES ('delete', OLD.rowid, OLD.entity_value);
END;

-- Keep FTS index in sync: observations_audio_fts INSERT trigger (audio rows with nonblank text only)
CREATE TRIGGER observations_audio_fts_insert AFTER INSERT ON observations
WHEN NEW.type = 'audio' AND NEW.text IS NOT NULL AND trim(NEW.text) != ''
BEGIN
    INSERT INTO observations_audio_fts(rowid, text)
    VALUES (NEW.rowid, NEW.text);
END;

-- Keep FTS index in sync: observations_audio_fts UPDATE triggers
CREATE TRIGGER observations_audio_fts_update_delete AFTER UPDATE OF type, text ON observations
WHEN OLD.type = 'audio' AND OLD.text IS NOT NULL AND trim(OLD.text) != ''
BEGIN
    INSERT INTO observations_audio_fts(observations_audio_fts, rowid, text)
    VALUES ('delete', OLD.rowid, OLD.text);
END;

CREATE TRIGGER observations_audio_fts_update_insert AFTER UPDATE OF type, text ON observations
WHEN NEW.type = 'audio' AND NEW.text IS NOT NULL AND trim(NEW.text) != ''
BEGIN
    INSERT INTO observations_audio_fts(rowid, text)
    VALUES (NEW.rowid, NEW.text);
END;

-- Keep FTS index in sync: observations_audio_fts DELETE trigger
CREATE TRIGGER observations_audio_fts_delete BEFORE DELETE ON observations
WHEN OLD.type = 'audio' AND OLD.text IS NOT NULL AND trim(OLD.text) != ''
BEGIN
    INSERT INTO observations_audio_fts(observations_audio_fts, rowid, text)
    VALUES ('delete', OLD.rowid, OLD.text);
END;

-- Backfill/rebuild: repopulate every index from external content under the new tokenizer.
INSERT INTO observations_fts(observations_fts) VALUES ('rebuild');
INSERT INTO observation_entities_fts(observation_entities_fts) VALUES ('rebuild');
INSERT INTO observations_audio_fts(observations_audio_fts) VALUES ('rebuild');

PRAGMA user_version = 26;
