-- Migration 009: Link artifacts to subjects
-- Allows queries like "which subjects made this artifact" for dashboard and analysis

CREATE TABLE artifact_subjects (
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  subject_id  TEXT NOT NULL REFERENCES subjects(id)  ON DELETE CASCADE,
  PRIMARY KEY (artifact_id, subject_id)
);

CREATE INDEX idx_artifact_subjects_subject ON artifact_subjects(subject_id);
