# ADR 002: Segment-Based Intelligence Architecture

## Status
Accepted

## Context

### Problem
Escribano currently classifies sessions at the **session level** - a single classification for an entire recording (e.g., 1 hour). However, real work sessions are **heterogeneous**:

```
[0:00-0:10] Reading documentation     → learning
[0:10-0:25] Writing code              → working  
[0:25-0:30] Spotify break             → NOISE
[0:30-0:45] Debugging an error        → debugging
[0:45-1:00] Stand-up meeting          → meeting
```

The blended classification `{ working: 60, learning: 20, debugging: 10 }` loses temporal structure. Artifact generation cannot target specific activities.

### Current State (M3)
The visual pipeline (`visual_observer_base.py`) already produces **temporal boundaries** via CLIP clustering:
- ~160 clusters for a 1-hour session.
- Each cluster has: `timeRange`, `heuristicLabel`, `avgOcrCharacters`, `ocrText`.

However, these clusters are:
1. **Too granular** - CLIP clusters by visual similarity, not by activity.
2. **Context-blind** - Same app (browser) may contain different activities (learning, debugging, noise).
3. **Not first-class** - Clusters are infrastructure output, not domain objects.

### Anemic Domain Model
Current architecture follows a **Transaction Script** pattern:
- Entities in `0_types.ts` are pure data (no behavior).
- Business logic scattered across actions.
- Most actions return `Promise<Session>`, suggesting Session is the core aggregate.

## Decision

### 1. Introduce Segment as a First-Class Value Object
A **Segment** is a contiguous time slice with unified activity context. It groups one or more visual clusters and associated transcripts.

### 2. Adopt Functional Domain Modules Pattern
Instead of OOP classes, we will use **TypeScript modules with namespaced functions**.
- **Location**: `src/domain/*.ts`
- **Pattern**: `export const Concept = { ...methods }`
- **Immutability**: Methods return new objects instead of mutating.

### 3. Remove Session-Level Classification
Classification moves **from Session to Segments**. Session-level classification is now a query that aggregates segment classifications.

### 4. Multi-Level Context Extraction (Option C)
Context extraction uses a multi-level approach:
1. **Embeddings + LLM summarization** (Primary): Ollama `nomic-embed-text` for semantic clustering.
2. **Regex Patterns** (Optimization): Fast path for obvious cases (URLs, file paths).

### 5. Define EmbeddingService Port
Abstract embedding generation behind a port to allow swapping providers (Ollama, Transformers.js, External APIs).

## Consequences

### Pros
- **High Precision**: Artifacts can target specific activities.
- **Noise Filtering**: Easily exclude irrelevant segments (e.g., music, idling).
- **Rich Domain Model**: Business logic is discoverable, testable, and co-located with data.
- **Scalability**: Architecture supports complex multimodal analysis.

### Cons
- **Increased Complexity**: New domain layer and abstractions.
- **Computational Cost**: More LLM/Embedding calls per session.
- **Migration Effort**: Existing anemic entities/actions must be gradually refactored.

## References
- ADR 001: Visual Intelligence Shift
- [Martin Fowler: Anemic Domain Model](https://martinfowler.com/bliki/AnemicDomainModel.html)
