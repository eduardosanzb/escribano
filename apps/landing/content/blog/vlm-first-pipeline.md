---
title: "Why OCR-Based Screen Intelligence Fails for Developers"
date: 2026-02-26
description: "I spent months building an OCR-based pipeline to understand screen recordings. It produced garbage. Here's what I learned about why text extraction fails for developer workflows—and why vision-language models are the answer."
draft: false
---

I wanted to build a tool that could watch a developer's screen and understand what they were doing. Not surveillance—understanding. The kind of understanding that lets you say, "I spent three hours debugging the authentication flow," and have the AI nod and write it up for your standup.

My first instinct was OCR. Text is the currency of developer work: code, terminal output, documentation, Slack messages. Extract the text, classify it, done. Right?

Wrong. I spent months building an OCR-based pipeline before I admitted it was producing garbage. This is the story of what went wrong, and why vision-language models (VLMs) turned out to be the answer.

## The OCR hypothesis

The pitch was compelling: developers live in text. Our screens are filled with code editors, terminals, browsers with Stack Overflow tabs. If you extract all the text from a screen recording, you should have a rich semantic signal to work with.

Here's how I imagined the pipeline:

1. Extract frames from the screen recording (every 2 seconds)
2. Run OCR on each frame to get text
3. Clean up the OCR output (remove noise, normalize)
4. Feed the text to an LLM for classification
5. Group frames by activity type (coding, debugging, meeting, research)
6. Generate a summary

Clean, deterministic, cheap. OCR is a solved problem, right?

## What the OCR actually saw

The first sign of trouble was the noise. A single frame of a VS Code window produces hundreds of text fragments: file names in the sidebar, method names in the minimap, git status, terminal prompts, debug console output, the actual code you're editing. Most of it is irrelevant.

But the real problem wasn't noise—it was that OCR saw *everything except the thing that mattered*.

Here's a typical debugging session:

- You stare at an error message
- You scroll through a stack trace
- You open a browser tab to search the error
- You read a Stack Overflow answer
- You switch back to your editor
- You try a fix
- The error changes
- You repeat

OCR captures all the text: the error message, the stack trace, the Stack Overflow answer, the code. But it has no idea what's *happening*. It doesn't know you were stuck. It doesn't know the answer on Stack Overflow was the key insight. It doesn't know the fix worked.

Worse, OCR is fragile. A single misrecognized character corrupts a variable name. Text that's rendered at an angle (think video calls with screen sharing) comes out garbled. Dark mode themes with low contrast produce garbage. And code fonts—oh, the code fonts. OCR was trained on natural language, not monospace programming glyphs.

## The clustering experiment

I tried to salvage the approach with embeddings. The idea: take all the OCR text, generate embeddings, cluster similar frames together, and let the LLM reason about the clusters.

This was the V2 pipeline, and it produced... something. But the clusters were meaningless. Frames from a debugging session would cluster with frames from a coding session because they both contained the word "error" in different contexts. Frames from a research session would cluster with frames from a meeting because both had the word "Zoom" (one in a browser tab, one in an actual call).

The LLM, presented with these clusters, would hallucinate activities that never happened. "You were working on database optimization," it would say, because it saw SQL keywords in a cluster. But I was actually debugging a CSS layout issue—the SQL was from a background tab I never looked at.

## The activity recognition problem

Here's the core insight that took me too long to accept: **activity recognition is not a text classification problem**.

When you look at a screenshot of a developer's screen, you don't read every word to understand what they're doing. You see patterns:

- Multiple editor panes + red squiggles + error panel = debugging
- Single editor + rapid typing + git diff view = coding
- Browser with multiple tabs + Stack Overflow + documentation = research
- Video call UI + shared screen = meeting
- Terminal + command output = CLI work

These are *visual* patterns. OCR strips away the visual structure and leaves you with a bag of words. You've thrown away the signal you actually need.

## The VLM pivot

Vision-Language Models (VLMs) can see images and describe them in natural language. Instead of extracting text, you show the model the frame and ask: "What is the user doing? What applications are visible? What's the main activity?"

The difference is night and day.

Here's what a VLM sees in a debugging frame:

> The user is in VS Code with a Python file open. There's a red error squiggle on line 47, and the Problems panel at the bottom shows an 'ImportError: cannot import name'. The terminal shows a failed test run. The user appears to be debugging an import issue.

This is *semantic understanding*. Not text extraction—comprehension. The VLM understands that the red squiggle means an error, that the Problems panel is showing diagnostics, that the terminal output indicates a test failure. It infers intent from visual cues.

## The architecture that actually works

The working pipeline (V3) looks like this:

1. **Frame extraction**: Sample frames at adaptive intervals (2-10 seconds, with scene detection to capture transitions)
2. **VLM inference**: Ask the VLM to describe each frame—activity, applications, content
3. **Activity segmentation**: Group consecutive frames by activity continuity
4. **Audio alignment**: Attach transcripts (from whisper) to segments by timestamp
5. **LLM summary**: Generate a narrative summary from the segmented activities

The VLM does the heavy lifting of understanding what's happening in each frame. The LLM (a text-only model) then takes those descriptions and weaves them into a coherent narrative.

## Cost and performance

VLMs are slower and more expensive than OCR. My first VLM pipeline took 43 minutes to process a 3-hour recording. That's not great.

But then I discovered two optimizations that changed the calculus:

1. **Adaptive sampling**: Instead of sampling every 2 seconds, sample at 10-second intervals and add extra frames at scene changes (detected by ffmpeg). This reduced frames by 90% without losing signal.

2. **Interleaved batching**: MLX-VLM (Apple's framework for local inference) supports interleaved image-text batches. Instead of processing one frame at a time, you batch 16 frames together. This gave a 2.5x speedup.

The result: a 3-hour recording now processes in ~20 minutes, entirely locally on my MacBook Pro. No cloud API costs, no data leaving my machine.

## Why this matters for developer tools

Developers are paranoid about privacy. Rightfully so. Our screens contain proprietary code, API keys, internal URLs, Slack messages about layoffs. The idea of sending screen recordings to a cloud API is a non-starter for most teams.

This is why local inference matters. The VLM runs on my machine. The LLM runs on my machine. The raw frames and transcripts never leave my disk. I can build a tool that understands my work without surveilling me.

## The lesson

OCR is a tool for digitizing documents. It's great for scanning receipts, extracting text from PDFs, making scanned books searchable. But screens are not documents. They're dynamic, visual interfaces where meaning is conveyed through layout, color, motion, and context.

If you're building screen intelligence—tools that understand what people are doing on their computers—don't start with OCR. Start with vision. The models have gotten good enough, and the hardware has gotten fast enough, that you can run real understanding locally.

---

**Escribano** is an open-source tool that turns screen recordings into structured summaries. It runs entirely locally on macOS using whisper.cpp for transcription, MLX-VLM for frame analysis, and Ollama for summary generation.

- **Star on GitHub**: [github.com/eduardosanzb/escribano](https://github.com/eduardosanzb/escribano)
- **Try it**: `npx github:eduardosanzb/escribano` (requires macOS with Apple Silicon)
