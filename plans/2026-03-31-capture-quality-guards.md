# Implementation Plan: Capture Quality Guards (Screen Lock + Churn Rate)

**Date**: 2026-03-31  **Status**: COMPLETED

## Overview

The always-on recorder currently captures and analyzes frames regardless of screen state or content type. This wastes resources and pollutes work memory when the screensaver activates (it's a video on macOS) or when the user watches YouTube/video content. Two guards are added: (1) screen lock detection pauses capture entirely, (2) a frame churn rate limiter throttles capture when the screen changes too rapidly (video playback pattern).

## Scope

- Work units: 3
- Execution phases: 2
- Files affected:
  - `apps/recorder/Sources/ScreenLockObserver.swift` (create)
  - `apps/recorder/Sources/StreamCapture.swift` (modify)
  - `apps/recorder/Sources/main.swift` (modify)
  - `MVP-FINAL-PUSH.md` (modify)

## Work Units

### WU-1: Create ScreenLockObserver

**Dependencies**: none

**Context**: The recorder runs as an always-on daemon. When the user locks their screen or the screensaver activates, the recorder keeps capturing frames of the lock screen or screensaver video. These frames waste VLM inference time and pollute the work memory with non-work observations. macOS publishes `com.apple.screenIsLocked` and `com.apple.screenIsUnlocked` notifications via `DistributedNotificationCenter` that we can subscribe to. This work unit creates a standalone observer class following the existing architectural pattern (see `Backpressure.swift` which uses closure callbacks `onPause`/`onResume`).

**Files**:
- `apps/recorder/Sources/ScreenLockObserver.swift` — create

**Steps**:
1. Create file `apps/recorder/Sources/ScreenLockObserver.swift` with `import Foundation` and `import Cocoa`.
2. Define a `@MainActor final class ScreenLockObserver: NSObject` with two optional closure properties:
   ```swift
   var onLock:   (() -> Void)?
   var onUnlock: (() -> Void)?
   ```
3. In `override init()`, call `super.init()` then subscribe to `DistributedNotificationCenter.default()` for two notifications:
   - `NSNotification.Name("com.apple.screenIsLocked")` with selector `handleLock`
   - `NSNotification.Name("com.apple.screenIsUnlocked")` with selector `handleUnlock`
   - Log: `print("[ScreenLock] Observer registered")`
4. Implement `deinit` that calls `DistributedNotificationCenter.default().removeObserver(self)`.
5. Implement two `@objc nonisolated private` handler methods. These MUST be `nonisolated` because `DistributedNotificationCenter` delivers on arbitrary threads, but the class is `@MainActor`. Follow the exact same pattern used in `StreamBridge` (lines 193-229 of `StreamCapture.swift`) which bounces to MainActor via `Task { @MainActor in }`:
   ```swift
   @objc nonisolated private func handleLock(_ notification: Notification) {
       print("[ScreenLock] Screen locked — pausing capture")
       Task { @MainActor [weak self] in
           self?.onLock?()
       }
   }
   
   @objc nonisolated private func handleUnlock(_ notification: Notification) {
       print("[ScreenLock] Screen unlocked — resuming capture")
       Task { @MainActor [weak self] in
           self?.onUnlock?()
       }
   }
   ```
6. The class has no dependencies on any other recorder types — it is fully standalone.

**Verification**: `swift build -c release 2>&1 | tail -1` in `apps/recorder/` — must show "Build complete!" (the new file is auto-discovered by the Swift package since all files in `Sources/` are included)

**Rollback**:
- Created files: `rm -f apps/recorder/Sources/ScreenLockObserver.swift`

---

### WU-2: Add Frame Churn Rate Limiter to StreamCapture

**Dependencies**: none

**Context**: When the user watches video content (YouTube, Netflix, screensaver animations), every frame is visually unique — pHash correctly identifies them as "different" (hamming distance >> 4). This means the recorder captures at the full 1fps rate, generating ~60 frames/minute of low-value video content. A churn rate limiter detects this pattern by tracking **frame-to-frame** visual changes in a rolling 60-second window. When too many consecutive frames are different from each other, it means the screen content is changing rapidly (video pattern), and capture is throttled to 1 frame per 30 seconds. This is measured separately from the dedup hash — we track a `lastSeenPHash` that updates on EVERY frame (for churn detection), while the existing `prevPHash` only updates on kept frames (for dedup). This separation ensures accurate churn measurement even while throttled.

**Files**:
- `apps/recorder/Sources/StreamCapture.swift` — modify

**Steps**:
1. Add new instance properties to the `StreamCapture` class (after the existing `private var framesSkipped: Int = 0` on line 27):
   ```swift
   // Churn rate detection
   private var lastSeenPHash: UInt64? = nil       // Updated EVERY frame (for churn measurement)
   private var churnTimestamps: [Date] = []        // Rolling window of frame-to-frame changes
   private var isThrottled: Bool = false
   private var lastThrottledKeptTime: Date? = nil
   private let churnThreshold: Int                 // Unique frames/min to trigger throttle
   private let churnThrottleInterval: TimeInterval  // Seconds between kept frames when throttled
   ```
2. In `init(display:store:backpressure:)`, after the `self.pHashThreshold = ...` line (line 43), read the two new environment variables:
   ```swift
   self.churnThreshold = Int(ProcessInfo.processInfo.environment["ESCRIBANO_CHURN_THRESHOLD"] ?? "") ?? 40
   self.churnThrottleInterval = Double(ProcessInfo.processInfo.environment["ESCRIBANO_CHURN_THROTTLE_INTERVAL"] ?? "") ?? 30.0
   ```
3. In `processFrame(_ pixelBuffer:)`, restructure the logic after `let hash = pHasher.compute(cgImage)` (line 96). The FULL replacement of lines 96-117 should be:
   ```swift
   let hash = pHasher.compute(cgImage)

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
       print("[StreamCapture] High churn detected (\(churnTimestamps.count) changes/min > \(churnThreshold)) — throttling to 1 frame per \(Int(churnThrottleInterval))s")
   } else if !isThrottled && wasThrottled {
       print("[StreamCapture] Churn rate normalized (\(churnTimestamps.count) changes/min) — resuming normal capture")
       lastThrottledKeptTime = nil
   }

   // --- Dedup: compare to last KEPT frame ---
   let hamming = prevPHash.map { (hash ^ $0).nonzeroBitCount } ?? 99
   let isDuplicate = hamming <= pHashThreshold

   if debugPHash && !isDuplicate {
       print("[pHash] KEEP frame=\(framesSeen) hamming=\(hamming) churn=\(churnTimestamps.count)/min throttled=\(isThrottled)")
   }

   // Rolling stats every 100 frames seen
   if framesSeen % 100 == 0 {
       let kept = framesSeen - framesSkipped
       let skipPct = (Double(framesSkipped) / Double(framesSeen)) * 100.0
       print(String(format: "[pHash] Stats: %d seen, %d skipped (%.1f%%), %d kept, churn=%d/min, throttled=%@",
           framesSeen, framesSkipped, skipPct, kept, churnTimestamps.count, isThrottled ? "YES" : "NO"))
   }

   if isDuplicate {
       framesSkipped += 1
       return
   }

   // --- Throttle gate: allow only 1 frame per churnThrottleInterval ---
   if isThrottled {
       if let lastKept = lastThrottledKeptTime, 
          now.timeIntervalSince(lastKept) < churnThrottleInterval {
           framesSkipped += 1
           return
       }
       lastThrottledKeptTime = now
   }

   prevPHash = hash
   ```
   Everything after `prevPHash = hash` (the metadata generation, file saving, DB insert, backpressure call) stays exactly as-is.
4. Add `isThrottled` to the startup log. In the `init`, after the existing `print("[StreamCapture] Started — display ...")` line (line 62), no change needed — the existing log is fine. The churn state will be logged dynamically via the rolling stats.

**Verification**: `swift build -c release 2>&1 | tail -1` in `apps/recorder/` — must show "Build complete!"

**Rollback**:
- Modified files: `git checkout -- apps/recorder/Sources/StreamCapture.swift`

---

### WU-3: Wire ScreenLockObserver into main.swift + Update MVP Sprint Doc

**Dependencies**: WU-1, WU-2

**Context**: WU-1 created the `ScreenLockObserver` class and WU-2 added the churn rate limiter to `StreamCapture`. This work unit wires the screen lock observer into the application lifecycle in `main.swift` (same pattern as `Backpressure` which uses `onPause`/`onResume` closures to control capture). It also updates `MVP-FINAL-PUSH.md` to document these features in the Day 1 sprint plan. The `EscribanoRecorderDelegate` in `main.swift` manages the full lifecycle — it creates all components in `start()` and tears them down in `applicationWillTerminate`.

**Files**:
- `apps/recorder/Sources/main.swift` — modify
- `MVP-FINAL-PUSH.md` — modify

**Steps**:
1. In `main.swift`, add a property to `EscribanoRecorderDelegate` (after the existing `private var aggregatorTask: Task<Void, Never>?` on line 32):
   ```swift
   private var screenLockObserver: ScreenLockObserver?
   ```
2. In the `start()` method, after the block that wires `bp.onPause` and `bp.onResume` (after line 214), add:
   ```swift
   // Screen lock detection — pause capture when screen is locked
   let lockObserver = ScreenLockObserver()
   lockObserver.onLock = { [weak self] in
       self?.captures.forEach { $0.pause() }
       log("[escribano-recorder] Screen locked — all captures paused")
   }
   lockObserver.onUnlock = { [weak self] in
       self?.captures.forEach { $0.resume() }
       log("[escribano-recorder] Screen unlocked — all captures resumed")
   }
   self.screenLockObserver = lockObserver
   ```
3. In the final startup log line (line 217), add the churn threshold to the output. Change:
   ```swift
   log("[escribano-recorder] Running. High-water=\(highWater) Low-water=\(lowWater) Threshold=\(threshold) QueueStreak=\(realtimeStreak)")
   ```
   to:
   ```swift
   let churnThreshold = Int(ProcessInfo.processInfo.environment["ESCRIBANO_CHURN_THRESHOLD"] ?? "") ?? 40
   let churnInterval = Int(ProcessInfo.processInfo.environment["ESCRIBANO_CHURN_THROTTLE_INTERVAL"] ?? "") ?? 30
   log("[escribano-recorder] Running. High-water=\(highWater) Low-water=\(lowWater) Threshold=\(threshold) QueueStreak=\(realtimeStreak) ChurnThreshold=\(churnThreshold)/min ChurnInterval=\(churnInterval)s ScreenLock=active")
   ```
4. In `MVP-FINAL-PUSH.md`, add a new section after "### Bootstrap & Permissions" (after line 66) and before "### DMG Packaging" (line 68):
   ```markdown
   ### Capture Quality Guards

   - [x] Screen lock detection — `DistributedNotificationCenter` listens for `com.apple.screenIsLocked`/`screenIsUnlocked`, pauses all captures on lock, resumes on unlock
   - [x] Frame churn rate limiter — rolling 60s window tracks frame-to-frame pHash changes; when unique frames/min exceeds `ESCRIBANO_CHURN_THRESHOLD` (default 40), throttles capture to 1 frame per `ESCRIBANO_CHURN_THROTTLE_INTERVAL` (default 30s); auto-resumes when rate normalizes
   - [ ] (Future) Observation-based smart throttle — use VLM activity detection (e.g., consecutive "YouTube" observations) to confirm/override churn-based throttle
   ```

**Verification**: `swift build -c release 2>&1 | tail -1` in `apps/recorder/` — must show "Build complete!"

**Rollback**:
- Modified files: `git checkout -- apps/recorder/Sources/main.swift MVP-FINAL-PUSH.md`

---

## Execution Plan

### Phase 1 — Parallel (no dependencies)

- WU-1: Create ScreenLockObserver
- WU-2: Add Frame Churn Rate Limiter to StreamCapture

### Phase 2 — Sequential (requires Phase 1)

- WU-3: Wire ScreenLockObserver into main.swift + Update MVP Sprint Doc

## Recovery Strategy

- **Automatic**: Each implementor rolls back and retries once on failure.
- **Dependency failure**: If WU-1 fails, WU-3 cannot run (it references `ScreenLockObserver` type). WU-2 is independent. If WU-2 fails, WU-3 should still run for the screen lock wiring but the churn log update in step 3 may reference non-existent env vars (harmless — it's just a log string).
- **Global rollback**: `git checkout -- apps/recorder/Sources/StreamCapture.swift apps/recorder/Sources/main.swift MVP-FINAL-PUSH.md && rm -f apps/recorder/Sources/ScreenLockObserver.swift`
- **Independent failures**: WU-1 and WU-2 are fully independent — failure of one does not affect the other.
