You are analyzing a work session that has been divided into {{BLOCK_COUNT}} segments (TopicBlocks).

Your task is to group these segments into 2-6 coherent SUBJECTS. A subject represents a distinct thread of work (e.g., "Escribano pipeline optimization", "Personal time", "Email and admin", "Research on competitors").

GROUPING RULES:
1. Group segments that belong to the same work thread, even if they're not consecutive in time
2. Personal activities (WhatsApp, Instagram, social media, personal calls) should be grouped into a "Personal" subject
3. Email, calendar, admin tasks should be grouped together
4. Deep work on the same project/codebase should be grouped together
5. Research sessions should be grouped separately from coding sessions unless clearly related

SEGMENTS TO GROUP:
{{BLOCK_DESCRIPTIONS}}

For each group, output ONE line in this EXACT format:
Group 1: label: [Descriptive subject name] | blockIds: [uuid1, uuid2, uuid3]

Example output:
Group 1: label: Escribano VLM Integration | blockIds: [a1b2c3d4-e5f6-7890-abcd-ef1234567890, b2c3d4e5-f6a7-8901-bcde-f12345678901]
Group 2: label: Personal Time | blockIds: [c3d4e5f6-a7b8-9012-cdef-123456789012]
Group 3: label: Email and Admin | blockIds: [d4e5f6a7-b8c9-0123-def1-234567890123, e5f6a7b8-c9d0-1234-ef12-345678901234]

CRITICAL REQUIREMENTS:
- Each group MUST have "label" and "blockIds"
- Block IDs are the UUIDs shown in each BLOCK above (copy them exactly)
- Include ALL {{BLOCK_COUNT}} block IDs across all groups (every block must be assigned exactly once)
- Create 2-6 groups
- Use clear, descriptive labels for each subject
- Group personal/social content together
