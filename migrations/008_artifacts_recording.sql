-- Migration 008: Add recording_id to artifacts table
-- Enables 1:N relationship between recordings and their artifacts

ALTER TABLE artifacts ADD COLUMN recording_id TEXT REFERENCES recordings(id) ON DELETE CASCADE;

CREATE INDEX idx_artifacts_recording ON artifacts(recording_id);
