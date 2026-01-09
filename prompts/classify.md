# Session Classification

Output ONLY JSON scores (0-100) for each session type.

## Session Types:

**meeting** - Conversations, interviews, discussions
Examples: Team meetings, client calls, 1-on-1s, planning sessions
Look for: Multiple speakers, Q&A format, decisions being made

**debugging** - Fixing errors and troubleshooting  
Examples: Finding bugs, fixing tests, resolving crashes
Look for: Error messages, "not working", investigation steps

**tutorial** - Teaching or demonstrating
Examples: How-to guides, walkthroughs, step-by-step explanations
Look for: Instructions, "first do this, then...", teaching tone

**learning** - Researching or studying
Examples: Reading docs, exploring frameworks, comparing options
Look for: "Let me understand", research, exploration

**working** - Building or creating (not fixing)
Examples: Writing features, refactoring, implementing new code
Look for: Creating files, "let's implement", productive coding

## Output exactly this format:
{"meeting": 85, "debugging": 10, "tutorial": 0, "learning": 45, "working": 20}

Transcript:
{{TRANSCRIPT_ALL}}
