-- ============================================================================
-- CLUSTERS
-- ============================================================================
CREATE TABLE clusters (
  id TEXT PRIMARY KEY,                    -- UUIDv7
  recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                     -- 'visual' | 'audio'
  start_timestamp REAL NOT NULL,
  end_timestamp REAL NOT NULL,
  observation_count INTEGER NOT NULL,
  centroid BLOB,                          -- Average embedding (for similarity)
  classification TEXT,                    -- JSON: {"topics": [...], "apps": [...], "projects": [...], "urls": [...]}
  metadata TEXT,                          -- JSON: extra debug info
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_clusters_recording ON clusters(recording_id);
CREATE INDEX idx_clusters_type ON clusters(recording_id, type);

-- ============================================================================
-- OBSERVATION_CLUSTERS (Join Table)
-- ============================================================================
CREATE TABLE observation_clusters (
  observation_id TEXT NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  cluster_id TEXT NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  distance REAL,                          -- Distance from centroid (0 = perfect match)
  PRIMARY KEY (observation_id, cluster_id)
);

CREATE INDEX idx_obs_cluster_cluster ON observation_clusters(cluster_id);

-- ============================================================================
-- CLUSTER_MERGES (Track audio-visual merges)
-- ============================================================================
CREATE TABLE cluster_merges (
  visual_cluster_id TEXT NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  audio_cluster_id TEXT NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  similarity_score REAL NOT NULL,         -- Classification similarity (0-1)
  merge_reason TEXT,                      -- 'shared_topic' | 'shared_app' | 'centroid_similarity'
  PRIMARY KEY (visual_cluster_id, audio_cluster_id)
);
