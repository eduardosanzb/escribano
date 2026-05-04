# Implementation Plan: LinkedIn Video Format (4:5 Responsive)

**Date**: 2026-05-04 **Status**: COMPLETED

## Overview

Add a new Remotion composition optimized for LinkedIn's best-performing feed format: 1080×1350 pixels (4:5 aspect ratio). Instead of duplicating the panel layout, we make the existing mobile portrait panel responsive to canvas height so it automatically adapts to both 9:16 (mobile/Reels) and 4:5 (LinkedIn) from the same component. A new composition is registered in `root.tsx` and a render script is added to `package.json`.

## Scope

- Work units: 2
- Execution phases: 1 (parallel — no dependencies)
- Files affected:
  - `apps/landing/remotion/src/agent-video/AgentPanelMobile.tsx`
  - `apps/landing/remotion/src/root.tsx`
  - `apps/landing/package.json`

## Work Units

### WU-1: Make AgentPanelMobile Responsive to Portrait Canvas Size

**Dependencies**: none

**Context**: The `AgentPanelMobile` component hardcodes layout dimensions (`width: 1080`, `height: 1920`, `marginLeft: 70`, `paddingTop: 120`, scroll distance `1200px`) for a 1080×1920 canvas. We need these values to scale proportionally with the actual canvas dimensions from `useVideoConfig()` so the same component renders correctly on both 9:16 mobile (1080×1920) and 4:5 LinkedIn (1080×1350) without duplication. The child components (`ChatMessage`, `ThinkingBlock`, `AnswerBlock`, `MiniCliCall`, `DocumentDraft`, `LogoLockup`) are layout-agnostic and require no changes.

**Files**:
- `apps/landing/remotion/src/agent-video/AgentPanelMobile.tsx` — modify

**Steps**:
1. Add `useVideoConfig` to the existing `remotion` import line. The current import is:
   ```tsx
   import {useCurrentFrame, interpolate, Easing} from 'remotion';
   ```
   Change it to:
   ```tsx
   import {useCurrentFrame, useVideoConfig, interpolate, Easing} from 'remotion';
   ```

2. Inside the `AgentPanelMobile` component, after the existing line `const frame = useCurrentFrame();`, add:
   ```tsx
   const {width, height} = useVideoConfig();
   ```

3. Replace the hardcoded `width: 1080` and `height: 1920` in the outer container div with the dynamic `width` and `height` values. The current outer container (lines 51–59) is:
   ```tsx
   <div
     style={{
       position: 'absolute',
       left: 0,
       top: 0,
       width: 1080,
       height: 1920,
       opacity: panelOpacity,
     }}
   >
   ```
   Change `width: 1080` → `width` and `height: 1920` → `height`.

4. Replace the hardcoded inner content dimensions with proportional values derived from `width` and `height`. The current inner div (lines 61–69) is:
   ```tsx
   <div
     style={{
       width: 940,
       marginLeft: 70,
       paddingTop: 120,
       paddingBottom: 120,
       transform: `translateY(${-scrollOffset}px)`,
       opacity: chatFadeOut,
     }}
   >
   ```
   Replace with:
   ```tsx
   <div
     style={{
       width: Math.round(width * 0.87),
       marginLeft: Math.round(width * 0.065),
       paddingTop: Math.round(height * 0.063),
       paddingBottom: Math.round(height * 0.063),
       transform: `translateY(${-scrollOffset}px)`,
       opacity: chatFadeOut,
     }}
   >
   ```

5. Replace the hardcoded scroll distance. The current line (line 48) is:
   ```tsx
   const scrollOffset = scrollProgress * 1200;
   ```
   Replace with:
   ```tsx
   const scrollOffset = scrollProgress * Math.round(height * 0.625);
   ```

6. Leave all frame-based timing unchanged (`promptStart`, `thinkingStart`, `answerStart`, `docPromptStart`, `miniCliStart`, `documentStart`, `logoStart`, `chatFadeOut` interpolation ranges, and `scrollProgress` interpolation ranges) because animation timing is independent of canvas size.

**Verification**: `cd apps/landing/remotion && npx tsc --noEmit`

**Rollback**:
- Modified file: `git checkout -- apps/landing/remotion/src/agent-video/AgentPanelMobile.tsx`

---

### WU-2: Register LinkedIn Composition and Add Render Script

**Dependencies**: none

**Context**: After WU-1 makes the panel responsive, we register a new Remotion composition with LinkedIn dimensions (1080×1350) that reuses the existing `EscribanoAgentMemoryMobile` component. We also add a `pnpm video:render:linkedin` script to `package.json` and update the `video:render:all` script to include it.

**Files**:
- `apps/landing/remotion/src/root.tsx` — modify
- `apps/landing/package.json` — modify

**Steps**:
1. In `root.tsx`, add a new `<Composition>` entry immediately after the `EscribanoAgentMemoryMobile` composition and before the closing `</>`. The current last composition in the file is:
   ```tsx
   <Composition
     id="EscribanoAgentMemoryMobile"
     component={EscribanoAgentMemoryMobile}
     durationInFrames={AGENT_MEMORY_DURATION_MOBILE}
     fps={60}
     width={1080}
     height={1920}
   />
   ```
   Insert after it:
   ```tsx
   <Composition
     id="EscribanoAgentMemoryLinkedIn"
     component={EscribanoAgentMemoryMobile}
     durationInFrames={AGENT_MEMORY_DURATION_MOBILE}
     fps={60}
     width={1080}
     height={1350}
   />
   ```

2. In `package.json`, add a new script entry between `video:render:mobile` and `video:render:all`. The current relevant scripts are:
   ```json
   "video:render:mobile": "pnpm video:render EscribanoAgentMemoryMobile static/video/escribano-agent-memory-mobile.mp4 --codec=h264 --crf=18",
   "video:render:all": "pnpm video:render:desktop & pnpm video:render:mobile"
   ```
   Change them to:
   ```json
   "video:render:mobile": "pnpm video:render EscribanoAgentMemoryMobile static/video/escribano-agent-memory-mobile.mp4 --codec=h264 --crf=18",
   "video:render:linkedin": "pnpm video:render EscribanoAgentMemoryLinkedIn static/video/escribano-agent-memory-linkedin.mp4 --codec=h264 --crf=18",
   "video:render:all": "pnpm video:render:desktop & pnpm video:render:mobile & pnpm video:render:linkedin"
   ```

**Verification**: `cd apps/landing/remotion && npx tsc --noEmit`

**Rollback**:
- Modified files: `git checkout -- apps/landing/remotion/src/root.tsx apps/landing/package.json`

## Execution Plan

### Phase 1 — Parallel (no dependencies)

- WU-1: Make AgentPanelMobile responsive for portrait canvases
- WU-2: Register LinkedIn composition and add render script

## Recovery Strategy

- **Automatic**: Each implementor rolls back and retries once on failure.
- **Dependency failure**: Not applicable — both units are independent.
- **Global rollback**: `git checkout -- apps/landing/remotion/src/agent-video/AgentPanelMobile.tsx apps/landing/remotion/src/root.tsx apps/landing/package.json`
- **Independent failures**: A failure in one unit does not block the other.

## Post-execution

After both work units succeed, render the LinkedIn video with:
```bash
cd apps/landing && pnpm video:render:linkedin
```

The output will be at `apps/landing/static/video/escribano-agent-memory-linkedin.mp4`.
