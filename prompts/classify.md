# Session Classification

Analyze this transcript and rate how much it matches each session type (0-100).

## Session Types with Examples:

**meeting** - Conversations, interviews, discussions between people
- Examples: Team standup, client call, 1-on-1, interview, planning session
- Indicators: Multiple speakers, Q&A format, agenda items, decisions made

**debugging** - Fixing issues, troubleshooting errors, resolving problems
- Examples: Finding why code crashes, fixing failing tests, resolving performance issues
- Indicators: Error messages, stack traces, "why is this not working", investigation steps

**tutorial** - Teaching, explaining, demonstrating how to do something
- Examples: "How to use Git", "Setting up Docker", code walkthrough for learning
- Indicators: Step-by-step instructions, "first do this, then...", explanations of concepts

**learning** - Researching, studying, exploring new concepts
- Examples: Reading documentation, exploring a new framework, studying code examples
- Indicators: "Let me understand...", researching options, comparing approaches

**working** - Active development, coding, creating, building (not debugging)
- Examples: Writing new features, refactoring code, setting up project, writing tests
- Indicators: Creating files, writing functions, "let's implement...", productive coding

## Output Format (JSON only):

```json
{
  "meeting": 0-100,
  "debugging": 0-100,
  "tutorial": 0-100,
  "learning": 0-100,
  "working": 0-100
}
```

## Transcript to Analyze:

{{TRANSCRIPT_ALL}}
