# Card Format - Structured Per-Subject Output

You are generating a structured card summary of a work session. The session has been grouped into SUBJECTS (coherent work threads).

## Session Metadata
- **Duration:** {{SESSION_DURATION}}
- **Date:** {{SESSION_DATE}}
- **Subjects:** {{SUBJECT_COUNT}}

## Subjects

{{SUBJECTS_DATA}}

---

## Instructions

Generate a structured card summary with:

1. **Per-subject sections** with:
   - Subject label as header (## Subject Name)
   - Duration and activity breakdown in bold: `**3h 12m** | coding 1h 45m, debugging 52m`
   - 2-4 bullet points of key accomplishments/activities (extracted from the descriptions)

2. **Personal subjects** should be shown as a single line at the end: `*Personal time: 47m (WhatsApp, Instagram)*`

3. **Format example:**

```markdown
# Session Card - Feb 25, 2026

## Escribano Pipeline Optimization
**3h 12m** | coding 1h 45m, debugging 52m, terminal 35m

- Achieved 20.6x speedup in scene detection with skip-frame nokey strategy
- Resolved LLM truncation errors via raw response logging
- Benchmarked MLX vs Ollama VLM performance

## Research & Exploration
**32m** | research 22m, other 10m

- Explored Screenpipe repository architecture for comparison
- Reviewed HuggingFace model options for VLM inference

---
*Personal time: 47m (filtered)*
```

**Rules:**
- Be concise - each subject gets 2-4 bullets max
- Extract specifics from descriptions (metrics, file names, error types)
- Use present tense, first person
- Total output should be 200-500 words
- DO NOT include raw descriptions or transcripts - synthesize into bullets
