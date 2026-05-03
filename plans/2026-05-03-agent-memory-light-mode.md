# Implementation Plan: Agent Memory Video — Light Mode Redesign

**Date**: 2026-05-03 **Status**: COMPLETED

## Overview

Completely redesign the `EscribanoAgentMemory` Remotion composition from a dark split-screen slide deck into a single continuous light-mode chat interface. The new video shows an AI agent querying Escribano for research context, with a terminal-like chat that types, thinks, and scrolls. Background mutates subtly (dot grid, connecting lines) to reflect agent state. Music shifts from electronic to warm Caribbean/Mediterranean bossa nova.

## Scope

- Work units: 9
- Execution phases: 3
- Files affected:
  - `apps/landing/remotion/src/agent-video.tsx` — modify (composition assembly)
  - `apps/landing/remotion/src/agent-video/AgentStage.tsx` — modify (stage + backgrounds)
  - `apps/landing/remotion/src/agent-video/AgentPanel.tsx` — modify (chat orchestrator)
  - `apps/landing/remotion/src/agent-video/WorkMemoryStream.tsx` — delete
  - `apps/landing/remotion/src/components/AmbientMusic.tsx` — modify (warm audio)
  - `apps/landing/remotion/src/agent-video/ChatMessage.tsx` — create (user prompt bubble)
  - `apps/landing/remotion/src/agent-video/ThinkingBlock.tsx` — create (thinking + evidence)
  - `apps/landing/remotion/src/agent-video/AnswerBlock.tsx` — create (structured answer + pills)
  - Outline document: "AI Agent Use Cases" — create in collection `escribano-docs-dStKdqSnsc`

## Design System

### Colors (light mode, matching landing page CSS)

```
ink:          '#1a1612'   // Primary text
inkSoft:      '#3d3530'   // Secondary text
inkMuted:     '#7a6e66'   // Tertiary/muted text
parchment:    '#f5f0e8'   // Background base
cream:        '#faf7f2'   // Background highlight
surface:      '#ede5d4'   // Card/container backgrounds
surfaceElev:  '#e8e0ce'   // Elevated surfaces
line:         '#d4c9b5'   // Borders/dividers
terracotta:   '#b85c38'   // Accent / brand / privacy
olive:        '#5c6b3a'   // Success / positive
amber:        '#c4963a'   // Warm highlight
```

### Typography

```
serif:  "'Cormorant Garamond', Georgia, serif"
body:   "'Spectral', Georgia, serif"
sans:   "'DM Sans', system-ui, sans-serif"
mono:   "'SF Mono', SFMono-Regular, Menlo, Monaco, monospace"
```

Fonts are loaded via inline `@font-face` declarations in `AgentStage.tsx` (see existing pattern). Font files are at `/public/fonts/` and resolve from `apps/landing/` CWD.

### Layout

- Terminal-like chat, left-aligned within a ~800px container
- Container centered horizontally on 1920×1080 canvas
- Padding: 60px top, 40px sides, 80px bottom
- Messages stack vertically with 16px gap
- No split screen. No scene cuts. One continuous flow.

## Work Units

### WU-1: Rewrite AgentStage — Light Mode + Mutating Backgrounds

**Dependencies**: none

**Context**: The current `AgentStage.tsx` is a dark-mode stage with radial gradients, a particle system, and a grid overlay. The new design needs a warm parchment background with a subtle dot grid that fades in during "thinking" phases and faint connecting lines that appear when evidence streams in. The background should feel alive but never distract from the chat text.

**Files**:
- `apps/landing/remotion/src/agent-video/AgentStage.tsx` — modify (complete rewrite)

**Steps**:
1. Replace the entire file. Keep the font-face `@font-face` declarations exactly as they are (lines 28-44 in current file). Keep the `BrandWordmark` component with the same signature but update colors to light mode:
   - `AGENT_COLORS.ink` → `'#1a1612'`
   - `AGENT_COLORS.amber` → `'#b85c38'` (terracotta for the accent 'a')
2. Replace `AGENT_COLORS` with the light mode palette (see Design System above).
3. Replace `AGENT_FONTS` — keep the same values, they don't change.
4. Rewrite `AgentStage` component:
   - Background: `linear-gradient(180deg, #faf7f2 0%, #f5f0e8 100%)`
   - Remove the olive and amber radial gradient overlays (they're dark-mode artifacts)
   - Replace the grid overlay with a **dot grid**:
     ```
     backgroundImage: radial-gradient(circle, rgba(26,22,18,0.06) 1px, transparent 1px)
     backgroundSize: 48px 48px
     ```
     - Dot grid opacity should be `0` by default
     - It animates to `0.12` opacity during "thinking" phases (we'll drive this via a prop or frame range later; for now, make it accept an `thinkingIntensity` prop: `number` from 0 to 1, and interpolate opacity)
   - Keep the grain overlay but reduce opacity from `0.15` to `0.08`
   - Keep `TileStrip` but update colors to light mode palette (terracotta, olive, amber)
   - Remove all `FloatingDot` and `Particle` elements (they're dark-mode artifacts)
   - Add a **connecting lines layer** — this is an SVG overlay that draws faint lines between evidence items. For now, implement it as a placeholder: an absolute-positioned SVG with `opacity: 0` that accepts a `connectionIntensity` prop (0-1). The actual line coordinates will be wired in WU-5.
5. Export `AGENT_COLORS` and `AGENT_FONTS` so other components can import them.

**Verification**: `cd apps/landing/remotion && npx tsc --noEmit` must pass with zero errors.

**Rollback**: `git checkout -- apps/landing/remotion/src/agent-video/AgentStage.tsx`

---

### WU-2: Create ChatMessage Component

**Dependencies**: none

**Context**: A reusable message bubble for the chat interface. Used for the user's initial prompt. The user prompt has a `>` prefix (terminal style) and types character-by-character. This is the first visual element the viewer sees.

**Files**:
- `apps/landing/remotion/src/agent-video/ChatMessage.tsx` — create

**Steps**:
1. Create the file with these exports: `ChatMessage`, `BlinkingCursor`, `typeText`.
2. `typeText(text: string, frame: number, startFrame: number, speed = 2)`:
   - Returns `text.slice(0, Math.max(0, Math.floor((frame - startFrame) / speed)))`
   - This is the same logic as the current `typeText` in `AgentPanel.tsx`
3. `BlinkingCursor`: A vertical bar that blinks. Props: `frame: number`, `color?: string`.
   - Width: 2px, height: 1.2em, background: color
   - Opacity: `frame % 32 < 16 ? 1 : 0`
   - Use `display: 'inline-block'` and `verticalAlign: 'text-bottom'`
4. `ChatMessage`: Props:
   ```typescript
   interface ChatMessageProps {
     text: string;
     frame: number;
     startFrame: number;
     isUser?: boolean;      // default false
     speed?: number;        // default 2 (chars per frame for user)
     showCursor?: boolean;  // default true
   }
   ```
5. If `isUser` is true, prefix the displayed text with `> ` (terminal prompt style).
6. Style:
   - Font: `AGENT_FONTS.mono` (import from `AgentStage.tsx`)
   - User color: `AGENT_COLORS.ink`
   - Agent color: `AGENT_COLORS.inkSoft`
   - Font size: 15px, lineHeight: 1.7
   - No bubble background — terminal style is just text on the page
7. The component should render the typed text + blinking cursor (if `showCursor` is true and typing is in progress).

**Verification**: `cd apps/landing/remotion && npx tsc --noEmit` must pass with zero errors.

**Rollback**: `rm -f apps/landing/remotion/src/agent-video/ChatMessage.tsx`

---

### WU-3: Create ThinkingBlock Component

**Dependencies**: none

**Context**: The "thinking" block appears below the user prompt. It has a greyed-out background, a header with a pulsing amber dot and a privacy badge (`🔒 Local only`), thinking narrative that types token-by-token, a tool call block in monospace, evidence items that slide in, and a success line. This is the heart of the video — it demonstrates Escribano's unique capability.

**Files**:
- `apps/landing/remotion/src/agent-video/ThinkingBlock.tsx` — create

**Steps**:
1. Create the file. Import `AGENT_COLORS` and `AGENT_FONTS` from `./AgentStage`.
2. Export `ThinkingBlock` with props:
   ```typescript
   interface ThinkingBlockProps {
     frame: number;           // Current frame from useCurrentFrame
     startFrame: number;      // When this block starts appearing
   }
   ```
3. **Container style**:
   - Background: `rgba(237, 229, 212, 0.6)` (surface with transparency)
   - Border: `1px solid rgba(26, 22, 18, 0.08)`
   - Border radius: 12px
   - Padding: 20px 24px
   - Margin top: 16px
   - Font family: `AGENT_FONTS.mono`
   - Font size: 13px
   - Line height: 1.6
   - Color: `AGENT_COLORS.inkMuted`
4. **Header**:
   - Left: A small pulsing circle (4px diameter, `AGENT_COLORS.amber`) + the text `thinking:`
   - Right: `🔒 Local only` in `AGENT_COLORS.terracotta`, font size 11px, `AGENT_FONTS.sans`
   - Use `display: flex`, `justifyContent: 'space-between'`
   - The amber dot pulses using `opacity = 0.4 + 0.6 * Math.sin(frame / 10)`
   - Header margin bottom: 12px
5. **Thinking narrative** (token-by-token):
   - Text: `The user wants a summary of their research on vector databases from this afternoon. Let me query Escribano for recent activity.`
   - Token speed: 1 token per frame (each token is ~3-5 characters; split by spaces)
   - Start rendering at `startFrame + 12`
   - Use the same `typeText` logic but split by words: `text.split(' ').map(word => word + ' ')` and reveal word-by-word
6. **Tool call block**:
   - Appears after the narrative finishes
   - Monospace block with left border: `2px solid AGENT_COLORS.terracotta`
   - Background: `rgba(26, 22, 18, 0.03)`
   - Padding: 12px 16px
   - Content:
     ```
     · tool: escribano.search({
         when: "this afternoon",
         intent: "research",
         topic: "vector databases"
       })
     ```
   - Render line-by-line with a delay of 8 frames per line
7. **Evidence items**:
   - Array of evidence:
     ```typescript
     const evidence = [
       { time: '14:32', source: 'Browser', title: 'pgvector docs' },
       { time: '14:41', source: 'Browser', title: 'Pinecone pricing' },
       { time: '14:52', source: 'VS Code', title: 'notes.md' },
       { time: '14:58', source: 'Terminal', title: 'docker compose up' },
       { time: '15:03', source: 'Slack', title: '"benchmark pgvector?"' },
     ];
     ```
   - Each item appears as a single line: `14:32  Browser  pgvector docs`
   - Items slide in from left with spring animation:
     ```typescript
     import { spring } from 'remotion';
     const progress = spring({ frame: Math.max(0, frame - itemStartFrame), fps: 60, config: { damping: 25, stiffness: 120, mass: 0.6 } });
     ```
   - Transform: `translateX(${(1 - progress) * -30}px)`
   - Opacity: `progress`
   - Stagger: 10 frames between items
   - Time column: `AGENT_FONTS.mono`, `AGENT_COLORS.inkMuted`, 11px
   - Source column: `AGENT_FONTS.sans`, `AGENT_COLORS.olive`, 11px
   - Title column: `AGENT_FONTS.sans`, `AGENT_COLORS.inkSoft`, 12px, fontWeight: 500
8. **Success line**:
   - Text: `✓ 14 observations found`
   - Color: `AGENT_COLORS.olive`
   - Appears after all evidence items
   - Fade in over 18 frames
9. **Frame timing** (relative to `startFrame`):
   - Block fades in: frames 0-12
   - Narrative types: frames 12-90
   - Tool call appears: frames 90-150
   - Evidence streams: frames 150-250 (5 items × 10 frame stagger + 50 frames for animation)
   - Success line: frame 260

**Verification**: `cd apps/landing/remotion && npx tsc --noEmit` must pass with zero errors.

**Rollback**: `rm -f apps/landing/remotion/src/agent-video/ThinkingBlock.tsx`

---

### WU-4: Create AnswerBlock Component

**Dependencies**: none

**Context**: The answer block appears below the thinking block. It contains a structured markdown-like summary of the research findings, followed by action pills. The text renders token-by-token (word-by-word), and the pills spring in with stagger at the end.

**Files**:
- `apps/landing/remotion/src/agent-video/AnswerBlock.tsx` — create

**Steps**:
1. Create the file. Import `AGENT_COLORS` and `AGENT_FONTS` from `./AgentStage`.
2. Export `AnswerBlock` with props:
   ```typescript
   interface AnswerBlockProps {
     frame: number;
     startFrame: number;
   }
   ```
3. **Container style**:
   - No background (just text on parchment)
   - Margin top: 24px
   - Font family: `AGENT_FONTS.sans`
   - Font size: 15px
   - Line height: 1.7
   - Color: `AGENT_COLORS.ink`
4. **Answer lines** (render word-by-word, token speed):
   ```typescript
   const answerLines = [
     "Here's what you found:",
     "",
     "pgvector (Postgres extension)",
     "  • Free, already in your stack",
     "  • Good up to ~1M vectors",
     "  • You tested locally — works",
     "",
     "Pinecone",
     "  • Managed, $70/mo starter",
     "  • Best for >10M vectors",
     "  • You noted: \"maybe overkill for v1\"",
     "",
     "Weaviate",
     "  • Open source, complex setup",
     "  • You closed the tab after 5 min",
     "",
     "Recommendation: Start with pgvector.",
     "You already proved it works.",
   ];
   ```
5. **Line styling**:
   - Lines starting with `  •`: `AGENT_COLORS.inkSoft`, indent 16px
   - Empty lines: just margin
   - All other lines: `AGENT_COLORS.ink`
   - The "Recommendation:" line: `AGENT_COLORS.terracotta`, fontWeight: 500
6. **Word-by-word reveal**:
   - Split each line into words
   - Reveal one word per frame
   - Pause 4 frames between lines
   - Use `interpolate` for smooth opacity on each word: `opacity = interpolate(frame, [wordStart, wordStart + 6], [0, 1])`
   - Start at `startFrame + 12`
7. **Action pills**:
   - Appear after all answer text finishes
   - Pills: `[Create ADR]`, `[Share with team]`, `[Continue research]`
   - Style:
     - Padding: `8px 16px`
     - Border radius: 20px
     - Background: `AGENT_COLORS.surface`
     - Border: `1px solid AGENT_COLORS.line`
     - Color: `AGENT_COLORS.inkSoft`
     - Font size: 13px
     - Font family: `AGENT_FONTS.sans`
   - Spring animation with 12 frame stagger
   - Container: `display: flex`, `gap: 12px`, `marginTop: 24px`

**Verification**: `cd apps/landing/remotion && npx tsc --noEmit` must pass with zero errors.

**Rollback**: `rm -f apps/landing/remotion/src/agent-video/AnswerBlock.tsx`

---

### WU-5: Rewrite AgentPanel as Terminal Chat Orchestrator

**Dependencies**: WU-2, WU-3, WU-4

**Context**: `AgentPanel.tsx` is currently a 399-line dark-mode terminal with hardcoded scene modes (`gap`, `tool`, `answer`, `handoff`, `morning`). The new design is a single continuous chat flow with no modes. This component orchestrates the timing of all chat elements and manages the vertical layout.

**Files**:
- `apps/landing/remotion/src/agent-video/AgentPanel.tsx` — modify (complete rewrite)

**Steps**:
1. Replace the entire file. Remove all imports except `React`, `useCurrentFrame`, `useVideoConfig`, `interpolate`, `spring` from `remotion`.
2. Import `ChatMessage` from `./ChatMessage`.
3. Import `ThinkingBlock` from `./ThinkingBlock`.
4. Import `AnswerBlock` from `./AnswerBlock`.
5. Import `AGENT_COLORS` and `AGENT_FONTS` from `./AgentStage`.
6. The component is now a simple orchestrator with NO mode prop. Just:
   ```typescript
   export const AgentPanel: React.FC = () => {
     const frame = useCurrentFrame();
     const { fps } = useVideoConfig();
     // ... timing and layout
   };
   ```
7. **Layout**:
   - Absolute positioning: `left: 0`, `top: 0`, `width: 1920`, `height: 1080`
   - Inner container: `width: 800`, `marginLeft: 560` (centers on 1920px canvas), `paddingTop: 60`, `paddingBottom: 80`
   - The container is NOT scrollable — elements appear and push content down naturally
8. **Timing** (all relative to frame 0):
   - User prompt: `> summarize my research on vector databases from this afternoon`
     - startFrame: 20
     - speed: 2 (char by char)
     - Ends at frame: 20 + text.length * 2 ≈ 136
   - Thinking block:
     - startFrame: 156 (20 frame pause after prompt)
   - Answer block:
     - startFrame: 460 (after thinking block finishes ~300 frames)
   - The thinking block and answer block persist on screen. The chat grows downward.
9. **Fade in for the entire panel**:
   - At frame 0-20, fade the whole container from opacity 0 to 1 using `interpolate`
10. **Scroll simulation**:
    - Since the chat grows beyond the viewport, we need to simulate scrolling.
    - Track the total height of content. When content exceeds `1080 - 60 - 80 = 940px`, start translating the inner container upward.
    - Use a simple threshold: if `frame > 600`, start scrolling up at 0.5px per frame.
    - This is a crude but effective scroll simulation for a 30s video.
11. Remove all old code: `AgentPanelMode`, `typeText`, `BlinkingCursor`, `reveal`, all the `if (mode === ...)` blocks, `MorningLockup`, everything.

**Verification**:
- `cd apps/landing/remotion && npx tsc --noEmit` must pass with zero errors.
- `cd apps/landing && npx remotion compositions remotion/src/index.ts` must list `EscribanoAgentMemory`.

**Rollback**: `git checkout -- apps/landing/remotion/src/agent-video/AgentPanel.tsx`

---

### WU-6: Rewrite Main Composition Assembly

**Dependencies**: WU-1, WU-5, WU-7

**Context**: The current `agent-video.tsx` uses `<Sequence>` components for hard scene cuts. The new design is one continuous flow. We remove all sequences and just render `AgentStage > AmbientMusic + AgentPanel`.

**Files**:
- `apps/landing/remotion/src/agent-video.tsx` — modify (complete rewrite)

**Steps**:
1. Replace the entire file.
2. Keep `AGENT_MEMORY_DURATION = 1800` and `FPS = 60`.
3. Remove the `SCENES` constant entirely.
4. Remove the `MorningLockup` component (it's now inside AgentPanel or not needed).
5. The component becomes:
   ```typescript
   export const EscribanoAgentMemory: React.FC = () => {
     return (
       <AgentStage thinkingIntensity={/* driven by frame, see below */}>
         <AmbientMusic />
         <AgentPanel />
       </AgentStage>
     );
   };
   ```
6. For `thinkingIntensity`, we can use a simple frame-based heuristic:
   - `thinkingIntensity = interpolate(frame, [156, 200, 420, 460], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })`
   - This peaks during the thinking block (frames 200-420) and fades before/after.
   - Pass this as a prop to `AgentStage`.
   - Note: If WU-1 didn't add the `thinkingIntensity` prop, you'll need to add it now. Add `thinkingIntensity?: number` to `AgentStageProps` with default 0.

**Verification**:
- `cd apps/landing/remotion && npx tsc --noEmit` must pass with zero errors.
- `cd apps/landing && npx remotion render remotion/src/index.ts EscribanoAgentMemory /tmp/test-agent.mp4 --frames=0-5` must succeed and produce a non-empty file.

**Rollback**: `git checkout -- apps/landing/remotion/src/agent-video.tsx`

---

### WU-7: Rewrite AmbientMusic for Warm Caribbean/Mediterranean Feel

**Dependencies**: none

**Context**: The current `AmbientMusic.tsx` is a 120 BPM electronic track with kick drums, sawtooth bass, chord stabs, and hi-hats. The new design calls for a bossa nova feel: Rhodes piano, congas, brushed snare, upright bass, ~90 BPM. Warm, not electronic.

**Files**:
- `apps/landing/remotion/src/components/AmbientMusic.tsx` — modify (complete rewrite)

**Steps**:
1. Keep the same component structure: `AmbientMusic: React.FC` using `useVideoConfig`, `delayRender`, `continueRender`, `cancelRender`, `interpolate`, `Html5Audio`, `audioBufferToDataUrl`.
2. Keep the master gain + compressor chain and the volume envelope (fade in over 2s, hold, fade out over 2s).
3. Remove all electronic elements: kick drum, sawtooth bass, chord stabs, hi-hats, shimmer pad.
4. Replace with bossa nova elements:

   **A. Rhodes piano chords** (warm, bell-like):
   - Use `osc.type = 'sine'` with a slight detune for the Rhodes bell sound
   - Or use `osc.type = 'triangle'` for a softer tone
   - Chords: Dm9 (D-F-A-C-E), G13 (G-B-D-F-A-E), Cmaj9 (C-E-G-B-D) — classic bossa nova ii-V-I
   - Play as arpeggios (notes staggered by 0.1s) rather than block chords
   - Volume: very soft, `gain.gain.value = 0.04`
   - Low-pass filter at 2000Hz for warmth
   - Pattern: every 2.67 seconds (90 BPM, 4 beats per chord)

   **B. Conga pattern**:
   - Use a short noise burst (0.05s) with a low-pass filter at 600Hz
   - Pattern: tumbao — hits on beats 2, 2.5, 4, 4.5 (within a 4-beat measure)
   - Volume: `gain.gain.value = 0.08`
   - Repeat for full duration

   **C. Brushed snare**:
   - Use noise with a band-pass filter (2000-4000Hz)
   - Very short (0.08s)
   - Play on beats 2 and 4 (backbeat)
   - Volume: `gain.gain.value = 0.03`
   - Much softer than the current hi-hat

   **D. Upright bass**:
   - Use `osc.type = 'sine'` for a round, warm sound
   - Root notes of each chord: D2 (73.42Hz), G1 (49.0Hz), C2 (65.41Hz)
   - Long sustain (1.5s per note)
   - Volume: `gain.gain.value = 0.1`
   - Slight sidechain ducking from the conga (very subtle, 10% dip)

   **E. Shaker**:
   - Very short noise bursts (0.02s) with high-pass at 5000Hz
   - Play on every eighth note (0.33s intervals)
   - Volume: `gain.gain.value = 0.015`
   - Extremely subtle — just adds texture

5. Tempo: 90 BPM → beat interval = 60/90 = 0.667s
6. Keep the overall volume lower than the current track — `masterGain.gain.linearRampToValueAtTime(0.25, ...)` instead of 0.35.

**Verification**:
- `cd apps/landing/remotion && npx tsc --noEmit` must pass with zero errors.
- The audio generation should not throw. A full verification requires rendering, but TypeScript compilation is the immediate check.

**Rollback**: `git checkout -- apps/landing/remotion/src/components/AmbientMusic.tsx`

---

### WU-8: Delete WorkMemoryStream

**Dependencies**: none

**Context**: `WorkMemoryStream.tsx` was the left-side evidence card panel in the old split-screen design. It is no longer needed in the single-chat design.

**Files**:
- `apps/landing/remotion/src/agent-video/WorkMemoryStream.tsx` — delete

**Steps**:
1. Delete the file.
2. Verify no other file imports from it:
   ```bash
   grep -r "WorkMemoryStream" apps/landing/remotion/src/
   ```
   - The only import should be in `agent-video.tsx`, which WU-6 removes.
   - If WU-6 hasn't run yet, there will be a broken import. That's expected and will be fixed by WU-6.

**Verification**: The file no longer exists: `test ! -f apps/landing/remotion/src/agent-video/WorkMemoryStream.tsx`

**Rollback**: `git checkout -- apps/landing/remotion/src/agent-video/WorkMemoryStream.tsx` (restore from git)

---

### WU-9: Create Outline Document — "AI Agent Use Cases"

**Dependencies**: none

**Context**: We need a dedicated docs page in the Escribano Outline collection that explains how AI agents can use Escribano for context retrieval. This page will be linked from the landing site and serve as the rational counterpart to the emotional video. The page should cover the four main use cases we've discussed, explain the privacy model, and reference the video.

**Files**:
- Outline wiki — create document in collection `escribano-docs-dStKdqSnsc`

**Steps**:
1. Create a new document via the Outline API in collection `escribano-docs-dStKdqSnsc`.
2. Title: `AI Agent Use Cases`
3. Content (markdown):
   ```markdown
   # AI Agent Use Cases

   Escribano is a **local work memory** for AI agents. It captures, indexes, and retrieves everything you do — files edited, commands run, pages visited, messages sent — so your agent can answer questions about your work with actual evidence.

   ## How it works

   Escribano runs entirely on your Mac. It records your screen, transcribes audio, and indexes every observation into a local SQLite database. When an agent needs context, it queries Escribano via a simple CLI or API call. All processing happens on-device — no data leaves your machine.

   ## Use cases

   ### 1. Research Summary

   > "Summarize my research on vector databases from this afternoon."

   After hours of scattered exploration — docs, blog posts, Slack threads, terminal experiments — your agent can reconstruct what you learned and what you concluded. Escribano correlates browser history, file edits, and terminal output into a coherent summary with sources.

   **Example output:**
   - pgvector: tested locally, works for current scale
   - Pinecone: noted as "overkill for v1"
   - Weaviate: closed tab after 5 minutes

   ### 2. Debug Context Recovery

   > "What was I debugging yesterday around 3pm?"

   Overnight context loss is real. Escribano reconstructs your debugging session from file edits, test failures, documentation visits, and Slack messages — so your agent can pick up where you left off.

   ### 3. Incident Runbook Reconstruction

   > "Reproduce the steps we took for last week's database incident."

   Incidents generate scattered signals: PagerDuty alerts, terminal commands, Slack threads, log grepping. Escribano correlates these by timestamp and reconstructs a step-by-step timeline. Your agent turns this into a structured runbook or post-mortem.

   ### 4. Morning Pickup

   > "What should I pick back up?"

   After a weekend or a context switch, your agent checks Escribano for unfinished work: open branches, failing tests, unanswered Slack threads, tabs you never closed. It suggests the highest-priority item to resume.

   ## Privacy

   🔒 **Local only.** Escribano stores everything in `~/.escribano/` on your Mac. The database is SQLite with WAL mode. No cloud service, no API calls, no telemetry. Your work memory stays yours.

   ## Try it

   If you have Escribano installed, ask your agent:

   ```bash
   escribano-query search "your topic here" -d 24h
   ```

   Or use the interactive CLI:

   ```bash
   npx escribano --query "what did I work on yesterday"
   ```

   ## Video

   See Escribano in action: [Agent Memory Demo](/) *(link to landing page video)*
   ```
4. Publish the document (set `publish: true`).
5. The document should appear in the collection alongside "Welcome to Escribano Docs", "How It Works", "CLI Reference — escribano-query", and "How to Use Escribano".

**Verification**: The document exists in the collection and is publicly accessible at `https://notes.eduardosanzb.dev/doc/ai-agent-use-cases-...`

**Rollback**: Delete the document via the Outline API.

---

## Execution Plan

### Phase 1 — Parallel (no dependencies)

- **WU-1**: Rewrite AgentStage — Light Mode + Mutating Backgrounds
- **WU-2**: Create ChatMessage Component
- **WU-3**: Create ThinkingBlock Component
- **WU-4**: Create AnswerBlock Component
- **WU-7**: Rewrite AmbientMusic for Warm Caribbean Feel
- **WU-9**: Create Outline Document — "AI Agent Use Cases"

### Phase 2 — Parallel (requires Phase 1)

- **WU-5**: Rewrite AgentPanel as Terminal Chat Orchestrator
- **WU-8**: Delete WorkMemoryStream

### Phase 3 — Sequential (requires Phase 2)

- **WU-6**: Rewrite Main Composition Assembly

## Recovery Strategy

- **Automatic**: Each implementor rolls back and retries once on failure.
- **Dependency failure**: If a Phase 1 unit fails and blocks a Phase 2/3 unit, the dependent unit will not run. The orchestrator reports skipped units.
- **Global rollback**: `git checkout -- apps/landing/remotion/src/agent-video.tsx apps/landing/remotion/src/agent-video/AgentStage.tsx apps/landing/remotion/src/agent-video/AgentPanel.tsx apps/landing/remotion/src/components/AmbientMusic.tsx` and restore deleted files with `git checkout -- apps/landing/remotion/src/agent-video/WorkMemoryStream.tsx`.
- **Independent failures**: Work units with no dependency on a failed unit will still execute.

## Post-Execution Verification

After all phases complete:
1. `cd apps/landing && npx remotion render remotion/src/index.ts EscribanoAgentMemory /tmp/test-agent.mp4 --frames=0-10`
2. Verify the output file exists and is non-empty.
3. Run `pnpm video:render:agent` to produce the final optimized video.
4. Verify the Outline document "AI Agent Use Cases" exists in collection `escribano-docs-dStKdqSnsc` and is publicly accessible.
