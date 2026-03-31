# Implementation Plan: Rebase Capture Quality Guards onto InferenceQueue Architecture

**Date**: 2026-03-31  **Status**: COMPLETED

## Overview

The capture quality guards PR (screen lock detection + churn rate limiter) needs to be rebased onto main, which now contains the InferenceQueue refactor (PR #58). The refactor introduced significant architectural changes: `WorkQueue` became `InferenceQueue` with worker lifecycle management, `VLMInferenceService` + `TextGenerationService` merged into `InferenceWorker`, and `Backpressure` was extracted to its class. This plan resolves the merge conflicts by adopting the new architecture while preserving the quality guard features.

## Scope

- Work units: 4
- Execution phases: 2
- Files affected:
  - `apps/recorder/Sources/StreamCapture.swift` (modify — merge churn detection + two-reason pause onto DateFormatter optimization)
  - `apps/recorder/Sources/main.swift` (modify — add ScreenLockObserver wiring to their InferenceQueue architecture)
  - `MVP-FINAL-PUSH.md` (modify — merge section structures)
  - `apps/recorder/Sources/ScreenLockObserver.swift` (keep — new file, no conflict)
  - `CLAUDE.md` (keep — env var docs already merged)

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
1. Read the current `StreamCapture.swift` from our branch (after merge with main).
2. Identify the location of their stored formatters (around line 30-40).
3. Add churn rate detection instance properties after the stored formatters:
   ```swift
   // Churn rate detection
   private var lastSeenPHash: UInt64? = nil       // Updated EVERY frame (for churn measurement)
   private var churnTimestamps: [Date] = []        // Rolling window of frame-to-frame changes
   private var isThrottled: Bool = false
   private var lastThrottledKeptTime: Date? = nil
   private let churnThreshold: Int                 // Unique frames/min to trigger throttle
   private let churnThrottleInterval: TimeInterval  // Seconds between kept frames when throttled
   ```
4. In `init(display:store:backpressure:)`, after the stored formatter initialization, add:
   ```swift
   self.churnThreshold = Int(ProcessInfo.processInfo.environment["ESCRIBANO_CHURN_THRESHOLD"] ?? "") ?? 40
   self.churnThrottleInterval = Double(ProcessInfo.processInfo.environment["ESCRIBANO_CHURN_THROTTLE_INTERVAL"] ?? "") ?? 30.0
   ```
5. In `processFrame(_ pixelBuffer:)`, after `let hash = pHasher.compute(cgImage)` and before the dedup logic, add the churn detection block:
   ```swift
   // --- Churn detection: compare to PREVIOUS frame (updated every frame) ---
   let churnHamming = lastSeenPHash.map { (hash ^ $0).nonzeroBitCount } ?? 0
   lastSeenPHash = hash  // Always update — tracks actual screen change rate

   let now = Date()
   if churnHamming > pHashThreshold {
       churnTimestamps.append(now)
   }
   // Prune entries older than 60 seconds
   churnTimestamps.removeAll { now.timeIntervalSince($0) > 60.0 }
   
   let wasThrottled = isThrottled
   isThrottled = churnTimestamps.count > churnThreshold
   
   if isThrottled && !wasThrottled {
       log("[StreamCapture] High churn detected (\(churnTimestamps.count) changes/min > \(churnThreshold)) — throttling to 1 frame per \(Int(churnThrottleInterval))s")
   } else if !isThrottled && wasThrottled {
       log("[StreamCapture] Churn rate normalized (\(churnTimestamps.count) changes/min) — resuming normal capture")
       lastThrottledKeptTime = nil
   }
   ```
6. Update the stats logging to include churn info:
   ```swift
   if framesSeen % 100 == 0 {
       let kept = framesSeen - framesSkipped
       let skipPct = (Double(framesSkipped) / Double(framesSeen)) * 100.0
       var fpsLine = ""
       if let start = captureStartTime {
           let elapsed = Date().timeIntervalSince(start)
           let deliveredFps = elapsed > 0 ? Double(framesSeen) / elapsed : 0
           let storedFps = elapsed > 0 ? Double(frameCounter) / elapsed : 0
           fpsLine = String(format: ", %.2f fps delivered, %.2f fps stored", deliveredFps, storedFps)
       }
       log(String(format: "[pHash] Stats: %d seen, %d skipped (%.1f%%), %d kept, churn=%d/min, throttled=%@%@", 
           framesSeen, framesSkipped, skipPct, kept, churnTimestamps.count, isThrottled ? "YES" : "NO", fpsLine))
   }
   ```
7. Add throttle gate after dedup check, before `prevPHash = hash`:
   ```swift
   // --- Throttle gate: allow only 1 frame per churnThrottleInterval ---
   if isThrottled {
       if let lastKept = lastThrottledKeptTime, 
          now.timeIntervalSince(lastKept) < churnThrottleInterval {
           framesSkipped += 1
           return
       }
       lastThrottledKeptTime = now
   }
   ```
8. Replace the single `isPaused: Bool` with two-reason pause model:
   ```swift
   // Two-reason pause model: backpressure + screen lock
   private var isPausedByBackpressure: Bool = false
   private var isPausedByScreenLock:   Bool = false
   private var isPaused: Bool { isPausedByBackpressure || isPausedByScreenLock }
   ```
9. Replace `pause()` with `pauseForBackpressure()`:
   ```swift
   func pauseForBackpressure() {
       guard !isPausedByBackpressure else { return }
       isPausedByBackpressure = true
       if !isPausedByScreenLock { Task { try? await self.stream?.stopCapture() } }
       log("[StreamCapture] Paused (backpressure).")
   }
   ```
10. Replace `resume()` with `resumeFromBackpressure()`:
    ```swift
    func resumeFromBackpressure() {
        guard isPausedByBackpressure else { return }
        isPausedByBackpressure = false
        if !isPausedByScreenLock { Task { try? await self.stream?.startCapture() } }
        log("[StreamCapture] Resumed from backpressure.")
    }
    ```
11. Add `pauseForScreenLock()` and `resumeFromScreenLock()`:
    ```swift
    func pauseForScreenLock() {
        guard !isPausedByScreenLock else { return }
        isPausedByScreenLock = true
        if !isPausedByBackpressure { Task { try? await self.stream?.stopCapture() } }
        log("[StreamCapture] Paused (screen lock).")
    }

    func resumeFromScreenLock() {
        guard isPausedByScreenLock else { return }
        isPausedByScreenLock = false
        if !isPausedByBackpressure { Task { try? await self.stream?.startCapture() } }
        log("[StreamCapture] Resumed from screen lock.")
    }
    ```

**Verification**: `swift build -c release 2>&1 | tail -1` in `apps/recorder/` — must show "Build complete!"

**Rollback**:
- Modified files: `git checkout -- apps/recorder/Sources/StreamCapture.swift`

---

### WU-2: Merge main.swift — Add ScreenLockObserver to InferenceQueue Architecture

**Dependencies**: WU-1

**Context**: Main's `main.swift` now uses `InferenceQueue` instead of `WorkQueue`, has extracted `Backpressure` to its own class, and includes sleep/wake hooks. We need to add `ScreenLockObserver` wiring to this new architecture. The observer should call `pauseForScreenLock()`/`resumeFromScreenLock()` on the captures.

**Files**:
- `apps/recorder/Sources/main.swift` — modify

**Steps**:
1. Read the current `main.swift` from main (after merge with main).
2. Add `screenLockObserver` property to `EscribanoRecorderDelegate`:
   ```swift
   private var screenLockObserver: ScreenLockObserver?
   ```
3. In `start()`, after the backpressure wiring (after `bp.onResume` closure), add screen lock observer wiring:
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
4. Update the backpressure closures to use the new method names:
   ```swift
   bp.onPause = { [weak self] in
       self?.captures.forEach { $0.pauseForBackpressure() }
   }
   bp.onResume = { [weak self] in
       self?.captures.forEach { $0.resumeFromBackpressure() }
   }
   ```
5. Update the final startup log to include churn threshold and screen lock status:
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

**Context**: Main's `MVP-FINAL-PUSH.md` added new tier sections (Tier 2: Recorder Quality, Tier 3: Performance Optimization). Our branch added a "Capture Quality Guards" section. These should be merged together.

**Files**:
- `MVP-FINAL-PUSH.md` — modify

**Steps**:
1. Read the current `MVP-FINAL-PUSH.md` from main (after merge with main).
2. Find the location after "## Completed Prerequisites" section.
3. Insert the "Capture Quality Guards" section:
   ```markdown
   ### Capture Quality Guards

   - [x] Screen lock detection — `DistributedNotificationCenter` listens for `com.apple.screenIsLocked`/`screenIsUnlocked`, pauses all captures on lock, resumes on unlock
   - [x] Frame churn rate limiter — rolling 60s window tracks frame-to-frame pHash changes; when unique frames/min exceeds `ESCRIBANO_CHURN_THRESHOLD` (default 40), throttles capture to 1 frame per `ESCRIBANO_CHURN_THROTTLE_INTERVAL` (default 30s); auto-resumes when rate normalizes
   - [ ] (Future) Observation-based smart throttle — use VLM activity detection (e.g., consecutive "YouTube" observations) to confirm/override churn-based throttle
   ```

**Verification**: `grep -q "Capture Quality Guards" MVP-FINAL-PUSH.md` — must return 0 (section exists)

**Rollback**:
- Modified files: `git checkout -- MVP-FINAL-PUSH.md`

---

### WU-4: Keep ScreenLockObserver.swift and CLAUDE.md
**Dependencies**: none

**Context**: `ScreenLockObserver.swift` is a new file that doesn't exist in main — no merge conflict. `CLAUDE.md` was already updated with the churn env vars in our branch and main doesn't touch it file, so it should merge cleanly.

**Files**:
- `apps/recorder/Sources/ScreenLockObserver.swift` — keep (no changes needed)
- `CLAUDE.md` — keep (no changes needed)

**Steps**:
1. Verify `ScreenLockObserver.swift` exists and uses `log()` (not `print()`).
2. Verify `CLAUDE.md` contains `ESCRIBANO_CHURN_THRESHOLD` and `ESCRIBANO_CHURN_THROTTLE_INTERVAL` in the env var table.

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
- **Dependency failure**: If WU-1 fails, WU-2 cannot run (it references `pauseForScreenLock()`/`resumeFromScreenLock()` methods).
- **Global rollback**: `git checkout -- apps/recorder/Sources/StreamCapture.swift apps/recorder/Sources/main.swift MVP-FINAL-PUSH.md`
- **Independent failures**: WU-3 and WU-4 are fully independent — failure of one does not affect the others.
