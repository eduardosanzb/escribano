-- Migration 011: LLM Debug Log Table
-- Stores raw LLM inputs/outputs for debugging thinking leakage

CREATE TABLE IF NOT EXISTS llm_debug_log (
  id TEXT PRIMARY KEY,
  recording_id TEXT,
  artifact_id TEXT,
  call_type TEXT NOT NULL,        -- 'subject_grouping' | 'artifact_generation'
  prompt TEXT,                    -- raw user prompt (before apply_chat_template)
  result TEXT,                    -- final processed response returned to caller
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  -- Everything else as JSON (model, tokens, timing, raw_response diff, etc.)
  metadata TEXT NOT NULL
);

CREATE INDEX idx_llm_debug_log_recording ON llm_debug_log(recording_id);
CREATE INDEX idx_llm_debug_log_call_type ON llm_debug_log(call_type);
CREATE INDEX idx_llm_debug_log_created ON llm_debug_log(created_at);