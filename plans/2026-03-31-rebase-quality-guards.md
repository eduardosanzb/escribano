# Implementation Plan: Rebase Capture Quality Guards onto InferenceQueue Refactor

**Date**: 2026-03-31  **Status**: PENDING APPROVAL

## Overview

The capture quality guards PR (screen lock detection + churn rate limiter) needs to be rebased onto main, which now contains the InferenceQueue refactor (PR #58). The refactor introduced significant architectural changes: `WorkQueue` became `InferenceQueue` with worker lifecycle management, `VLMInferenceService` + `TextGenerationService` merged into `InferenceWorker`, and `Backpressure` was extracted to its own class. This plan resolves the merge conflicts by adopting the new architecture while preserving the quality guard features.

## Scope

- Work units: 4
- Execution phases: 2
- Files affected:
  - `apps/recorder/Sources/StreamCapture.swift` (modify — merge churn detection + two-reason pause onto their DateFormatter optimization)
  - `apps/recorder/Sources/main.swift` (modify — add ScreenLockObserver wiring to their InferenceQueue architecture)
  - `MVP-FINAL-PUSH.md` (modify — merge section structures)
  - `apps/recorder/Sources/ScreenLockObserver.swift` (keep — new file, no conflict)

## Context from Main (PR #58)

The InferenceQueue refactor changed the architecture significantly:

| Component | Before | After |
|-----------|--------|-------|
| Protocol | `VLMInferenceService` + `TextGenerationService` | Single `InferenceWorker` protocol |
| Queue | `WorkQueue` (priority scheduler) | `InferenceQueue` (owns worker lifecycle + health checks + circuit breaker) |
| Adapter | `PythonBridgeVLMAdapter` with 5-state machine | Simplified "dumb process wrapper" |
| FrameAnalyzer | Bridge-aware (restart logic) | Bridge-unaware (submits to queue) |
| SessionAggregator | Bridge-aware (ping loop) | Bridge-unaware (submits to queue) |
| Backpressure | Inline in main.swift | Extracted to `Backpressure.swift` |
| StreamCapture | Created DateFormatter per frame | Stored formatters (optimization) |

## Work Units

### WU-1: Merge StreamCapture.swift — Churn Detection + Two-Reason Pause onto DateFormatter Optimization

**Dependencies**: none

**Context**: Main's `StreamCapture.swift` added stored `DateFormatter` and `ISO8601DateFormatter` properties to avoid per-frame allocation, plus `captureStartTime` for FPS tracking. Our branch added churn rate detection (rolling 60s window, throttle to 1 frame per 30s) and a two-reason pause model (`isPausedByBackpressure` + `isPausedByScreenLock`). These changes are orthogonal and should be merged together.

**Files**:
- `apps/recorder/Sources/StreamCapture.swift` — modify

**Steps**:
1. Start from main's version of `StreamCapture.swift` (has stored formatters, `captureStartTime`, FPS stats)
2. Add churn rate detection instance properties after `framesSkipped`:
   ```swift
   // Churn rate detection
   private var lastSeenPHash: UInt64? = nil
   private var churnTimestamps: [Date] = []
   private var isThrottled: Bool = false
   private var lastThrottledKeptTime: Date? = nil
   private let churnThreshold: Int
   private let churnThrottleInterval: TimeInterval
   ```
3. In `init`, read env vars after `pHashThreshold`:
   ```swift
   self.churnThreshold = Int(ProcessInfo.processInfo.environment["ESCRIBANO_CHURN_THRESHOLD"] ?? "") ?? 40
   self.churnThrottleInterval = Double(ProcessInfo.processInfo.environment["ESCRIBANO_CHURN_THROTTLE_INTERVAL"] ?? "") ?? 30.0
   ```
4. Replace the single `isPaused: Bool` with two-reason pause model:
   ```swift
   private var isPausedByBackpressure: Bool = false
   private var isPausedByScreenLock:   Bool = false
   private var isPaused: Bool { isPausedByBackpressure || isPausedByScreenLock }
   ```
5. Replace `pause()` with `pauseForBackpressure()` and `pauseForScreenLock()`:
   ```swift
   func pauseForBackpressure() {
       guard !isPausedByBackpressure else { return }
       isPausedByBackpressure = true
       if !isPausedByScreenLock { Task { try? await self.stream?.stopCapture() } }
       print("[StreamCapture] Paused (backpressure).")
   }

   func resumeFromBackpressure() {
       guard isPausedByBackpressure else { return }
       isPausedByBackpressure = false
       if !isPausedByScreenLock { Task { try? await self.stream?.startCapture() } }
       print("[StreamCapture] Resumed from backpressure.")
   }

   func pauseForScreenLock() {
       guard !isPausedByScreenLock else { return }
       isPausedByScreenLock = true
       if !isPausedByBackpressure { Task { try? await self.stream?.stopCapture() } }
       print("[StreamCapture] Paused (screen lock).")
   }

   func resumeFromScreenLock() {
       guard isPausedByScreenLock else { return }
       isPausedByScreenLock = false
       if !isPausedByBackpressure { Task { try? await self.stream?.startCapture() } }
       print("[StreamCapture] Resumed from screen lock.")
   }
   ```
6. In `processFrame`, add churn detection logic after `let hash = pHasher.compute(cgImage)`:
   - Compute `churnHamming` from `lastSeenPHash`
   - Always update `lastSeenPHash`
   - Manage rolling 60s window in `churnTimestamps`
   - Log throttle state changes
   - Apply throttle gate before saving frame
7. Update the stats log (every 100 frames) to include churn info:
   ```swift
   print(String(format: "[pHash] Stats: %d seen, %d skipped (%.1f%%), %d kept, churn=%d/min, throttled=%@",
       framesSeen, framesSkipped, skipPct, kept, churnTimestamps.count, isThrottled ? "YES" : "NO"))
   ```

**Verification**: `swift build -c release 2>&1 | tail -1` in `apps/recorder/` — must show "Build complete!"

**Rollback**:
- Modified files: `git checkout -- apps/recorder/Sources/StreamCapture.swift`

---

### WU-2: Merge main.swift — Add ScreenLockObserver to InferenceQueue Architecture

**Dependencies**: WU-1 (needs `pauseForScreenLock()`/`resumeFromScreenLock()` methods)

**Context**: Main's `main.swift` uses `InferenceQueue` with `startWorkers()`, has `Backpressure` extracted to its own class, and includes sleep/wake hooks via `NSWorkspace` notifications. Our branch added `ScreenLockObserver` wiring. We need to add the screen lock observer to their architecture, using the reason-specific pause methods.

**Files**:
- `apps/recorder/Sources/main.swift` — modify

**Steps**:
1. Start from main's version of `main.swift` (has InferenceQueue, Backpressure class, sleep/wake hooks)
2. Add property to `EscribanoRecorderDelegate`:
   ```swift
   private var screenLockObserver: ScreenLockObserver?
   ```
3. In `start()`, after the `bp.onPause`/`bp.onResume` block, add screen lock observer wiring:
   ```swift
   // Screen lock detection — pause capture when screen is locked
   let lockObserver = ScreenLockObserver()
   lockObserver.onLock = { [weak self] in
       self?.captures.forEach { $0.pauseForScreenLock() }
       log("[escribano-recorder] Screen locked — all captures paused")
   }
   lockObserver.onUnlock = { [weak self] in
       self?.captures.forEach { $0.resumeFromScreenLock() }
       log("[escribano-recorder] Screen unlocked — all captures resumed")
   }
   self.screenLockObserver = lockObserver
   ```
4. Update the startup log to include churn threshold and screen lock status:
   ```swift
   let churnThreshold = Int(ProcessInfo.processInfo.environment["ESCRIBANO_CHURN_THRESHOLD"] ?? "") ?? 40
   let churnInterval: TimeInterval = Double(ProcessInfo.processInfo.environment["ESCRIBANO_CHURN_THROTTLE_INTERVAL"] ?? "") ?? 30.0
   log("[escribano-recorder] Running. High-water=\(highWater) Low-water=\(lowWater) Threshold=\(threshold) QueueStreak=\(realtimeStreak) ChurnThreshold=\(churnThreshold)/min ChurnInterval=\(Int(churnInterval))s ScreenLock=active")
   ```

**Verification**: `swift build -c release 2>&1 | tail -1` in `apps/recorder/` — must show "Build complete!"

**Rollback**:
- Modified files: `git checkout -- apps/recorder/Sources/main.swift`

---

### WU-3: Merge MVP-FINAL-PUSH.md — Combine Section Structures

**Dependencies**: none

**Context**: Main's `MVP-FINAL-PUSH.md` has a new tier structure ("Tier 2: Recorder Quality", "Tier 3: Performance Optimization") inserted before "Week 1: Core Product Loop". Our branch added a "Capture Quality Guards" section. We need to merge both section structures.

**Files**:
- `MVP-FINAL-PUSH.md` — modify

**Steps**:
1. Start from main's version of `MVP-FINAL-PUSH.md`
2. After "### Bootstrap & Permissions" section, add the Capture Quality Guards section:
   ```markdown
   ### Capture Quality Guards

   - [x] Screen lock detection — `DistributedNotificationCenter` listens for `com.apple.screenIsLocked`/`screenIsUnlocked`, pauses all captures on lock, resumes on unlock
   - [x] Frame churn rate limiter — rolling 60s window tracks frame-to-frame pHash changes; when unique frames/min exceeds `ESCRIBANO_CHURN_THRESHOLD` (default 40), throttles capture to 1 frame per `ESCRIBANO_CHURN_THROTTLE_INTERVAL` (default 30s); auto-resumes when rate normalizes
   - [ ] (Future) Observation-based smart throttle — use VLM activity detection (e.g., consecutive "YouTube" observations) to confirm/override churn-based throttle
   ```

**Verification**: File exists and contains both tier structure and Capture Quality Guards section

**Rollback**:
- Modified files: `git checkout -- MVP-FINAL-PUSH.md`

---

### WU-4: Keep ScreenLockObserver.swift and CLAUDE.md

**Dependencies**: none

**Context**: `ScreenLockObserver.swift` is a new file that doesn't exist in main — no merge conflict. `CLAUDE.md` was already updated with the churn env vars and should merge cleanly. This work unit just verifies these files are preserved.

**Files**:
- `apps/recorder/Sources/ScreenLockObserver.swift` — keep (no changes needed)
- `CLAUDE.md` — keep (no changes needed)

**Steps**:
1. Verify `ScreenLockObserver.swift` exists and uses `log()` (not `print()`)
2. Verify `CLAUDE.md` contains `ESCRIBANO_CHURN_THRESHOLD` and `ESCRIBANO_CHURN_THROTTLE_INTERVAL` in the env var table

**Verification**: 
- `test -f apps/recorder/Sources/ScreenLockObserver.swift && echo "OK"`
- `grep -q "ESCRIBANO_CHURN_THRESHOLD" CLAUDE.md && echo "OK"`

**Rollback**: None needed — these files are preserved

---

## Execution Plan

### Phase 1 — Parallel (no dependencies)

- WU-1: Merge StreamCapture.swift — Churn Detection + Two-Reason Pause onto DateFormatter Optimization
- WU-3: Merge MVP-FINAL-PUSH.md — Combine Section Structures
- WU-4: Keep ScreenLockObserver.swift and CLAUDE.md

### Phase 2 — Sequential (requires Phase 1)

- WU-2: Merge main.swift — Add ScreenLockObserver to InferenceQueue Architecture

## Recovery Strategy

- **Automatic**: Each implementor rolls back and retries once on failure.
- **Dependency failure**: If WU-1 fails, WU-2 cannot run (it needs the reason-specific pause methods).
- **Global rollback**: `git checkout -- apps/recorder/Sources/StreamCapture.swift apps/recorder/Sources/main.swift MVP-FINAL-PUSH.md`
- **Independent failures**: WU-3 and WU-4 are independent of WU-1 and can proceed regardless.

## Pre-execution Step

Before executing, the following git operations are required:
1. `git fetch origin main`
2. `git merge origin/main` (this will create merge conflicts)
3. Resolve conflicts by implementing the work units above

---

**Approve this plan?** Reply "yes" to execute, or tell me what to change.

**Note**: Would you like me to create a new worktree for this plan to keep the current branch state intact?
