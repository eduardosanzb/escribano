# Implementation Plan: Remotion Demo Redesign

**Date**: 2026-04-30 **Status**: COMPLETED

## Overview

Redesign the Escribano landing page demo video to feel cinematic rather than slide-like. Fix broken image loading, add continuous motion to all elements, overlap scene transitions aggressively, and tighten overall timing from 28s to ~24s.

## Scope

- Work units: 11
- Execution phases: 4
- Files affected:
  - `apps/landing/static/assets/*.png` (copy)
  - `apps/landing/public/assets/*.png` (copy)
  - `apps/landing/remotion/src/motion.ts` (create)
  - `apps/landing/remotion/src/components/Stage.tsx` (create)
  - `apps/landing/remotion/src/scenes/IntroScene.tsx` (create)
  - `apps/landing/remotion/src/scenes/CaptureScene.tsx` (create)
  - `apps/landing/remotion/src/scenes/ConnectScene.tsx` (create)
  - `apps/landing/remotion/src/scenes/AskScene.tsx` (create)
  - `apps/landing/remotion/src/scenes/AnswerScene.tsx` (create)
  - `apps/landing/remotion/src/scenes/OutroScene.tsx` (create)
  - `apps/landing/remotion/src/video.tsx` (rewrite)
  - `apps/landing/remotion/src/root.tsx` (modify)

## Work Units

### WU-1: Copy image assets to correct locations

**Dependencies**: none

**Context**: Remotion's `staticFile()` resolves relative to the `public/` directory at the project root (`apps/landing/`). The image assets currently exist only in `remotion/public/assets/` where Remotion cannot find them during preview. They must also be available in `static/assets/` for Hugo builds.

**Files**:
- `apps/landing/static/assets/*.png` — create
- `apps/landing/public/assets/*.png` — create

**Steps**:
1. Create `apps/landing/static/assets/` if it does not exist.
2. Create `apps/landing/public/assets/` if it does not exist.
3. Copy all four PNG files from `apps/landing/remotion/public/assets/` to both `apps/landing/static/assets/` and `apps/landing/public/assets/`.

**Verification**: `ls -la apps/landing/public/assets/*.png && ls -la apps/landing/static/assets/*.png`

**Rollback**: `rm -rf apps/landing/static/assets apps/landing/public/assets`

---

### WU-2: Create motion utilities

**Dependencies**: none

**Context**: All scenes need shared animation helpers for enter/exit timing, floating motion, parallax, and easing. Extracting these into a shared module keeps scene components clean and ensures consistent motion language.

**Files**:
- `apps/landing/remotion/src/motion.ts` — create

**Steps**:
1. Export `clamp(value: number)` — constrain to [0, 1].
2. Export `soft(value: number)` — smoothstep easing: `x*x*(3-2*x)`.
3. Export `enterExit(frame, enterStart, enterEnd, holdEnd, exitEnd)` — returns 0→1→1→0 progress with soft easing.
4. Export `float(frame, speed, amplitude)` — sine wave offset for continuous floating: `sin(frame/speed) * amplitude`.
5. Export `parallax(frame, speed, amplitude)` — slower sine wave for background layers.
6. Export `continuousZoom(frame, startZoom, endZoom, duration)` — linear zoom from start to end over duration.

**Verification**: `cat apps/landing/remotion/src/motion.ts | grep -c "export"`

**Rollback**: `rm -f apps/landing/remotion/src/motion.ts`

---

### WU-3: Create animated Stage component

**Dependencies**: WU-2

**Context**: The current `Stage` has a static grid and subtle gradient drift. We need richer continuous background motion: drifting grid lines, shifting gradient hotspots, and floating accent particles. This component wraps every scene.

**Files**:
- `apps/landing/remotion/src/components/Stage.tsx` — create

**Steps**:
1. Import `useCurrentFrame` from Remotion and `float`, `parallax` from `../motion`.
2. Keep the same color palette as current `video.tsx` (ink, bg, surface, amber, olive, rust, blue).
3. Render the tile strip at top with `repeating-linear-gradient`.
4. Render a grid background with `opacity` that subtly pulses using `float(frame, 180, 0.08)`.
5. Add two radial gradient overlays whose positions drift slowly using `parallax`:
   - Olive-tinted at upper-right, drifting in a slow circle
   - Amber-tinted at lower-left, drifting in a slow circle
6. Add 3-4 small floating dots (2-3px) in amber/olive/rust that drift in slow Lissajous patterns using `float`.
7. Accept `children` prop and render inside the `AbsoluteFill`.

**Verification**: `cat apps/landing/remotion/src/components/Stage.tsx | grep -c "float\|parallax"`

**Rollback**: `rm -f apps/landing/remotion/src/components/Stage.tsx`

---

### WU-4: Create IntroScene component

**Dependencies**: WU-2, WU-3

**Context**: The intro establishes the brand and product. Currently it shows a terminal typing a query and the brand fading in. We want the terminal to type more dynamically and the brand to appear with a subtle slide, then both start exiting before the scene officially ends (overlapping with Capture).

**Files**:
- `apps/landing/remotion/src/scenes/IntroScene.tsx` — create

**Steps**:
1. Import `Terminal` from `../Terminal`, `SCENES` from `../scenes`, `enterExit`, `float` from `../motion`.
2. Export `IntroScene` accepting `startFrame: number`.
3. Compute `relativeFrame = frame - startFrame`.
4. Use `enterExit(relativeFrame, 0, 30, 90, 120)` for overall scene opacity/transform.
5. Position terminal at right side (x: ~1100, y: ~220) with width 580.
6. Pass `startFrame` to `Terminal` so it types from the beginning of the scene.
7. Add subtle floating motion to the terminal container using `float(relativeFrame, 120, 8)` on the Y offset.
8. Render brand text at left (x: 126, y: 316) with the serif "Escribano" and tagline.
9. Brand opacity uses `enterExit(relativeFrame, 10, 40, 90, 120)` with a slight delay.
10. Both elements should start sliding left as they exit (transform: translateX with negative offset).

**Verification**: `cat apps/landing/remotion/src/scenes/IntroScene.tsx | grep -c "Terminal\|enterExit"`

**Rollback**: `rm -f apps/landing/remotion/src/scenes/IntroScene.tsx`

---

### WU-5: Create CaptureScene component

**Dependencies**: WU-2, WU-3

**Context**: This scene shows the recorder's health UI. Instead of a static screenshot, we add continuous slow zoom, a floating container, and an animated pulse indicator that draws attention to the health status.

**Files**:
- `apps/landing/remotion/src/scenes/CaptureScene.tsx` — create

**Steps**:
1. Import `staticFile`, `Img`, `useCurrentFrame` from Remotion.
2. Import `enterExit`, `float`, `continuousZoom` from `../motion`.
3. Export `CaptureScene` accepting `startFrame: number`.
4. Use `enterExit(relativeFrame, 0, 25, 120, 150)` for overall visibility.
5. Render the health screenshot at x: 710, y: 178, width: 1030.
6. Apply `continuousZoom(relativeFrame, 1, 1.045, 150)` to the screenshot container.
7. Add `float(relativeFrame, 150, 6)` to the screenshot's Y position for subtle bobbing.
8. Render text block at left with eyebrow "Capture", title "The recorder runs quietly.", body text about health/permissions.
9. Text uses `enterExit(relativeFrame, 5, 30, 120, 150)` with staggered delays per line.
10. Add a `Pulse` indicator at the screenshot's upper area that pulses continuously.

**Verification**: `cat apps/landing/remotion/src/scenes/CaptureScene.tsx | grep -c "Img\|continuousZoom"`

**Rollback**: `rm -f apps/landing/remotion/src/scenes/CaptureScene.tsx`

---

### WU-6: Create ConnectScene component

**Dependencies**: WU-2, WU-3

**Context**: Shows agent integrations (Claude Code, Cursor, Codex, etc.). The screenshot slides in from the right while text slides in from the left. Animated connection lines draw between agent icons.

**Files**:
- `apps/landing/remotion/src/scenes/ConnectScene.tsx` — create

**Steps**:
1. Import `staticFile`, `Img`, `useCurrentFrame`, `interpolate` from Remotion.
2. Import `enterExit`, `float` from `../motion`.
3. Export `ConnectScene` accepting `startFrame: number`.
4. Use `enterExit(relativeFrame, 0, 25, 120, 150)` for visibility.
5. Screenshot enters from right: initial x offset of +100 that animates to 0 over first 30 frames.
6. Screenshot at x: 720, y: 178, width: 1050 with `float(relativeFrame, 140, 5)`.
7. Text block at left with eyebrow "Connect", title "Agents learn where to ask.", body text.
8. Text enters from left with staggered delays.
9. Add animated horizontal line below text that draws in using width interpolation from 0 to 290 over frames 40-70.
10. Add small agent icon badges (simple colored circles with initials) that float around the screenshot with different phases.

**Verification**: `cat apps/landing/remotion/src/scenes/ConnectScene.tsx | grep -c "interpolate\|enterExit"`

**Rollback**: `rm -f apps/landing/remotion/src/scenes/ConnectScene.tsx`

---

### WU-7: Create AskScene component

**Dependencies**: WU-2, WU-3

**Context**: Command-line query scene. A terminal types a command, while the query screenshot floats in with slight rotation. The typing animation should feel responsive and the screenshot should have continuous subtle rotation.

**Files**:
- `apps/landing/remotion/src/scenes/AskScene.tsx` — create

**Steps**:
1. Import `Terminal`, `SCENES` from respective modules, `enterExit`, `float` from `../motion`.
2. Import `staticFile`, `Img`, `useCurrentFrame`, `interpolate` from Remotion.
3. Export `AskScene` accepting `startFrame: number`.
4. Use `enterExit(relativeFrame, 0, 25, 120, 150)`.
5. Screenshot at x: 818, y: 128, width: 760 with `float(relativeFrame, 130, 7)` and subtle rotation using `sin(relativeFrame/200) * 0.4` degrees.
6. Terminal component at bottom-left showing a command typing out. Use a new terminal scene or the existing `pipeline` scene.
7. Command text types character by character using `interpolate` over frames 20-90.
8. Blinking cursor after the typed command using `frame % 20 < 10`.
9. Text block at left with eyebrow "Ask", title "Query from the command line.", body text.

**Verification**: `cat apps/landing/remotion/src/scenes/AskScene.tsx | grep -c "Terminal\|interpolate"`

**Rollback**: `rm -f apps/landing/remotion/src/scenes/AskScene.tsx`

---

### WU-8: Create AnswerScene component

**Dependencies**: WU-2, WU-3

**Context**: Shows the answer/artifact output. Screenshot reveals progressively, and a sources card types out key metadata (moments count, confidence, artifact name).

**Files**:
- `apps/landing/remotion/src/scenes/AnswerScene.tsx` — create

**Steps**:
1. Import `staticFile`, `Img`, `useCurrentFrame`, `interpolate` from Remotion.
2. Import `enterExit`, `soft`, `float` from `../motion`.
3. Export `AnswerScene` accepting `startFrame: number`.
4. Use `enterExit(relativeFrame, 0, 25, 120, 150)`.
5. Screenshot at x: 684, y: 120, width: 1100 with `float(relativeFrame, 160, 6)`.
6. Text block at left with eyebrow "Answer", title "Ready to cite.", body text.
7. Sources card at bottom-right with olive/amber/soft text lines.
8. Card opacity uses `enterExit(relativeFrame, 40, 70, 120, 150)` — delayed reveal.
9. Each line in the sources card types out with staggered timing using `interpolate`.

**Verification**: `cat apps/landing/remotion/src/scenes/AnswerScene.tsx | grep -c "Img\|soft"`

**Rollback**: `rm -f apps/landing/remotion/src/scenes/AnswerScene.tsx`

---

### WU-9: Create OutroScene component

**Dependencies**: WU-2, WU-3

**Context**: Final scene with CTA text. Simple but with continuous background motion. Text fades in and holds.

**Files**:
- `apps/landing/remotion/src/scenes/OutroScene.tsx` — create

**Steps**:
1. Import `useCurrentFrame` from Remotion, `enterExit`, `float` from `../motion`.
2. Export `OutroScene` accepting `startFrame: number`.
3. Use `enterExit(relativeFrame, 0, 30, 120, 150)`.
4. Centered text: eyebrow "escribano.work", large serif "Ask your work what happened."
5. Add subtle floating motion to the text container using `float(relativeFrame, 100, 4)`.
6. Add a small animated underline that draws in below the main text.

**Verification**: `cat apps/landing/remotion/src/scenes/OutroScene.tsx | grep -c "enterExit\|float"`

**Rollback**: `rm -f apps/landing/remotion/src/scenes/OutroScene.tsx`

---

### WU-10: Rewrite video.tsx composition

**Dependencies**: WU-3, WU-4, WU-5, WU-6, WU-7, WU-8, WU-9

**Context**: The current `video.tsx` uses `Sequence` components with hard boundaries, creating slide-like cuts. We replace this with simultaneous rendering of all scenes inside the animated `Stage`, where each scene manages its own enter/hold/exit timing. This creates natural overlap and continuous motion.

**Files**:
- `apps/landing/remotion/src/video.tsx` — rewrite

**Steps**:
1. Remove all inline scene components (`Intro`, `Capture`, `Connect`, `Ask`, `Answer`, `Outro`).
2. Remove `Screenshot`, `SceneTitle`, `Pulse`, `Label`, `Brand`, `TileStrip`, `Stage` inline definitions.
3. Import `Stage` from `./components/Stage`.
4. Import all scene components from `./scenes/`.
5. Define the overlapping timeline:
   - `IntroScene`: startFrame=0
   - `CaptureScene`: startFrame=80
   - `ConnectScene`: startFrame=200
   - `AskScene`: startFrame=320
   - `AnswerScene`: startFrame=440
   - `OutroScene`: startFrame=560
6. Render all scenes simultaneously inside `<Stage>`.
7. Each scene's own `enterExit` logic handles visibility, so no `Sequence` wrappers are needed.
8. Keep the `EscribanoDemo` export name for compatibility with `root.tsx`.

**Verification**: `cat apps/landing/remotion/src/video.tsx | grep -c "Scene\|Stage"`

**Rollback**: `git checkout -- apps/landing/remotion/src/video.tsx`

---

### WU-11: Update composition duration

**Dependencies**: WU-10

**Context**: The new timeline ends at frame 710 (Intro 0-120, Capture 80-230, Connect 200-350, Ask 320-470, Answer 440-590, Outro 560-710). Update `root.tsx` to match.

**Files**:
- `apps/landing/remotion/src/root.tsx` — modify

**Steps**:
1. Change `durationInFrames` from 840 to 720.
2. Keep fps=30, width=1920, height=1080.

**Verification**: `grep "durationInFrames" apps/landing/remotion/src/root.tsx`

**Rollback**: `git checkout -- apps/landing/remotion/src/root.tsx`

## Execution Plan

### Phase 1 — Assets (no dependencies)

- WU-1: Copy image assets to correct locations

### Phase 2 — Foundation (parallel, no dependencies)

- WU-2: Create motion utilities
- WU-3: Create animated Stage component

### Phase 3 — Scenes (parallel, requires Phase 2)

- WU-4: Create IntroScene component
- WU-5: Create CaptureScene component
- WU-6: Create ConnectScene component
- WU-7: Create AskScene component
- WU-8: Create AnswerScene component
- WU-9: Create OutroScene component

### Phase 4 — Composition (sequential, requires Phase 3)

- WU-10: Rewrite video.tsx composition
- WU-11: Update composition duration

## Recovery Strategy

- **Automatic**: Each implementor rolls back and retries once on failure.
- **Dependency failure**: If a work unit fails and later units depend on it, those later units will not run. The orchestrator will report which units were skipped.
- **Global rollback**: `git reset HEAD~N --hard` where N is the number of committed work units, or use `git revert` to undo individual WU commits non-destructively.
- **Independent failures**: Work units with no dependency on a failed unit will still execute.
