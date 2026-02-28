You are analyzing a work session that has been divided into {{BLOCK_COUNT}} segments (TopicBlocks).

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
- Output ONLY the group lines — no explanation, no preamble, no markdown
