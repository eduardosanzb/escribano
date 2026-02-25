-- ============================================================================
-- Migration: 006_vlm_raw_response
-- Description: Store raw VLM response when parsing fails for debugging
-- ============================================================================

ALTER TABLE observations ADD COLUMN vlm_raw_response TEXT;
