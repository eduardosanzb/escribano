-- Migration 010: Add LLM backend tracking to existing runs
-- 
-- Marks all existing runs as having used Ollama backend (before MLX-LM migration).
-- This allows benchmarking comparisons between backends.

-- Update existing runs to set llm_backend in metadata
-- Use JSON functions so nested metadata objects are preserved
UPDATE processing_runs 
SET metadata = CASE 
  WHEN metadata IS NULL THEN '{"llm_backend":"ollama"}'
  WHEN metadata LIKE '%"llm_backend"%' THEN metadata  -- Already set, don't override
  WHEN metadata = '{}' THEN json_set(metadata, '$.llm_backend', 'ollama')
  WHEN json_valid(metadata) THEN json_set(metadata, '$.llm_backend', 'ollama')
  ELSE metadata
END
WHERE status IN ('completed', 'failed');

-- For running/other statuses that may be stale, also update them
UPDATE processing_runs 
SET metadata = CASE 
  WHEN metadata IS NULL THEN '{"llm_backend":"ollama"}'
  WHEN metadata LIKE '%"llm_backend"%' THEN metadata
  WHEN metadata = '{}' THEN json_set(metadata, '$.llm_backend', 'ollama')
  WHEN json_valid(metadata) THEN json_set(metadata, '$.llm_backend', 'ollama')
  ELSE metadata
END
WHERE metadata IS NULL OR metadata NOT LIKE '%"llm_backend"%';
