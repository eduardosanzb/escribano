-- Migration 012: Rebuild llm_debug_log with prompt/result columns
-- Drops and recreates the table to add first-class prompt + result columns.
-- Safe: this table only contains debug data.

DROP TABLE IF EXISTS llm_debug_log;

CREATE TABLE IF NOT EXISTS llm_debug_log (
  id TEXT PRIMARY KEY,
  recording_id TEXT,
  artifact_id TEXT,
  call_type TEXT NOT NULL,
  prompt TEXT,
  result TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  metadata TEXT NOT NULL
);

CREATE INDEX idx_llm_debug_log_recording ON llm_debug_log(recording_id);
CREATE INDEX idx_llm_debug_log_call_type ON llm_debug_log(call_type);
CREATE INDEX idx_llm_debug_log_created ON llm_debug_log(created_at);
