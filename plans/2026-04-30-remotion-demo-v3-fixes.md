# Implementation Plan: Fix Text Timing and Audio Quality

**Date**: 2026-04-30 **Status**: COMPLETED

## Overview

Fix two issues: (1) body text is too long to read in the time given, and transitions are too tight, (2) the procedurally generated audio sounds weird. Shorten all copy, increase scene hold times, and redesign the audio with richer waveforms.

## Scope

- Work units: 9
- Execution phases: 2
- Files affected:
  - `apps/landing/remotion/src/scenes/IntroScene.tsx` — modify
  - `apps/landing/remotion/src/scenes/CaptureScene.tsx` — modify
  - `apps/landing/remotion/src/scenes/ConnectScene.tsx` — modify
  - `apps/landing/remotion/src/scenes/AskScene.tsx` — modify
  - `apps/landing/remotion/src/scenes/AnswerScene.tsx` — modify
  - `apps/landing/remotion/src/scenes/OutroScene.tsx` — modify
  - `apps/landing/remotion/src/components/AmbientMusic.tsx` — rewrite
  - `apps/landing/remotion/src/video.tsx` — modify
  - `apps/landing/remotion/src/root.tsx` — modify

## Work Units

### WU-1: Shorten IntroScene text and slow reveal

**Dependencies**: none

**Context**: The tagline "Your work, queryable by any agent." is fine but the word-by-word reveal at 8 frames per word is too fast for a 7-word phrase. Slow it down and give the intro more hold time.

**Files**:
- `apps/landing/remotion/src/scenes/IntroScene.tsx` — modify

**Steps**:
1. Keep "Local evidence layer" eyebrow and "Escribano" brand.
2. Keep tagline "Your work, queryable by any agent." but change `delayPerWord` from 8 to 12 frames (slower reveal).
3. Increase the scene's hold phase: change `enterExit(relativeFrame, 0, 30, 90, 120)` to `enterExit(relativeFrame, 0, 30, 140, 180)` — holds for 110 frames (~3.7s) instead of 60 frames (2s).
4. Also update brand and terminal enterExit calls to match the new exit frame (180).

**Verification**: `grep -c "delayPerWord={12}" apps/landing/remotion/src/scenes/IntroScene.tsx`

**Rollback**: `git checkout -- apps/landing/remotion/src/scenes/IntroScene.tsx`

---

### WU-2: Shorten CaptureScene text and increase hold

**Dependencies**: none

**Context**: The body text "A small menu-bar app watches your screen in the background. Repeats are skipped, nothing is uploaded, and you can pause it whenever you want." is two sentences and takes too long to read. Trim to one punchy sentence.

**Files**:
- `apps/landing/remotion/src/scenes/CaptureScene.tsx` — modify

**Steps**:
1. Keep title "Capture, quietly".
2. Change body text to: "Watches your screen in the background. Nothing is uploaded. Pause anytime." (3 short fragments, easier to scan).
3. Increase hold time: change `enterExit(relativeFrame, 0, 25, 120, 150)` to `enterExit(relativeFrame, 0, 25, 150, 190)`.
4. Update all internal enterExit calls to use exit frame 190.

**Verification**: `grep -c "Nothing is uploaded" apps/landing/remotion/src/scenes/CaptureScene.tsx`

**Rollback**: `git checkout -- apps/landing/remotion/src/scenes/CaptureScene.tsx`

---

### WU-3: Shorten ConnectScene (Understand) text and increase hold

**Dependencies**: none

**Context**: "Each moment is turned into a short, plain-language description of what you were doing — the tools, the files, the context. All of it stays on your machine." is too long.

**Files**:
- `apps/landing/remotion/src/scenes/ConnectScene.tsx` — modify

**Steps**:
1. Keep title "Understand, on-device".
2. Change body text to: "Turns screen moments into plain-language descriptions. Tools, files, context — all on your machine."
3. Increase hold time: `enterExit(relativeFrame, 0, 25, 150, 190)`.
4. Update all internal enterExit calls.

**Verification**: `grep -c "Turns screen moments" apps/landing/remotion/src/scenes/ConnectScene.tsx`

**Rollback**: `git checkout -- apps/landing/remotion/src/scenes/ConnectScene.tsx`

---

### WU-4: Shorten AskScene (Query) text and increase hold

**Dependencies**: none

**Context**: "Ask your agent — or the command line directly — what you were working on. Escribano returns the evidence, cleanly structured, ready to cite." is two sentences.

**Files**:
- `apps/landing/remotion/src/scenes/AskScene.tsx` — modify

**Steps**:
1. Keep title "Query, on your terms".
2. Change body text to: "Ask your agent or the CLI what you worked on. Evidence comes back structured and ready to cite."
3. Increase hold time: `enterExit(relativeFrame, 0, 25, 150, 190)`.
4. Update all internal enterExit calls.

**Verification**: `grep -c "Ask your agent or the CLI" apps/landing/remotion/src/scenes/AskScene.tsx`

**Rollback**: `git checkout -- apps/landing/remotion/src/scenes/AskScene.tsx`

---

### WU-5: Shorten AnswerScene text and increase hold

**Dependencies**: none

**Context**: "Moments, timestamps, entities, and source context come back clean enough for an agent to use." is wordy.

**Files**:
- `apps/landing/remotion/src/scenes/AnswerScene.tsx` — modify

**Steps**:
1. Keep title "Ready to cite.".
2. Change body text to: "Timestamps, entities, and source context — clean enough for any agent to use."
3. Increase hold time: `enterExit(relativeFrame, 0, 25, 150, 190)`.
4. Update all internal enterExit calls.

**Verification**: `grep -c "clean enough for any agent" apps/landing/remotion/src/scenes/AnswerScene.tsx`

**Rollback**: `git checkout -- apps/landing/remotion/src/scenes/AnswerScene.tsx`

---

### WU-6: Increase OutroScene hold

**Dependencies**: none

**Context**: The outro text is fine but should hold longer before fading.

**Files**:
- `apps/landing/remotion/src/scenes/OutroScene.tsx` — modify

**Steps**:
1. Keep all existing text and animations.
2. Increase hold time: `enterExit(relativeFrame, 0, 30, 150, 190)`.

**Verification**: `grep "enterExit(relativeFrame, 0, 30, 150, 190)" apps/landing/remotion/src/scenes/OutroScene.tsx`

**Rollback**: `git checkout -- apps/landing/remotion/src/scenes/OutroScene.tsx`

---

### WU-7: Redesign audio with richer waveforms

**Dependencies**: none

**Context**: Pure sine waves sound clinical and weird. Switch to triangle waves for richer harmonics, add a subtle shimmer layer, and use a chord progression instead of a static drone.

**Files**:
- `apps/landing/remotion/src/components/AmbientMusic.tsx` — rewrite

**Steps**:
1. Rewrite `AmbientMusic.tsx`:
   - Keep the same imports and `delayRender`/`continueRender` pattern.
   - Use `triangle` type oscillators instead of `sine` — triangle waves have softer harmonics than sawtooth but more character than sine.
   - Create a 3-chord progression that changes every ~8 seconds:
     - Chord 1 (frames 0-240): C3 (130.81), G3 (196.00), C4 (261.63) — root position
     - Chord 2 (frames 240-480): A2 (110.00), E3 (164.81), A3 (220.00) — relative minor
     - Chord 3 (frames 480-720): F2 (87.31), C3 (130.81), F3 (174.61) — subdominant
     - Then loop or hold chord 3 until end
   - For each chord, create 3 oscillators (triangle) with gain nodes.
   - Add a 4th "shimmer" oscillator one octave higher (C5, E5, G5 depending on chord) at very low volume (0.01-0.03), triangle type.
   - Add a subtle noise texture: create a buffer of white noise, loop it through a very low gain (0.005) and a bandpass filter (300-1200 Hz).
   - Master low-pass filter at 600 Hz (slightly lower than before for warmth).
   - Volume envelope: fade in 0→0.2 over 3s, hold at 0.2, fade out 0.2→0 over 3s.
   - Add a subtle sidechain-like ducking: every 2 seconds, dip volume by 10% for 100ms — creates gentle breathing.

**Verification**: `cat apps/landing/remotion/src/components/AmbientMusic.tsx | grep -c "triangle\|shimmer\|bandpass"`

**Rollback**: `rm -f apps/landing/remotion/src/components/AmbientMusic.tsx`

---

### WU-8: Increase timeline spacing to match longer scenes

**Dependencies**: WU-1, WU-2, WU-3, WU-4, WU-5, WU-6

**Context**: With each scene now holding for ~5 seconds (150 frames enter+hold) and 1-second gaps, we need to recalculate the timeline. Scenes should last 190 frames each with 30-frame gaps.

**Files**:
- `apps/landing/remotion/src/video.tsx` — modify

**Steps**:
1. Update `startFrame` values:
   - `IntroScene`: 0 (holds 0-140, exits 140-180)
   - `CaptureScene`: 210 (was 150 — gives 30-frame gap after Intro exits)
   - `ConnectScene`: 430 (was 360)
   - `AskScene`: 650 (was 570)
   - `AnswerScene`: 870 (was 780)
   - `OutroScene`: 1090 (was 990)
2. Each scene gets 190 frames + 30-frame gap = 220 frames between starts.

**Verification**: `grep -E "startFrame=" apps/landing/remotion/src/video.tsx`

**Rollback**: `git checkout -- apps/landing/remotion/src/video.tsx`

---

### WU-9: Update total duration

**Dependencies**: WU-8

**Context**: The new timeline ends at frame 1280 (Outro starts at 1090, lasts 190 frames). Update root.tsx.

**Files**:
- `apps/landing/remotion/src/root.tsx` — modify

**Steps**:
1. Change `durationInFrames` from 1080 to 1320 (44 seconds).

**Verification**: `grep "durationInFrames" apps/landing/remotion/src/root.tsx`

**Rollback**: `git checkout -- apps/landing/remotion/src/root.tsx`

## Execution Plan

### Phase 1 — Text and timing fixes (parallel)

- WU-1: Shorten IntroScene text and slow reveal
- WU-2: Shorten CaptureScene text and increase hold
- WU-3: Shorten ConnectScene text and increase hold
- WU-4: Shorten AskScene text and increase hold
- WU-5: Shorten AnswerScene text and increase hold
- WU-6: Increase OutroScene hold
- WU-7: Redesign audio with richer waveforms

### Phase 2 — Timeline (sequential)

- WU-8: Increase timeline spacing
- WU-9: Update total duration

## Recovery Strategy

- **Automatic**: Each implementor rolls back and retries once on failure.
- **Dependency failure**: If a work unit fails and later units depend on it, those later units will not run.
- **Global rollback**: `git reset HEAD~N --hard` where N is the number of committed work units.
- **Independent failures**: Work units with no dependency on a failed unit will still execute.
