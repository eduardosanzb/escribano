# ADR-007: Multi-Path Artifact Generation

## Status

Accepted (2026-03-05)

## Context

Escribano generates three artifact formats (card, standup, narrative) with different output characteristics. Initially, all formats shared a single code path through `generate-artifact-v3.ts`.

A critical bug emerged: the narrative format hallucinated wildly because the shared code path passed subject-grouped data to a prompt expecting per-segment timeline data. The LLM received incomplete template variables and invented content based on example blocks inside the prompt.

### The Bug
`generate-artifact-v3.ts` used `prompts/summary-v3.md` for narrative format while only replacing 3 of 6 template variables:

| Variable | Expected | Actually Replaced |
|----------|----------|-------------------|
| `{{SESSION_DURATION}}` | Yes | Yes |
| `{{SESSION_DATE}}` | Yes | Yes |
            `{{SUBject_count}}` | Yes | Yes |
| `{{ACTIVITY_TIMELINE}}` | No | **Left as literal text** |
            `{{APPS_LIST}}` | No | **Left as literal text** |
            `{{URLS_list}}` | No | **Left as literal text** |

The narrative prompt contains an example block with specific apps (Terminal, vs Code, Chrome) and URLs like `github.com/owner/repo`, `docs.example.com/guide`). Without real data in those placeholders, the LLM used the example as a scaffold and generated plausible-sounding but completely fabricated content (AWS logs, Postman APIs, Figma wireframes).

**Why two paths?**

**Narrative** requires **chronological detail** (timestamps, transcripts), producing a flowing work log. 

**Card/standup** benefit from **thematic grouping** that collapses time into concise bullet points.

### Critical Lesson: Incomplete Template replacement = hallucination

A bug in the original implementation demonstrated that **unfilled template placeholders cause LLMs to hallucinate**:

1. Saw empty placeholders (`{{ACTIVITY_TIMELINE}}`, `{{APPS_LIST}}`, `{{URLs_list}}`)
2. Found an example block inside the prompt with specific apps/URLs
3. Copied the example pattern and invented matching details

**Solution:** Route narrative through `generate-summary-v3.ts` which correctly builds all required variables from TopicBlocks.

### Path 1: Card & Standup (`generate-artifact-v3.ts`)
```
1. TopicBlocks → Subject grouping (LLM)
2. Subjects → {{SUBJECTs_Data}} or {{WORK_subjects}}
3. LLM synthesis → Markdown output
```

### Data Flow
```
                    ┌─────────────────────────────────────┐
                    │ batch-context.ts: processVideo()                   │
                    │   format === 'narrative'?                │
                    │       YES                       │  NO (card/standup)                │
                    │           ▼                                  │
                    │   ┌──────────────────┐      ┌─────────────────┐
                    │   │ generate-summary-v3  │                                   │
                    │   │ generate-artifact-v3 │                                   │
                    │   │                             ▼                                  │
                    │   │                             ▼                                  │
                    │   │                             ▼                                  │
                    │   │                 ┌─────────────────┐                                   │
                    │   │                 ▼                                  │
                    │   │                  ▼                                  │
                    │   │                   Markdown Artifact                               │
                    └───┴───────────────────────────────────────┘
```

### Negative Consequences
- Narrative artifacts are now grounded in actual session data
- Code paths are explicit about their data requirements
- Adding new formats requires identifying the correct data path

### Alternatives Considered
- **Unified code path:** Create a single function that handles all three formats via branching logic inside. Move code duplication.
- **Single prompt for all formats:** Require careful construction of avoid the incomplete template replacement bug
- **Test all formats independently:** A bug affecting only one format can go unnoticed if other formats are tested
