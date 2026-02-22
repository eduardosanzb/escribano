"""Database utilities for fetching frames from SQLite."""

import sqlite3
import json
from pathlib import Path
from typing import List, Dict, Any


def get_frames(db_path: str, limit: int) -> List[Dict[str, Any]]:
    """
    Fetch frames with existing VLM descriptions from DB.
    
    Returns list of dicts with:
    - id
    - timestamp
    - frame_path (image_path)
    - ollama_description (vlm_description)
    - activity_type
    - apps (parsed list)
    - topics (parsed list)
    """
    db_path_str = str(Path(db_path).expanduser())
    
    query = """
    SELECT 
        o.id,
        o.timestamp,
        o.image_path as frame_path,
        o.vlm_description as ollama_description,
        o.activity_type,
        o.apps,
        o.topics
    FROM observations o
    WHERE o.type = 'visual'
      AND o.vlm_description IS NOT NULL
      AND o.vlm_description != ''
      AND o.image_path IS NOT NULL
      AND NOT o.vlm_description LIKE 'No description%'
      AND NOT o.vlm_description LIKE 'Parse error%'
    ORDER BY o.timestamp
    LIMIT ?
    """
    
    with sqlite3.connect(db_path_str) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(query, (limit,)).fetchall()
    
    frames = []
    for row in rows:
        frame = dict(row)
        # Parse JSON arrays
        try:
            frame['apps'] = json.loads(frame['apps']) if frame['apps'] else []
        except (json.JSONDecodeError, TypeError):
            frame['apps'] = []
        
        try:
            frame['topics'] = json.loads(frame['topics']) if frame['topics'] else []
        except (json.JSONDecodeError, TypeError):
            frame['topics'] = []
        
        frames.append(frame)
    
    return frames


def get_latest_recording_id(db_path: str) -> str | None:
    """Get the most recent recording ID."""
    db_path_str = str(Path(db_path).expanduser())
    
    with sqlite3.connect(db_path_str) as conn:
        cursor = conn.execute(
            "SELECT id FROM recordings ORDER BY captured_at DESC LIMIT 1"
        )
        row = cursor.fetchone()
        return row[0] if row else None
