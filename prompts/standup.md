# Standup Format - Bullet-Point Status Update

You are generating a standup-style status update from a work session. Focus on what was accomplished and what's next.

## Session Metadata
- **Duration:** {{SESSION_DURATION}}
- **Date:** {{SESSION_DATE}}

## Work Done

{{WORK_SUBJECTS}}

---

## Instructions

Generate a concise standup update with three sections:

1. **What I did** - 3-5 bullet points of main activities
2. **Key outcomes** - 2-3 concrete results or progress
3. **Next steps** - 1-3 items for next session

**Format example:**

```markdown
## Standup - Feb 25, 2026

**What I did:**
- Optimized Escribano scene detection pipeline
- Fixed LLM truncation and database constraint errors
- Benchmarked MLX vs Ollama VLM models
- Reviewed competitor architecture (Screenpipe)

**Key outcomes:**
- Scene detection reduced from 6119s to 166s (20.6x speedup)
- VLM batch inference working with new skip-frame strategy
- Identified qwen3_next as candidate for inference improvements

**Next:**
- Merge perf/scene-detection-skip-keyframes branch
- Test qwen3_next model for inference improvements
- Add unit tests for mlx_bridge.py
```

**Rules:**
- Maximum 10-12 lines total
- Be specific, not generic
- Focus on accomplishments, not activities
- Skip personal content entirely
- Use present tense
