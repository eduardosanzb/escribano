# ADR 001: Shift to Visual Intelligence for Silent Sessions

## Status
Accepted

## Context
Escribano was initially designed as an audio-centric tool (Recording -> Transcript -> Artifact). However, developer "working sessions" are often silent for long periods. Relying solely on audio results in empty transcripts and low-value artifacts for deep coding work. The video content (code changes, terminal output, documentation browsing) contains the primary value for these sessions.

## Decision
We will elevate Video to a first-class citizen in the Escribano architecture.
1. **Visual Log:** We will introduce the concept of a `VisualLog`, a time-stamped sequence of visual events derived from the video recording.
2. **VideoPort:** We will implement a `VideoPort` (using FFmpeg) to programmatically extract key frames from video files using scene detection and timestamp-based extraction.
3. **Visual Intelligence:** We will eventually implement a `VisualIntelligencePort` to describe these frames using local Vision LLMs (e.g., MiniCPM-V, Moondream), turning pixels into semantic text.
4. **Multimodal Synthesis:** The `IntelligenceService` will be updated to synthesize both Audio Transcripts and Visual Logs when generating artifacts.

## Consequences
- **Pros:**
    - High-value artifacts for silent coding sessions.
    - Richer "Runbooks" and "Tutorials" with embedded screenshots and visual context.
    - Better support for multi-monitor or complex UI workflows.
- **Cons:**
    - Increased computational overhead (Video processing + Vision LLM inference).
    - Higher storage requirements for extracted screenshots.
    - Dependency on `ffmpeg` binary.
