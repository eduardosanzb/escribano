# ADR-013: Energy Efficiency for Always-On Recorder

## Status

| State    | Date       | Details                                                                 |
|----------|------------|-------------------------------------------------------------------------|
| Proposed | 2026-03-20 | Spike — design exploration for energy-aware recorder behavior           |

## Context

### The Energy Problem

The always-on recorder (ADR-009) was developed and validated on an M4 Max with 128 GB unified memory. On this machine, the energy cost of continuous capture + VLM analysis is invisible. On a target user's MacBook Air M2 (8 GB), the same workload could mean constant fan spin, shortened battery life, and a poor experience.

### Current Architecture

A single Swift process runs two async tasks:

1. **StreamCapture** — SCStream frame delivery at 1 fps, pHash dedup (vDSP DCT per frame), backpressure monitoring
2. **FrameAnalyzer** — polls for unanalyzed frames every 10 s, claims a batch, sends to Python VLM bridge via Unix socket

Plus a **Python bridge** (`mlx_bridge.py`) holding a ~2 GB VLM model (Qwen3-VL-2B-Instruct-4bit) in GPU memory indefinitely, blocking on socket `accept()` between requests.

### What Runs Continuously

| Component | Activity | Frequency |
|-----------|----------|-----------|
| SCStream | Frame delivery | 1 fps (macOS-driven) |
| pHash dedup | vDSP DCT per frame | 1/s |
| FrameAnalyzer | Poll + claim + infer | Every 10 s |
| Backpressure check | `COUNT(*) WHERE analyzed = 0` | Every 10th capture |
| Backpressure resume timer | Check if below low-water mark | Every 5 s (when paused) |
| Python bridge | Blocking `recv()` on Unix socket | Continuous (near-zero CPU when idle) |

### No Existing Energy Awareness

- No sleep/wake hooks (`main.swift` has no `NSWorkspace` notification subscriptions)
- No Low Power Mode detection
- No thermal throttling response
- No battery-aware behavior

## Problem Areas

### A. FrameAnalyzer Unconditional 10 s Polling

`FrameAnalyzer.swift:33` — hardcoded `pollInterval = 10.0`. When `claimFrames()` returns empty (`FrameAnalyzer.swift:52-54`), the analyzer sleeps 10 s and loops with no backoff.

**Impact during active work**: None — frames are always pending, polling is appropriate.

**Impact during idle** (screen locked, screensaver, user away): 8,640 unnecessary CPU wakes per day (24 h × 360 wakes/h). Each wake is cheap individually, but the pattern prevents the CPU from entering deep idle states and inflates macOS Activity Monitor's "Energy Impact" score.

### B. Python VLM Bridge Never Unloads

- `mlx_bridge.py:627` — model loaded on startup into global state
- `mlx_bridge.py:648-656` — infinite `accept()` + `recv()` loop with no idle timeout
- `mlx_bridge.py:134-149` — `unload_vlm()` exists but is never called automatically

**Memory**: ~2 GB GPU RAM locked permanently. On an 8 GB machine this is 25% of total unified memory, causing memory pressure for all other applications.

**CPU**: Near-zero when idle (kernel blocks on `recv()`). The issue is not CPU — it's GPU memory fragmentation and system-wide memory pressure.

### C. No System State Awareness

`main.swift` subscribes to no `NSWorkspace` notifications. The recorder does not respond to:

- Screen lock / unlock
- Lid close / open
- System sleep / wake
- Low Power Mode toggle
- Thermal pressure changes

**SCStream behavior on lid close**: macOS stops delivering frames (stream goes quiet), but the process stays alive and FrameAnalyzer keeps polling an empty queue every 10 s. If frames were queued before close, VLM inference continues — fans can spin even with the lid closed.

## Design Trade-offs

### A. Exponential Backoff in FrameAnalyzer

| Aspect | Details |
|--------|---------|
| **Change** | When `claimFrames()` returns empty, double sleep interval: 10 s → 20 s → 40 s → cap at 120 s. Reset to 10 s on non-empty batch. |
| **Pros** | Trivial Swift change (~10 lines). No architecture change. Cuts idle wakes from 8,640/day to ~720/day (12× reduction). Zero impact during active work (backoff never triggers when frames are pending). |
| **Cons** | After a long idle period (e.g. lunch break), first batch after resume waits up to 120 s. Up to 2 minutes of unanalyzed frames when user returns. |
| **Mitigation** | Reset backoff immediately on backpressure resume signal (user starts working → frames flow → backpressure triggers → reset poll interval). This couples the two systems but is architecturally clean since backpressure already has `onPause`/`onResume` callbacks. |
| **Risk** | None — worst case is slightly delayed analysis after idle, which users won't notice since they aren't looking at real-time analysis. |
| **POC** | Instrument FrameAnalyzer to log `(batchSize, sleepInterval)` tuples. Run recorder for a full workday. Plot idle gap distribution. Validate that 120 s cap doesn't create visible analysis lag. |
| **Complexity** | Very low (1–2 hours) |

### B. VLM Idle Timeout + Auto-Unload

| Aspect | Details |
|--------|---------|
| **Change** | In `mlx_bridge.py`, track `last_inference_time`. Background thread checks every 60 s. If idle > `ESCRIBANO_VLM_IDLE_TIMEOUT` (default 5 min), call `unload_vlm()` + `mx.metal.clear_cache()`. Re-load on next `infer_vlm` request. |
| **Pros** | Frees ~2 GB GPU RAM during extended idle. Critical for 8 GB machines. Metal cache cleared = GPU memory available for other apps. |
| **Cons** | Model reload takes 2–5 s on M-series (weights from disk cache). During active work, timeout never fires (frames arrive every few seconds). Unclear if reload latency causes frame analysis backlog (5 s delay × 5 accumulated frames = small backlog, caught up in next batch). |
| **Key unknown** | What's the p50/p95 gap between frame batches during active work? If the user switches to a meeting (Zoom fullscreen, no screen changes), pHash dedup skips most frames → batch gaps could exceed 5 min during meetings even though the user is "active." Unloading mid-meeting then reloading when they return to code is wasteful churn. |
| **Mitigation** | Use a longer timeout (15–30 min) to avoid churn. Or: only unload when system is idle (screen locked), not just when frames are empty. |
| **Risk** | On first run or after unload, model download from HuggingFace Hub is cached locally (~2 GB). Subsequent loads read from `~/.cache/huggingface/`. But if cache is evicted (disk pressure), reload triggers a re-download — catastrophic UX failure (user returns from lunch → recorder stalls for minutes downloading a model). Need to verify cache persistence guarantees. |
| **POC** | 1) Measure model reload time on M2 Air vs M4 Pro. 2) Instrument `last_inference_time` gaps across a real workday. 3) Test cache persistence after `mx.metal.clear_cache()` (Metal cache ≠ disk cache — verify). |
| **Complexity** | Medium (4–6 hours) |

> **User concern**: "I'm unsure if it will always be unloaded because we are constantly using it" — Valid. During active work, the timeout never fires. The benefit is exclusively for extended idle periods (lunch, overnight, meetings). If the app is working as intended (always analyzing), the unload path rarely activates.

### C. System Sleep/Wake Hooks

| Aspect | Details |
|--------|---------|
| **Change** | In `main.swift`, subscribe to `NSWorkspace.shared.notificationCenter` for sleep/wake events. On sleep: pause all captures, cancel FrameAnalyzer task. On wake: resume captures, restart analyzer. |
| **Pros** | Most user-visible improvement. Fans go silent immediately on lid close. No wasted CPU/GPU during lock screen. Natural "pause" semantics that users expect. |
| **Cons** | SCStream behavior on sleep is undocumented. Does `stopCapture()` need to be called, or does macOS automatically stop delivering frames? Need to test: does SCStream resume cleanly after `startCapture()` following wake, or does it need full teardown/rebuild? |

**Available notifications:**

| Notification | Fires when |
|-------------|------------|
| `NSWorkspace.screensDidSleepNotification` | Display turns off |
| `NSWorkspace.screensDidWakeNotification` | Display turns on |
| `NSWorkspace.willSleepNotification` | System about to sleep |
| `NSWorkspace.didWakeNotification` | System woke from sleep |

**Risks:**

1. **Race condition on wake**: user opens lid → `screensDidWake` fires → we call `startCapture()` → but SCStream needs the display to be fully initialized. May need a short delay (0.5–1 s) after wake before restarting.
2. **Multiple displays**: external monitor disconnect ≠ sleep. If user unplugs external monitor, we get a display removal, not a sleep event. Current code doesn't handle display hotplug at all. Related but separate concern.
3. **VLM bridge during sleep**: if we pause the analyzer but leave the Python bridge running, it blocks on `recv()` (near-zero CPU, fine). If we kill the bridge on sleep, we pay the 30–120 s startup cost on wake. **Trade-off**: leave the bridge alive during sleep (0 % CPU cost), but unload the model (free GPU RAM). This combines the sleep hook with the idle unload.

| | |
|--------|---------|
| **POC** | 1) Subscribe to all four notifications, log timestamps. 2) Test SCStream behavior: does it auto-stop on sleep? Does it resume on wake? 3) Measure wake-to-first-frame latency with and without stream restart. |
| **Complexity** | Medium (4–8 hours, mostly testing edge cases) |

### D. Low Power Mode Awareness

| Aspect | Details |
|--------|---------|
| **Change** | Monitor `ProcessInfo.processInfo.isLowPowerModeEnabled` + subscribe to `NSProcessInfoPowerStateDidChangeNotification`. When Low Power Mode activates: reduce capture interval (1 fps → 0.2 fps), increase pHash threshold (4 → 8, more aggressive dedup), increase poll interval (10 s → 60 s). |
| **Pros** | Graceful degradation instead of all-or-nothing. User still gets work tracking, just at lower fidelity. Respects user's explicit "save battery" signal. |
| **Cons** | Lower temporal resolution = potential gaps in work history. Users who enable Low Power Mode permanently would always get degraded quality. |
| **Key unknown** | Does ScreenCaptureKit's `minimumFrameInterval` support dynamic updates? Can we call `stream.updateConfiguration()` at runtime, or do we need to stop/restart the stream? Apple docs suggest `updateConfiguration` works, but needs testing. |
| **POC** | 1) Toggle Low Power Mode → verify notification fires. 2) Test `stream.updateConfiguration()` with new `minimumFrameInterval`. 3) Compare artifact quality at 1 fps vs 0.2 fps over a 1-hour session. |
| **Complexity** | Low–medium (3–4 hours) |

### E. Battery Threshold Gate

| Aspect | Details |
|--------|---------|
| **Change** | Check battery level via IOKit `IOPSCopyPowerSourcesInfo` on startup and periodically. If on battery below threshold (e.g. 20 %), pause all capture + analysis. |
| **Pros** | Prevents escribano from being the thing that kills your battery on a flight. |
| **Cons** | Binary on/off is jarring. User loses work tracking below threshold. Could combine with Low Power Mode for smoother ramp-down. |
| **Key unknown** | Desktop Macs (iMac, Mac Mini, Mac Studio) don't have batteries — need to handle gracefully (always report "plugged in"). |
| **Complexity** | Low (2–3 hours) |

## Unknowns & Open Questions

1. **SCStream on sleep** — Does ScreenCaptureKit auto-pause when display sleeps? Do we need explicit stop/start? What happens to the stream filter when a display disconnects?
2. **Model reload latency on constrained hardware** — What's the reload time for Qwen3-VL-2B-4bit on an M2 Air (8 GB)? Is it bounded by disk I/O or compute?
3. **pHash cost on constrained hardware** — The vDSP DCT runs on every frame (1 fps = 60/min). On an M2 with 4 efficiency cores, is this measurably expensive?
4. **HuggingFace cache after Metal clear** — Does `mx.metal.clear_cache()` affect the on-disk model cache? (It shouldn't — Metal cache is GPU memory, not disk — but must verify.)
5. **FrameAnalyzer batch gap distribution** — During real work, what's the typical gap between non-empty batches? This determines whether VLM idle timeout is practical.
6. **macOS Energy Impact score** — Does Activity Monitor's "Energy Impact" metric react to our optimizations? Can we measure before/after?
7. **Backpressure resume timer during sleep** — If the system sleeps while backpressure is paused (timer firing every 5 s), does the timer continue firing? macOS should coalesce timers during sleep, but verify.

## Decision

### Proposed Phased Approach

**Phase 1 — Ship first, low risk (1–2 days):**

- Exponential backoff in FrameAnalyzer (10 s → 120 s cap with reset on non-empty batch)
- Sleep/wake hooks (pause capture + analyzer on sleep, resume on wake)

**Phase 2 — Instrument & measure (1 day + 1 week data collection):**

- Add `last_inference_time` logging to `mlx_bridge.py`
- Add energy metrics to `monitor-resources.ts` (battery %, thermal state)
- Run instrumented recorder for 1 week, collect data

**Phase 3 — Data-driven decisions (2–3 days):**

- Based on Phase 2 data: decide VLM idle timeout threshold
- Low Power Mode throttling (if user demand exists)
- Battery threshold gate

## Measurement & Verification Plan

### Before/After `powermetrics`

```bash
sudo powermetrics --samplers cpu_power,gpu_power -i 5000 -n 60
```

Run for 5 minutes in each state: idle with recorder, idle without recorder.

### Activity Monitor

Screenshot "Energy Impact" and "12 hr Power" columns before/after each phase.

### Custom Instrumentation

Log tuples to CSV for post-hoc analysis:

```
timestamp, batchSize, pollInterval, isPaused, isScreenAsleep
```

### User-Facing Metric

Extend `escribano recorder status` with energy summary:

- Model loaded: yes/no
- Capture state: active / paused / sleeping
- Poll interval: current value
- Frames analyzed in last hour

## Consequences

### Positive

- **Battery life** — Users on battery see meaningful improvement from Phase 1 alone
- **Memory pressure** — VLM unload (Phase 3) frees 2 GB on constrained machines
- **User trust** — Escribano respects system signals (Low Power Mode, sleep) instead of fighting them
- **Measurable** — Each phase has concrete before/after metrics

### Negative

- **Latency after idle** — Exponential backoff introduces up to 120 s delay after long idle periods
- **Reload cost** — VLM unload/reload adds 2–5 s latency on first inference after idle
- **Complexity** — Sleep/wake hooks add edge cases (race conditions, display hotplug, SCStream teardown)
- **Testing surface** — Energy behavior is hardware-dependent; can't fully validate on dev machine

### Neutral

- No changes to the Node.js pipeline or artifact generation
- Python bridge process stays alive during sleep (zero CPU cost) — only the model is unloaded
- Existing batch pipeline (`--file` mode) is unaffected

## Deferred Decisions

| Topic | Reasoning |
|-------|-----------|
| **Thermal pressure response** | macOS provides `ProcessInfo.ThermalState` notifications. Could throttle capture when thermal state reaches `.serious` or `.critical`. Deferred until Phase 2 instrumentation reveals whether escribano contributes meaningfully to thermal pressure. |
| **Per-display energy budgeting** | Multi-display setups have different energy profiles. Could skip capture on secondary displays during Low Power Mode. Deferred until multi-display usage patterns are observed. |
| **Menu bar energy indicator** | Show battery/energy state in the menu bar UI (Phase 4 of ADR-009). Deferred until menu bar exists. |
| **User-configurable energy profiles** | "Performance" vs "Balanced" vs "Efficiency" presets. Over-engineering until we have real usage data from Phase 2. |

## Alternatives Considered

| Alternative | Rejected Because |
|-------------|------------------|
| **Kill Python bridge on sleep** | 30–120 s startup cost on wake is unacceptable latency. Better to keep bridge alive (zero CPU) and only unload the model. |
| **Reduce capture to 0.1 fps always** | Degrades quality for all users, not just battery-constrained ones. Adaptive approach (Low Power Mode, backoff) is strictly better. |
| **Separate "lite" recorder binary** | Doubles maintenance burden. Single binary with runtime adaptation is simpler. |
| **Use `launchd` throttling (ThrottleInterval)** | Only controls process spawn frequency, not in-process behavior. Doesn't help with FrameAnalyzer polling or VLM memory. |
| **Offload VLM to cloud** | Adds network dependency, latency, cost, and privacy concerns. Local inference is a core design principle (ADR-006). |

## References

- [ADR-009: Always-On Screen Recorder](009-always-on-recorder.md) — Capture architecture, backpressure, concurrency model
- [ADR-010: Swift-Native Visual Intelligence](010-swift-native-visual-intelligence.md) — VLM analyzer integration in Swift process
- [Apple: Improving Your App's Performance (Energy Efficiency Guide)](https://developer.apple.com/documentation/xcode/improving-your-app-s-performance)
- [Apple: NSWorkspace Notifications](https://developer.apple.com/documentation/appkit/nsworkspace) — Sleep/wake, screen sleep/wake
- [Apple: NSProcessInfo.isLowPowerModeEnabled](https://developer.apple.com/documentation/foundation/nsprocessinfo/islowpowermodeenabled)
- [Apple: ProcessInfo.ThermalState](https://developer.apple.com/documentation/foundation/processinfo/thermalstate)
- [`powermetrics` man page](https://www.unix.com/man-page/osx/1/powermetrics/) — CPU/GPU power sampling
