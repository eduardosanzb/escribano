# ADR-014: Swift-Native Artifact Generation

**Status**: Accepted

**Date**: 2026-04-03

## Context

The original plan included TypeScript CLI-based artifact generation as part of the escribano-ts pipeline. However, this was never implemented. The Swift macOS menu bar application (`.app`) has become the complete product, handling continuous screen recording, frame analysis, and session aggregation.

Artifact generation—converting captured TopicBlocks into user-readable formats like standup reports, narrative summaries, and project cards—needs a home. Running it as a separate TS CLI process would require:
- An additional Python bridge process (memory pressure)
- Complex inter-process coordination
- Duplicated inference queue logic

The Swift app already has a Python bridge (`mlx-vlm` via Unix socket) and an inference queue with priority levels. Reusing this infrastructure is the natural choice.

## Decision

Move artifact generation entirely to Swift. The Swift app will:

1. **Reuse the existing Python bridge** already loaded for VLM inference
2. **Use `.critical` priority** in the `InferenceQueue` to ensure sub-20s artifact generation by jumping ahead of routine VLM work
3. **Generate artifacts via LLM calls** through the same Qwen3.5 model used for VLM and text generation
4. **Use ephemeral subjects** passed directly in prompts rather than persisting subject metadata

## Consequences

### Positive

- **Resource efficiency**: Artifact generation reuses the same Qwen3.5 model already loaded for VLM—no additional memory overhead
- **Responsive UX**: `.critical` priority ensures artifact generation completes in under 20 seconds by preempting routine frame analysis
- **Extensibility**: `TextGenerationPort` abstracts text generation, enabling future swaps to cloud APIs or larger local models without changing artifact logic
- **Simplified architecture**: Ephemeral subjects eliminate the need for a `SubjectStore` and subject management UI—subjects are inferred from observations at generation time
- **Quality through decomposition**: Two-step LLM flow (grouping observations → writing prose) compensates for 2B parameter model limitations by separating classification from generation

### Negative

- **Tighter coupling**: Artifact logic is now tied to the Swift app; TS pipeline remains dev/testing only
- **Model constraints**: All text generation (including artifacts) is limited to the 2B Qwen3.5 model's capabilities
- **No subject persistence**: Users cannot save or reuse subject definitions across sessions (acceptable for MVP)

## Alternatives Considered

### 1. TypeScript CLI Artifact Generation (Rejected)

**Rationale**: Would require a separate Python bridge process, increasing memory pressure and complexity. The TS CLI artifact generation was never implemented, and the Swift app is now the primary interface.

### 2. Single LLM Call Without Grouping (Rejected)

**Rationale**: The 2B parameter model cannot simultaneously group observations by activity and write coherent prose. Attempting both in one call produces lower quality output. The two-step approach (group first, then generate) yields better results.

### 3. Persisted Subjects with SubjectStore (Rejected)

**Rationale**: Would require additional database schema, CRUD UI, and subject management flows. For MVP, ephemeral subjects inferred from observation content are sufficient. Can be added later if user demand justifies the complexity.

## Related

- [Architecture Overview](./architecture.md)
- [MVP Final Push](../MVP-FINAL-PUSH.md)
- BACKLOG.md — Phase 3b: Integrated Artifact Generation
