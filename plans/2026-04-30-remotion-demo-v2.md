# Implementation Plan: Remotion Demo — Enhanced Animations, Music, and Copy Alignment

**Date**: 2026-04-30 **Status**: COMPLETED

## Overview

Enhance the Escribano demo video with: (1) copywriting that matches the landing page exactly, (2) dramatically more animations — word-by-word text reveals, particle effects, glow accents, and cinematic entrances, (3) generated ambient background music, and (4) increased spacing between scenes for better breathing room.

## Scope

- Work units: 9
- Execution phases: 3
- Files affected:
  - `apps/landing/remotion/src/scenes/IntroScene.tsx` — rewrite
  - `apps/landing/remotion/src/scenes/CaptureScene.tsx` — rewrite
  - `apps/landing/remotion/src/scenes/ConnectScene.tsx` — rewrite
  - `apps/landing/remotion/src/scenes/AskScene.tsx` — rewrite
  - `apps/landing/remotion/src/scenes/AnswerScene.tsx` — rewrite
  - `apps/landing/remotion/src/scenes/OutroScene.tsx` — rewrite
  - `apps/landing/remotion/src/components/Stage.tsx` — modify
  - `apps/landing/remotion/src/components/AmbientMusic.tsx` — create
  - `apps/landing/remotion/src/components/TextReveal.tsx` — create
  - `apps/landing/remotion/src/video.tsx` — modify
  - `apps/landing/remotion/src/root.tsx` — modify

## Work Units

### WU-1: Enhance IntroScene — landing page copy + word-by-word reveal

**Dependencies**: none

**Context**: The intro must match the landing page hero exactly: "Local evidence layer" eyebrow and "Your work, queryable by any agent." tagline. Add a word-by-word text reveal animation for the tagline, and make the terminal float more dramatically.

**Files**:
- `apps/landing/remotion/src/scenes/IntroScene.tsx` — rewrite

**Steps**:
1. Keep the same imports (Terminal, SCENES, enterExit, float, useCurrentFrame).
2. Create a `WordReveal` helper inside the file: accepts `{text: string, frame: number, startFrame: number, delayPerWord: number}`. Splits text by spaces, reveals each word with opacity 0→1 using `soft((frame - startFrame - i * delayPerWord) / 15)` where `soft` is imported from `../motion`.
3. Update eyebrow text from "Local-first work memory" to "Local evidence layer".
4. Update tagline from "Private memory for agentic work." to "Your work, queryable by any agent." — render using `WordReveal` with `delayPerWord={8}` starting at frame 40.
5. Keep "Escribano" brand with amber "ano" — add a subtle glow effect: `textShadow: '0 0 40px rgba(232,168,56,0.15)'`.
6. Terminal should float with a more noticeable motion: `float(relativeFrame, 90, 12)` on Y.
7. Add a subtle exit: as the scene fades out (frames 90-120), both brand and terminal should scale down slightly: `scale(${0.95 + 0.05 * progress})`.

**Verification**: `cat apps/landing/remotion/src/scenes/IntroScene.tsx | grep -c "WordReveal\|Local evidence layer"`

**Rollback**: `git checkout -- apps/landing/remotion/src/scenes/IntroScene.tsx`

---

### WU-2: Enhance CaptureScene — landing page copy + dramatic entrance + glow

**Dependencies**: none

**Context**: Match the landing page "How it works" section: "Capture, quietly" with the description about the menu-bar app. Add a dramatic slide-in entrance for the screenshot from below, and a glow pulse around the health indicator.

**Files**:
- `apps/landing/remotion/src/scenes/CaptureScene.tsx` — rewrite

**Steps**:
1. Update eyebrow to "Capture" (keep).
2. Update title from "The recorder runs quietly." to "Capture, quietly".
3. Update body text to: "A small menu-bar app watches your screen in the background. Repeats are skipped, nothing is uploaded, and you can pause it whenever you want."
4. Add dramatic screenshot entrance: instead of just fading in, the screenshot should slide up from `translateY(80px)` to `translateY(0)` over frames 0-40, while also scaling from 0.92 to 1.0.
5. Add a glow ring around the Pulse indicator: use a second larger div with `boxShadow: '0 0 0 ${p * 60}px rgba(74,158,122,${0.1 * (1 - p)})'` for a softer outer glow.
6. Text should reveal word-by-word for the title (delay 6 frames per word) and line-by-line for the body.
7. Keep continuous zoom and float on the screenshot.

**Verification**: `cat apps/landing/remotion/src/scenes/CaptureScene.tsx | grep -c "Capture, quietly\|translateY"`

**Rollback**: `git checkout -- apps/landing/remotion/src/scenes/CaptureScene.tsx`

---

### WU-3: Enhance ConnectScene — rename to Understand + animated connections

**Dependencies**: none

**Context**: This scene should match "Understand, on-device" from the landing page. The connection line should draw in progressively. The agent badges should have a more interesting entrance — scaling in with a spring-like bounce.

**Files**:
- `apps/landing/remotion/src/scenes/ConnectScene.tsx` — rewrite

**Steps**:
1. Update eyebrow from "Connect" to "Understand".
2. Update title from "Agents learn where to ask." to "Understand, on-device".
3. Update body text to: "Each moment is turned into a short, plain-language description of what you were doing — the tools, the files, the context. All of it stays on your machine."
4. The animated underline should now be a vertical "connection line" that draws downward: height interpolates from 0 to 120px over frames 50-90, positioned to the right of the text block.
5. Agent badges should enter with a spring-like overshoot: scale from 0 to 1.15 to 1.0 over frames 40-70 using a custom easing: `const bounce = t => { const c = 1.70158; return t * t * ((c + 1) * t - c); }` (backOut easing).
6. Screenshot should rotate slightly during entrance: from `rotate(-2deg)` to `rotate(0deg)` over frames 0-40.
7. Add a subtle "scan line" effect over the screenshot: a thin horizontal line (1px, rgba(255,255,255,0.1)) that moves down the screenshot using `translateY` over a 3-second cycle.

**Verification**: `cat apps/landing/remotion/src/scenes/ConnectScene.tsx | grep -c "Understand, on-device\|scan line"`

**Rollback**: `git checkout -- apps/landing/remotion/src/scenes/ConnectScene.tsx`

---

### WU-4: Enhance AskScene — landing page copy + realistic typing + cursor trail

**Dependencies**: none

**Context**: Match "Query, on your terms" from the landing page. Make the typing animation more realistic with variable speed and a trailing cursor effect.

**Files**:
- `apps/landing/remotion/src/scenes/AskScene.tsx` — rewrite

**Steps**:
1. Update eyebrow from "Ask" to "Query".
2. Update title from "Query from the command line." to "Query, on your terms".
3. Update body text to: "Ask your agent — or the command line directly — what you were working on. Escribano returns the evidence, cleanly structured, ready to cite."
4. Make typing more realistic: instead of linear character progression, use variable speeds:
   - Fast for short words (3-4 chars): 2 frames per char
   - Slow for thinking between words: 8-10 frames pause
   - Medium for longer flags: 3 frames per char
   - Implement as a lookup that returns chars visible at a given frame, with pauses after each word.
5. Add a cursor trail: behind the blinking cursor, show a faint ghost of the cursor at `opacity: 0.15` offset by 2px to the left.
6. Screenshot should enter from the right: `translateX(60px)` to `translateX(0)` over frames 0-35, combined with `rotate(1deg)` to `rotate(0.4deg)`.
7. Add "command suggestion" hints that appear faintly (opacity 0.25) above the typing area, suggesting what the user might type next.

**Verification**: `cat apps/landing/remotion/src/scenes/AskScene.tsx | grep -c "Query, on your terms\|cursor trail"`

**Rollback**: `git checkout -- apps/landing/remotion/src/scenes/AskScene.tsx`

---

### WU-5: Enhance AnswerScene — staggered reveals + source glow

**Dependencies**: none

**Context**: Keep "Ready to cite." but enhance the sources card with a more dramatic staggered reveal and add a glow effect to the artifact line.

**Files**:
- `apps/landing/remotion/src/scenes/AnswerScene.tsx` — rewrite

**Steps**:
1. Keep eyebrow "Answer" and title "Ready to cite." — these work well.
2. Update body text to: "Moments, timestamps, entities, and source context come back clean enough for an agent to use."
3. Sources card should reveal with a cascade: each line slides up from `translateY(10px)` while fading in, with 12-frame stagger between lines.
4. The artifact line ("artifact: answer.md") should have a pulsing amber glow: `textShadow: '0 0 20px rgba(232,168,56,${0.3 + 0.2 * Math.sin(frame / 20)})'`.
5. Screenshot should have a "focus" effect: a subtle vignette overlay that darkens the edges, drawing attention to the center.
6. Add a "confidence meter" — a thin horizontal bar next to "confidence: local evidence" that fills from 0% to 100% over frames 70-110, in olive color.

**Verification**: `cat apps/landing/remotion/src/scenes/AnswerScene.tsx | grep -c "confidence meter\|textShadow"`

**Rollback**: `git checkout -- apps/landing/remotion/src/scenes/AnswerScene.tsx`

---

### WU-6: Enhance OutroScene — dramatic entrance + particle burst

**Dependencies**: none

**Context**: The outro is the final impression. Make it more cinematic with a dramatic text entrance and a burst of particles.

**Files**:
- `apps/landing/remotion/src/scenes/OutroScene.tsx` — rewrite

**Steps**:
1. Keep "escribano.work" eyebrow and "Ask your work what happened." main text.
2. Add dramatic entrance: text should scale from 0.8 to 1.0 while fading in, with a slight overshoot (scale to 1.03 then settle to 1.0) over frames 0-50.
3. The underline should draw in from center outward: use a container with `overflow: hidden`, and animate the inner element's width from 0 to 200px while keeping it centered.
4. Add a "particle burst" — 8 small dots that radiate outward from the center of the text at frame 30, then slowly drift and fade. Each particle has a random angle and speed.
5. Add a subtle background glow that pulses behind the text: a large radial gradient (400px) centered on the text that pulses between opacity 0.05 and 0.15.
6. Add the CTA "escribano.work" with a subtle hover-like effect: on frame 80+, it gently bounces up and down.

**Verification**: `cat apps/landing/remotion/src/scenes/OutroScene.tsx | grep -c "particle\|overshoot"`

**Rollback**: `git checkout -- apps/landing/remotion/src/scenes/OutroScene.tsx`

---

### WU-7: Enhance Stage with particle system

**Dependencies**: none

**Context**: The background needs more life. Add a particle system with 15-20 small dots that drift slowly across the screen at different speeds and depths, creating a sense of depth and motion.

**Files**:
- `apps/landing/remotion/src/components/Stage.tsx` — modify

**Steps**:
1. Add a `Particle` subcomponent: accepts `{frame, x, y, size, speedX, speedY, opacity, color}`.
   - Position drifts: `left = (x + frame * speedX) % 1920`, `top = (y + frame * speedY) % 1080`.
   - If the particle goes off-screen, it wraps around.
   - Size varies slightly with sine wave: `size * (0.8 + 0.2 * Math.sin(frame / 60))`.
2. Add 15-20 particles with varied properties:
   - Sizes: 1-3px
   - Colors: amber, olive, rust, blue (at low opacity 0.15-0.35)
   - Speeds: 0.1-0.5 px/frame in both X and Y
   - Starting positions: random across the 1920x1080 canvas
3. Keep all existing Stage elements (gradients, grid, tile strip, floating dots).
4. Particles should render behind the grid overlay so they don't distract from content.

**Verification**: `cat apps/landing/remotion/src/components/Stage.tsx | grep -c "Particle\|particle"`

**Rollback**: `git checkout -- apps/landing/remotion/src/components/Stage.tsx`

---

### WU-8: Add ambient background music

**Dependencies**: none

**Context**: Add a procedurally generated ambient music track using Remotion's Web Audio API support. This avoids needing an external music file. The track will be a calm, atmospheric drone that fits the dark, technical aesthetic.

**Files**:
- `apps/landing/remotion/src/components/AmbientMusic.tsx` — create
- `apps/landing/remotion/src/video.tsx` — modify

**Steps**:
1. Create `AmbientMusic.tsx`:
   - Import `Html5Audio`, `useVideoConfig`, `delayRender`, `continueRender`, `cancelRender`, `interpolate` from 'remotion'.
   - Import `audioBufferToDataUrl` from '@remotion/media-utils'.
   - Use `useState` with `delayRender()` to block rendering until audio is generated.
   - In `useEffect`, create an `OfflineAudioContext` with:
     - `numberOfChannels: 2`
     - `sampleRate: 44100`
     - `length: sampleRate * (durationInFrames / fps)`
   - Create 4 oscillators at consonant frequencies (e.g., 130.81 Hz = C3, 196.00 Hz = G3, 261.63 Hz = C4, 329.63 Hz = E4) with `sine` type.
   - Connect each oscillator through a gain node.
   - Apply slow amplitude modulation to each gain node using `setValueAtTime` / `linearRampToValueAtTime`:
     - Oscillator 1: volume oscillates between 0.05 and 0.15 over 8 seconds
     - Oscillator 2: volume oscillates between 0.03 and 0.12 over 11 seconds  
     - Oscillator 3: volume oscillates between 0.02 and 0.08 over 7 seconds
     - Oscillator 4: volume oscillates between 0.01 and 0.06 over 13 seconds
   - Add a master low-pass filter at 800 Hz to keep it mellow.
   - Start all oscillators, render with `offlineContext.startRendering()`, convert to data URL with `audioBufferToDataUrl()`, and call `continueRender()`.
   - Return `<Html5Audio src={audioBuffer} volume={(f) => interpolate(f, [0, 60, durationInFrames - 60, durationInFrames], [0, 0.25, 0.25, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})} />` — fades in over 2s, holds at 25% volume, fades out over 2s.
2. Modify `video.tsx`:
   - Import `AmbientMusic` from `./components/AmbientMusic`.
   - Add `<AmbientMusic />` inside `<Stage>` before all scenes.
3. Add `@remotion/media-utils` to package.json dependencies if not present.

**Verification**: `cat apps/landing/remotion/src/components/AmbientMusic.tsx | grep -c "OfflineAudioContext\|audioBufferToDataUrl"`

**Rollback**:
- `rm -f apps/landing/remotion/src/components/AmbientMusic.tsx`
- `git checkout -- apps/landing/remotion/src/video.tsx`

---

### WU-9: Adjust timeline spacing and duration

**Dependencies**: WU-1, WU-2, WU-3, WU-4, WU-5, WU-6, WU-8

**Context**: Increase spacing between scenes from ~20 frames to 30 frames (1 second), giving each scene more breathing room. Extend total duration to accommodate.

**Files**:
- `apps/landing/remotion/src/video.tsx` — modify
- `apps/landing/remotion/src/root.tsx` — modify

**Steps**:
1. In `video.tsx`, update `startFrame` values:
   - `IntroScene`: 0
   - `CaptureScene`: 150 (was 80)
   - `ConnectScene`: 360 (was 200)
   - `AskScene`: 570 (was 320)
   - `AnswerScene`: 780 (was 440)
   - `OutroScene`: 990 (was 560)
   This gives 30-frame (1s) gaps between each scene.
2. In `root.tsx`, update `durationInFrames` from 720 to 1080 (36 seconds).

**Verification**: `grep -E "durationInFrames|startFrame" apps/landing/remotion/src/video.tsx apps/landing/remotion/src/root.tsx`

**Rollback**:
- `git checkout -- apps/landing/remotion/src/video.tsx apps/landing/remotion/src/root.tsx`

## Execution Plan

### Phase 1 — Scene enhancements (parallel, no dependencies)

- WU-1: Enhance IntroScene
- WU-2: Enhance CaptureScene
- WU-3: Enhance ConnectScene
- WU-4: Enhance AskScene
- WU-5: Enhance AnswerScene
- WU-6: Enhance OutroScene

### Phase 2 — Infrastructure (parallel, no dependencies)

- WU-7: Enhance Stage with particles
- WU-8: Add ambient background music

### Phase 3 — Timeline (sequential, requires Phase 1 + Phase 2)

- WU-9: Adjust timeline spacing and duration

## Recovery Strategy

- **Automatic**: Each implementor rolls back and retries once on failure.
- **Dependency failure**: If a work unit fails and later units depend on it, those later units will not run. The orchestrator will report which units were skipped.
- **Global rollback**: `git reset HEAD~N --hard` where N is the number of committed work units, or use `git revert` to undo individual WU commits non-destructively.
- **Independent failures**: Work units with no dependency on a failed unit will still execute.
