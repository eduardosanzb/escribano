-- ============================================================================
-- Migration: 003_observations_vlm_fields
-- Description: Add VLM-specific fields for activity_type, apps, and topics
--              Per ADR-005 VLM-First Visual Pipeline
-- ============================================================================

-- Add activity_type column (per ADR-005 activity types)
ALTER TABLE observations ADD COLUMN activity_type TEXT;

-- Add apps column (JSON array of application names)
ALTER TABLE observations ADD COLUMN apps TEXT;

-- Add topics column (JSON array of topic/project names)
ALTER TABLE observations ADD COLUMN topics TEXT;
