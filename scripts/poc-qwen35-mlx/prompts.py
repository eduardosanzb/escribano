"""
Real prompt builder using actual Escribano data.

Fetches TopicBlocks from the database and builds prompts using
the same templates as the production system.
"""

import sqlite3
import json
import pathlib
from typing import List, Dict, Any, Optional

DB_PATH = pathlib.Path.home() / ".escribano" / "escribano.db"
PROMPTS_DIR = pathlib.Path(__file__).parent.parent.parent / "prompts"


def get_db_connection():
    """Get SQLite connection to Escribano database."""
    if not DB_PATH.exists():
        raise FileNotFoundError(
            f"Escribano database not found at {DB_PATH}. "
            "Run escribano on a recording first."
        )
    return sqlite3.connect(str(DB_PATH))


def fetch_sample_topic_blocks(limit: int = 5) -> List[Dict[str, Any]]:
    """
    Fetch sample TopicBlocks from the database.
    
    Returns blocks with all fields needed for prompt building.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute(
        """
        SELECT id, recording_id, classification, duration
        FROM topic_blocks
        WHERE classification IS NOT NULL
        ORDER BY created_at DESC
        LIMIT ?
        """,
        (limit,),
    )
    
    rows = cursor.fetchall()
    conn.close()
    
    blocks = []
    for row in rows:
        block_id, recording_id, classification_json, duration = row
        classification = json.loads(classification_json) if classification_json else {}
        
        blocks.append({
            "id": block_id,
            "recording_id": recording_id,
            "start_time": classification.get("start_time", 0),
            "end_time": classification.get("end_time", 0),
            "duration": classification.get("duration", duration or 0),
            "activity_type": classification.get("activity_type", "other"),
            "key_description": classification.get("key_description", ""),
            "apps": classification.get("apps", []),
            "topics": classification.get("topics", []),
            "transcript_count": classification.get("transcript_count", 0),
            "has_transcript": classification.get("has_transcript", False),
            "combined_transcript": classification.get("combined_transcript", ""),
        })
    
    return blocks


def format_duration(seconds: float) -> str:
    """Format duration in human-readable form."""
    if seconds < 60:
        return f"{int(seconds)}s"
    minutes = int(seconds // 60)
    secs = int(seconds % 60)
    if minutes < 60:
        return f"{minutes}m {secs}s" if secs > 0 else f"{minutes}m"
    hours = minutes // 60
    mins = minutes % 60
    return f"{hours}h {mins}m" if mins > 0 else f"{hours}h"


def format_time(seconds: float) -> str:
    """Format timestamp as HH:MM:SS."""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def build_subject_grouping_prompt(blocks: List[Dict[str, Any]]) -> str:
    """
    Build subject grouping prompt using real template.
    
    Same logic as src/services/subject-grouping.ts buildGroupingPrompt()
    """
    # Build block descriptions
    block_descriptions = []
    for i, b in enumerate(blocks, 1):
        desc = f"""BLOCK {i}:
Time: {format_time(b['start_time'])} - {format_time(b['end_time'])} ({format_duration(b['duration'])})
Activity: {b['activity_type']}
Description: {b['key_description']}
Apps: {', '.join(b['apps']) or 'none'}
Topics: {', '.join(b['topics']) or 'none'}
ID: {b['id']}"""
        block_descriptions.append(desc)
    
    block_descriptions_text = "\n\n".join(block_descriptions)
    
    # Build example block IDs
    block_ids = [b['id'] for b in blocks]
    if len(block_ids) >= 2:
        example_ids = f'"{block_ids[0]}", "{block_ids[1]}"'
    else:
        example_ids = f'"{block_ids[0]}"' if block_ids else '""'
    
    # Read template
    template_path = PROMPTS_DIR / "subject-grouping.md"
    try:
        template = template_path.read_text()
    except FileNotFoundError:
        # Fallback inline template (same as TypeScript)
        template = """You are analyzing a work session that has been divided into {{BLOCK_COUNT}} segments (TopicBlocks).

Your task is to group these segments into 1-6 coherent SUBJECTS. A subject represents a distinct thread of work (e.g., "Escribano pipeline optimization", "Personal time", "Email and admin", "Research on competitors").

GROUPING RULES:
1. Group segments that belong to the same work thread, even if they're not consecutive in time
2. Personal activities (WhatsApp, Instagram, social media, personal calls) should be grouped into a "Personal" subject
3. Email/calendar/admin is only its own group when email IS the primary activity — not just because an email app was open in the background
4. Deep work on the same project/codebase should be grouped together
5. Research sessions should be grouped separately from coding sessions unless clearly related

RULE PRIORITY (when in doubt):
- Classify by primary ACTIVITY TYPE and project context, not by which apps happened to be open
- If all segments are about the same project, one group is correct — do not invent artificial splits

SEGMENTS TO GROUP:
{{BLOCK_DESCRIPTIONS}}

For each group, output ONE line in this EXACT format:
Group 1: label: [Descriptive subject name] | blockIds: [uuid1, uuid2, uuid3]

Example output:
Group 1: label: Escribano VLM Integration | blockIds: [{{EXAMPLE_BLOCK_IDS}}]

CRITICAL REQUIREMENTS:
- Each group MUST have "label" and "blockIds"
- Block IDs are the UUIDs shown in each BLOCK above (copy them exactly)
- Include ALL {{BLOCK_COUNT}} block IDs across all groups (every block must be assigned exactly once)
- Create 1-6 groups (one group is fine if all work is the same project)
- Use clear, descriptive labels for each subject
- Output ONLY the group lines — no explanation, no preamble, no markdown"""
    
    # Replace placeholders
    return (
        template
        .replace("{{BLOCK_COUNT}}", str(len(blocks)))
        .replace("{{BLOCK_DESCRIPTIONS}}", block_descriptions_text)
        .replace("{{EXAMPLE_BLOCK_IDS}}", example_ids)
    )


def build_card_prompt(blocks: List[Dict[str, Any]]) -> str:
    """
    Build card generation prompt using real template.
    
    Simplified version - just uses the blocks directly.
    """
    # Create synthetic subjects from blocks
    subjects_text = []
    for i, b in enumerate(blocks[:3], 1):  # Limit to 3 subjects
        subject = f"""## Subject {i}: {b['key_description'][:50]}
**{format_duration(b['duration'])}** | {b['activity_type']}

Block ID: {b['id']}
Apps: {', '.join(b['apps']) or 'none'}
Topics: {', '.join(b['topics']) or 'none'}"""
        subjects_text.append(subject)
    
    subjects_data = "\n\n".join(subjects_text)
    
    # Read template
    template_path = PROMPTS_DIR / "card.md"
    try:
        template = template_path.read_text()
    except FileNotFoundError:
        # Fallback
        template = """# Card Format

Generate a summary with subjects.

## Session Metadata
- **Duration:** {{SESSION_DURATION}}
- **Date:** {{SESSION_DATE}}
- **Subjects:** {{SUBJECT_COUNT}}

## Subjects

{{SUBJECTS_DATA}}"""
    
    total_duration = sum(b['duration'] for b in blocks)
    
    return (
        template
        .replace("{{SESSION_DURATION}}", format_duration(total_duration))
        .replace("{{SESSION_DATE}}", "2026-03-06")
        .replace("{{SUBJECT_COUNT}}", str(min(len(blocks), 3)))
        .replace("{{SUBJECTS_DATA}}", subjects_data)
    )


def validate_subject_grouping_output(output: str, block_ids: List[str]) -> bool:
    """Validate that all block IDs are present in output."""
    import re
    
    # Check for group lines
    pattern = r"Group \d+: label: .+ \| blockIds: \[.+\]"
    matches = re.findall(pattern, output)
    
    if len(matches) < 1:
        return False
    
    # Check all block IDs are present
    all_present = all(bid in output for bid in block_ids)
    
    return all_present


def validate_card_output(output: str) -> bool:
    """Validate card output has markdown structure."""
    return "##" in output and ("-" in output or "*" in output)


if __name__ == "__main__":
    # Test fetching data
    print("Fetching sample TopicBlocks from database...")
    blocks = fetch_sample_topic_blocks(limit=3)
    
    print(f"\nFound {len(blocks)} blocks:")
    for i, b in enumerate(blocks, 1):
        print(f"\n{i}. {b['key_description'][:60]}...")
        print(f"   Duration: {format_duration(b['duration'])}")
        print(f"   Activity: {b['activity_type']}")
        print(f"   Apps: {', '.join(b['apps'])}")
    
    print("\n" + "="*80)
    print("SUBJECT GROUPING PROMPT:")
    print("="*80)
    prompt = build_subject_grouping_prompt(blocks)
    print(prompt[:500] + "..." if len(prompt) > 500 else prompt)
