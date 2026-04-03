# ADR 015: Two-Layer Aggregation Model

## Context

We need a scalable and resource-efficient way to aggregate screen recording observations into semantic sessions (TopicBlocks) for downstream agent consumption and artifact generation.

## Decision

We are adopting a two-layer aggregation architecture:

- **Layer 1 (Time-based Heuristic)**: A pure Swift implementation that relies on a 60-second time gap heuristic. This layer continuously upserts state without any ML/LLM overhead, providing a fast, base-level grouping of continuous activity.
- **Layer 2 (Semantic Grouping)**: An on-demand LLM-powered semantic grouping that is invoked only during artifact generation or explicit user/agent request. This groups the time-based chunks into higher-level logical sessions.

## Consequences

- Reduces constant LLM inference load, conserving energy and system resources.
- Provides immediate, albeit basic, session boundaries in real-time.
- Enables more focused, context-rich LLM processing when artifacts are actually requested.
