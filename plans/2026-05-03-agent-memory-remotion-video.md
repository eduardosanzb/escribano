# Implementation Plan: Agent Memory Remotion Video

**Date**: 2026-05-03 **Status**: COMPLETED

## Overview

Create a new Remotion composition for an agent-focused Escribano product video without replacing the current landing demo. The video will use the landing page's dark-mode visual language to show the core loop: a coding agent asks a natural question, calls Escribano, work evidence appears, and the agent answers with receipts.

## Scope

- Work units: 5
- Execution phases: 3
- Files affected:
  - `apps/landing/remotion/src/agent-video/AgentStage.tsx`
  - `apps/landing/remotion/src/agent-video/AgentPanel.tsx`
  - `apps/landing/remotion/src/agent-video/WorkMemoryStream.tsx`
  - `apps/landing/remotion/src/agent-video.tsx`
  - `apps/landing/remotion/src/root.tsx`
  - `apps/landing/package.json`

## Work Units

### WU-1: Create the agent-video visual stage

**Dependencies**: none

**Context**: The new video needs to use the landing page's visual language while staying separate from the current `EscribanoDemo` composition. The current Remotion stage in `apps/landing/remotion/src/components/Stage.tsx` already mirrors the landing CSS dark mode palette: `#E8E9EE`, `#9395A5`, `#5C5F72`, `#0E0F14`, `#15171F`, `#1C1F2B`, `#2A2D3A`, `#E8A838`, `#4A9E7A`, `#B85C38`, and `#314573`. This work unit creates a new stage for the agent-memory composition so the current demo can remain untouched.

**Files**:
- `apps/landing/remotion/src/agent-video/AgentStage.tsx` — create

**Steps**:
1. Create the directory `apps/landing/remotion/src/agent-video/` if it does not already exist.
2. Create `AgentStage.tsx` exporting:
   - `export const AGENT_COLORS` with these exact values:
     - `ink: '#E8E9EE'`
     - `inkSoft: '#9395A5'`
     - `inkMuted: '#5C5F72'`
     - `bg: '#0A0A0F'`
     - `surface: '#15171F'`
     - `elevated: '#1C1F2B'`
     - `line: '#2A2D3A'`
     - `amber: '#E8A838'`
     - `amberLight: '#F0BC5A'`
     - `olive: '#4A9E7A'`
     - `rust: '#B85C38'`
     - `blue: '#314573'`
     - `cream: '#F5F0E8'`
   - `export const AGENT_FONTS` with:
     - `serif: "'Cormorant Garamond', Georgia, serif"`
     - `body: "'Spectral', Georgia, serif"`
     - `sans: "'DM Sans', system-ui, sans-serif"`
     - `mono: "'SF Mono', SFMono-Regular, Menlo, Monaco, monospace"`
   - `export const AgentStage: React.FC<{children: React.ReactNode}>`
   - `export const BrandWordmark: React.FC<{size?: number; centered?: boolean}>`
3. In `AgentStage`, use `AbsoluteFill`, `useCurrentFrame()`, and inline styles only. Do not import CSS files.
4. Copy the self-hosted font loading pattern from the existing `Stage.tsx`, adapting it into an inline `<style>` block. The relevant existing snippet is:
   ```tsx
   const css = String.raw`
   @font-face {
     font-family: 'Cormorant Garamond';
     src: url('/public/fonts/cormorant-garamond-regular.woff2') format('woff2');
     font-weight: 300 600;
   }
   @font-face {
     font-family: 'Spectral';
     src: url('/public/fonts/spectral-light.woff2') format('woff2');
     font-weight: 300;
   }
   @font-face {
     font-family: 'DM Sans';
     src: url('/public/fonts/dm-sans.woff2') format('woff2');
     font-weight: 300 500;
   }
   `;
   ```
5. The stage background must be near-black with subtle landing-style effects:
   - base background: `linear-gradient(180deg, #0A0A0F 0%, #15171F 100%)`
   - two radial glows: amber and olive, slowly drifting based on `useCurrentFrame()`
   - subtle grid overlay using `linear-gradient(rgba(255,255,255,0.022) 1px, transparent 1px)` at `72px 72px`
   - top tile strip matching the landing CSS `tile-strip` idea, using rust/blue/amber/blue repeating segments
   - optional low-opacity grain overlay using the same SVG-noise data URL pattern from `apps/landing/assets/css/style.css` lines 101-109
6. `BrandWordmark` must render `Escrib<span>a</span>no` with only the single `a` colored amber, matching the brand-memory rule. Do not color `ano`.
7. The file must not import from existing scene files. It may import `float` or `parallax` from `../motion`, or define equivalent local frame-based calculations.

**Verification**: `cd apps/landing && pnpm exec tsc -p remotion/tsconfig.json --noEmit`

**Rollback**:
- Created files: `rm -f apps/landing/remotion/src/agent-video/AgentStage.tsx`

---

### WU-2: Create the animated agent panel

**Dependencies**: none

**Context**: The right side of the new video is the product's hero: a generic coding-agent interface inspired by terminal agents, not a literal OpenCode-branded UI. It should show the repeated producer rhythm from the design conversation: prompt, tool call, evidence count, answer. This component must be self-contained so it can be built in parallel with the memory stream.

**Files**:
- `apps/landing/remotion/src/agent-video/AgentPanel.tsx` — create

**Steps**:
1. Create `AgentPanel.tsx` exporting:
   ```ts
   export type AgentPanelMode = 'gap' | 'tool' | 'answer' | 'handoff' | 'morning';
   export const AgentPanel: React.FC<{mode: AgentPanelMode}>;
   ```
2. The component must use `useCurrentFrame()`, `useVideoConfig()`, `interpolate()`, and `spring()` from `remotion` for all animation. Do not use CSS transitions, CSS animations, `setTimeout`, or `useEffect` sequencing.
3. Use inline style objects only. Use the same dark-mode colors and fonts as WU-1; because this work unit is independent, define local constants in this file rather than importing `AgentStage.tsx`.
4. Implement a local typewriter helper inside the file:
   ```ts
   const typeText = (text: string, frame: number, startFrame: number, speed = 2) => {
     const chars = Math.max(0, Math.floor((frame - startFrame) / speed));
     return text.slice(0, chars);
   };
   ```
5. Implement a frame-based blinking cursor using a 32-frame cycle at 60fps. Use a pipe cursor `|` or a block cursor, but calculate opacity from `frame % 32 < 16`.
6. Render a terminal-agent shell positioned for the right 60% of a 1920x1080 frame:
   - absolute left: `760`
   - top: `140`
   - width: `980`
   - min height: `720`
   - border radius: `28`
   - background: `rgba(10,10,15,0.88)`
   - border: `1px solid rgba(255,255,255,0.08)`
   - box shadow: `0 34px 120px rgba(0,0,0,0.55)`
   - header with three macOS dots and title `agent / local context`
7. `mode="gap"` must show:
   - typed prompt: `what was I debugging yesterday around 3pm?`
   - then a muted answer after the prompt completes:
     ```text
     I can see the repo.
     But not what happened yesterday.
     ```
8. `mode="tool"` must show:
   - typed prompt: `what was I debugging yesterday around 3pm?`
   - a tool call block:
     ```text
     · tool: escribano.search({
         when: "yesterday around 3pm",
         intent: "debugging"
       })
     ```
   - a thinking line: `Searching local work memory…`
   - a success line: `✓ 12 observations found`
9. `mode="answer"` must show:
   - prompt and tool summary
   - final answer:
     ```text
     You were debugging a refresh-token bug.

     Evidence:
     • auth/session.ts was edited at 14:32
     • pnpm test auth failed at 14:51
     • NextAuth callback docs opened at 15:02
     • Slack mentions recurring 401s
     ```
10. `mode="handoff"` must show:
    - typed prompt: `write the handoff`
    - answer card:
      ```text
      Handoff:
      Investigated 401s caused by refresh-token expiry.
      Reproduced with pnpm test auth.
      Next: verify retry loop when provider returns 500.
      ```
    - suggested action pills: `Resume debugging`, `Prep standup`, `Recap meeting`
11. `mode="morning"` must show:
    - heading text: `Good morning.`
    - typed prompt: `what should I pick back up?`
    - answer text: `Start with the auth retry loop. You left off after reproducing the failing test.`
12. Use spring entrances for the shell and answer cards: `config: {damping: 15, stiffness: 100}`. Use staggered reveal delays between lines of 18-30 frames at 60fps.

**Verification**: `cd apps/landing && pnpm exec tsc -p remotion/tsconfig.json --noEmit`

**Rollback**:
- Created files: `rm -f apps/landing/remotion/src/agent-video/AgentPanel.tsx`

---

### WU-3: Create the animated work-memory stream

**Dependencies**: none

**Context**: The left side of the video translates Attio's “Every email / and every user record” idea into Escribano's product promise: every file and every work signal. This stream should feel like real local evidence rather than a surveillance dashboard. It must be a self-contained component that can run in parallel with the agent panel work.

**Files**:
- `apps/landing/remotion/src/agent-video/WorkMemoryStream.tsx` — create

**Steps**:
1. Create `WorkMemoryStream.tsx` exporting:
   ```ts
   export type WorkMemoryMode = 'empty' | 'searching' | 'files' | 'signals' | 'receipts' | 'morning';
   export const WorkMemoryStream: React.FC<{mode: WorkMemoryMode}>;
   ```
2. The component must use `useCurrentFrame()`, `useVideoConfig()`, `interpolate()`, and `spring()` from `remotion` for all animation. Do not use CSS transitions, CSS animations, `setTimeout`, or `useEffect` sequencing.
3. Use inline style objects only. Use the same dark-mode colors and fonts as WU-1; because this work unit is independent, define local constants in this file rather than importing `AgentStage.tsx`.
4. Position the stream for the left 40% of a 1920x1080 frame:
   - absolute left: `120`
   - top: `150`
   - width: `560`
   - bottom-safe layout so cards do not leave the frame
5. `mode="empty"` must show a muted label `Work memory` and a faint line `Waiting for an agent tool call.`
6. `mode="searching"` must show the label `Work memory` and a pulsing line `Searching local context…`.
7. `mode="files"` must show the large heading `Every file` and stagger in exactly these evidence cards:
   - `14:32` / `VS Code` / `auth/session.ts` / `Edited refresh-token branch`
   - `14:41` / `VS Code` / `middleware.ts` / `Traced 401 retry path`
   - `14:48` / `VS Code` / `refresh-token.test.ts` / `Added failing regression case`
8. `mode="signals"` must show the large heading `and every signal` and include the file cards plus these signal cards:
   - `14:51` / `Terminal` / `pnpm test auth` / `Failing refresh-token test`
   - `15:02` / `Browser` / `NextAuth callback docs` / `Opened provider callback reference`
   - `15:08` / `Slack` / `"still seeing 401 after refresh"` / `Team thread confirms repro`
   - `15:16` / `Meeting` / `retry loop might be provider-side` / `Transcript note captured`
9. `mode="receipts"` must show the same evidence cards in a condensed stack and pulse 3-4 of them with amber/olive outlines to visually link to the answer citations.
10. `mode="morning"` must show a priority card with:
    - heading: `Pick back up`
    - items:
      1. `Verify auth retry loop`
      2. `Re-run failing test`
      3. `Update PR notes`
      4. `Follow up in Slack thread`
11. Cards must stack from bottom to top or slide in from the left with 15-24 frame stagger. Use directional motion to imply accumulating context.
12. Keep the screen uncluttered: no more than one large heading and 7 cards visible at peak. If needed, reduce card height or condense older cards in `signals` mode.

**Verification**: `cd apps/landing && pnpm exec tsc -p remotion/tsconfig.json --noEmit`

**Rollback**:
- Created files: `rm -f apps/landing/remotion/src/agent-video/WorkMemoryStream.tsx`

---

### WU-4: Assemble the Agent Memory composition

**Dependencies**: WU-1, WU-2, WU-3

**Context**: The new video should be a separate composition that can be previewed and rendered independently from the existing landing demo. It should use explicit `<Sequence>` timing at 60fps, follow the “Prompt → Escribano searches → evidence appears → agent answers” arc, and stay around 30 seconds for LinkedIn-style pacing.

**Files**:
- `apps/landing/remotion/src/agent-video.tsx` — create

**Steps**:
1. Create `agent-video.tsx` exporting `export const EscribanoAgentMemory: React.FC = () => { ... }`.
2. Import `React`, `Sequence`, `interpolate`, and `useCurrentFrame` from `remotion` as needed.
3. Import the existing generated audio component:
   ```ts
   import {AmbientMusic} from './components/AmbientMusic';
   ```
   Include `<AmbientMusic />` inside the stage so the new render script has an audio track like the current demo. Do not create new audio assets.
4. Import the new components:
   ```ts
   import {AgentStage, BrandWordmark} from './agent-video/AgentStage';
   import {AgentPanel} from './agent-video/AgentPanel';
   import {WorkMemoryStream} from './agent-video/WorkMemoryStream';
   ```
5. Use these exact timing constants:
   ```ts
   const FPS = 60;
   export const AGENT_MEMORY_DURATION = 1800;
   const SCENES = {
     gap: {from: 0, duration: 240},
     tool: {from: 240, duration: 240},
     files: {from: 480, duration: 300},
     signals: {from: 780, duration: 300},
     answer: {from: 1080, duration: 300},
     handoff: {from: 1380, duration: 240},
     morning: {from: 1620, duration: 180},
   } as const;
   ```
6. Compose with explicit `<Sequence from={...} durationInFrames={...}>` blocks. Each sequence should render both the agent panel and memory stream for that beat:
   - `gap`: `<AgentPanel mode="gap" />` and `<WorkMemoryStream mode="empty" />`
   - `tool`: `<AgentPanel mode="tool" />` and `<WorkMemoryStream mode="searching" />`
   - `files`: `<AgentPanel mode="tool" />` and `<WorkMemoryStream mode="files" />`
   - `signals`: `<AgentPanel mode="tool" />` and `<WorkMemoryStream mode="signals" />`
   - `answer`: `<AgentPanel mode="answer" />` and `<WorkMemoryStream mode="receipts" />`
   - `handoff`: `<AgentPanel mode="handoff" />` and `<WorkMemoryStream mode="receipts" />`
   - `morning`: `<AgentPanel mode="morning" />` and `<WorkMemoryStream mode="morning" />`
7. During the final `morning` scene, add a centered or bottom-center brand lockup using `BrandWordmark` plus the tagline `Memory for AI agents.`. It should fade in after frame 90 of the final sequence.
8. Do not modify the existing `apps/landing/remotion/src/video.tsx` current demo composition.
9. Do not import external assets or external video files.

**Verification**: `cd apps/landing && pnpm exec tsc -p remotion/tsconfig.json --noEmit`

**Rollback**:
- Created files: `rm -f apps/landing/remotion/src/agent-video.tsx`

---

### WU-5: Register and add render script for the new composition

**Dependencies**: WU-4

**Context**: Remotion supports multiple `<Composition>` entries in the root component. The current `Root` only registers `EscribanoDemo`, and the current render script only renders that existing composition. This work unit registers the new 60fps composition and adds a separate render command so the existing landing video remains unchanged until the new one is explicitly rendered.

**Files**:
- `apps/landing/remotion/src/root.tsx` — modify
- `apps/landing/package.json` — modify

**Steps**:
1. In `apps/landing/remotion/src/root.tsx`, preserve the existing `EscribanoDemo` import and composition exactly. The current file is:
   ```tsx
   import React from 'react';
   import {Composition} from 'remotion';
   import {EscribanoDemo} from './video';

   export const Root: React.FC = () => {
     return (
       <Composition
         id="EscribanoDemo"
         component={EscribanoDemo}
         durationInFrames={1080}
         fps={30}
         width={1920}
         height={1080}
       />
     );
   };
   ```
2. Add an import:
   ```ts
   import {AGENT_MEMORY_DURATION, EscribanoAgentMemory} from './agent-video';
   ```
3. Change `Root` to return a React fragment with both compositions. Keep the existing composition unchanged and add:
   ```tsx
   <Composition
     id="EscribanoAgentMemory"
     component={EscribanoAgentMemory}
     durationInFrames={AGENT_MEMORY_DURATION}
     fps={60}
     width={1920}
     height={1080}
   />
   ```
4. In `apps/landing/package.json`, preserve all existing scripts and dependencies. Add a new script named `video:render:agent` after the existing `video:render` script.
5. Use this exact command for the new script:
   ```json
   "video:render:agent": "remotion render remotion/src/index.ts EscribanoAgentMemory static/video/escribano-agent-memory.remotion.mp4 --codec=h264 --pixel-format=yuv420p --crf=18 && ffmpeg -y -i static/video/escribano-agent-memory.remotion.mp4 -vf scale=in_range=pc:out_range=tv,format=yuv420p -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -color_primaries bt709 -color_trc bt709 -colorspace bt709 -c:a aac -b:a 192k -movflags +faststart static/video/escribano-agent-memory.mp4"
   ```
6. Do not change the existing `video:render` script target (`EscribanoDemo`).
7. Do not install `@remotion/google-fonts`; this plan uses the existing self-hosted fonts.

**Verification**: `cd apps/landing && pnpm exec tsc -p remotion/tsconfig.json --noEmit && pnpm exec remotion render remotion/src/index.ts EscribanoAgentMemory /tmp/escribano-agent-memory-smoke.mp4 --frames=0-3 --codec=h264 --pixel-format=yuv420p`

**Rollback**:
- Modified files: `git checkout -- apps/landing/remotion/src/root.tsx apps/landing/package.json`

## Execution Plan

### Phase 1 — Parallel (no dependencies)

- WU-1: Create the agent-video visual stage
- WU-2: Create the animated agent panel
- WU-3: Create the animated work-memory stream

### Phase 2 — Sequential (requires Phase 1)

- WU-4: Assemble the Agent Memory composition

### Phase 3 — Sequential (requires Phase 2)

- WU-5: Register and add render script for the new composition

## Recovery Strategy

- **Automatic**: Each implementor rolls back and retries once on failure.
- **Dependency failure**: If any Phase 1 component fails, WU-4 will not run because the composition depends on all three new components. If WU-4 fails, WU-5 will not run because the root composition would import a missing file.
- **Global rollback**: `rm -rf apps/landing/remotion/src/agent-video apps/landing/remotion/src/agent-video.tsx && git checkout -- apps/landing/remotion/src/root.tsx apps/landing/package.json`
- **Independent failures**: WU-1, WU-2, and WU-3 are independent and can be retried separately.
- **Primary verification**: After all work units complete, run `cd apps/landing && pnpm exec tsc -p remotion/tsconfig.json --noEmit && pnpm exec remotion render remotion/src/index.ts EscribanoAgentMemory /tmp/escribano-agent-memory-smoke.mp4 --frames=0-3 --codec=h264 --pixel-format=yuv420p`.

## Notes and Risks

- The existing working tree already contains unrelated modified/untracked landing and Remotion files. Implementors must only touch files listed in their assigned work unit.
- The current project uses local self-hosted fonts rather than `@remotion/google-fonts`. This avoids adding a new dependency and follows the existing landing/Remotion pattern.
- No external alternatives scan was performed because the user explicitly requested a Remotion implementation under `apps/landing/remotion/`, and Remotion is already installed and used in this app. Approval of this plan confirms the Remotion choice.
- `staticFile()` docs recommend assets live in the package-level `public/` folder, but this plan does not add new assets. Font loading follows the existing `Stage.tsx` pattern used by the current Remotion video.
- The smoke render uses only frames `0-3`; it verifies composition registration and renderability, not the full 30-second pacing. Full creative QA should happen in Remotion Studio with `cd apps/landing && pnpm video:preview`.
