CREATE TABLE processing_runs (
  id TEXT PRIMARY KEY,
  recording_id TEXT NOT NULL REFERENCES recordings(id),
  run_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  started_at TEXT NOT NULL,
  completed_at TEXT,
  total_duration_ms INTEGER,
  error_message TEXT,
  metadata TEXT
);

CREATE TABLE processing_stats (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES processing_runs(id) ON DELETE CASCADE,
  phase TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_ms INTEGER,
  items_total INTEGER,
  items_processed INTEGER,
  metadata TEXT
);

CREATE INDEX idx_processing_runs_recording ON processing_runs(recording_id);
CREATE INDEX idx_processing_runs_status ON processing_runs(status);
CREATE INDEX idx_processing_stats_run ON processing_stats(run_id);
CREATE INDEX idx_processing_stats_phase ON processing_stats(phase);
