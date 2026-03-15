# ScreenCaptureKit POC Spike

**Date:** March 12, 2026
**Hardware:** MacBook Pro M4 Max (128GB unified memory)
**Status:** **Phase A (SCScreenshotManager) complete** — **Phase B (SCStream) complete** — **Phase C (pHash dedup) complete** — all validated 2026-03-12

---

## Goal

Validate that a standalone Swift CLI using ScreenCaptureKit can:

1. Run headlessly (no visible window) when launched interactively
2. Take periodic screenshots on a timer
3. Capture all connected displays
4. Persist TCC permissions across binary restarts

For this spike, execution is **interactive-only** — launchd `LaunchAgent` plists and daemonization are explicitly **out of scope** and will be validated in a later phase.
This is **throwaway code** — isolated from the main Escribano pipeline. Delete after findings are incorporated into Phase 1 implementation.

Analogous to: earlier MLX-VLM proof-of-concept spike
Outcome feeds into: `docs/adr/009-always-on-recorder.md` + Phase 1 implementation

---

## Research Summary (from @researcher agent, 2026-03-12)

### Thesis
Use `SCScreenshotManager.captureImage` in a headless `NSApplication` with Swift 5.9 SPM for a simple periodic-capture CLI.

### Antithesis
1. Repeated `captureImage` calls are inefficient — `SCStream` is better for periodic capture (no per-call setup/teardown overhead).
2. TCC permissions are path-based; replacing the CLI binary may invalidate the grant (workaround: `lsregister -f`).

### Synthesis
Adopt `SCStream` for efficient periodic multi-display capture, implement Swift 6 Task-based timing, and reference Peekaboo for production-ready patterns.

### Key Findings Table

| Question | Pre-Spike | Post-Spike Result |
|---|---|---|
| Headless CLI? | Partially validated | **CONFIRMED** — `NSApplication.shared.run()` works without visible UI |
| TCC persists across restart? | Partially validated | **CONFIRMED** — path-based on macOS 15.3.2, survives binary replace |
| TCC staleness after binary update? | "Goes stale, needs lsregister -f" | **DISPROVED** — no re-prompt after binary replacement on macOS 15.3.2 |
| `SCScreenshotManager` works? | Validated (macOS 14+) | **CONFIRMED** — returns valid frames headlessly |
| Multi-monitor support? | Validated | **CONFIRMED** — implemented in Phase 1 |
| Efficient periodic capture? | `SCStream` recommended | **CONFIRMED** — `minimumFrameInterval=5s` delivers exactly 1 frame/5s, no Timer needed |

---

## Phase D: Phase 1 Agent Validation (Real-World)

**Status:** Complete (2026-03-13)
**Hardware:** MacBook Pro M4 Max (128GB unified memory)

This phase validates the actual Fotógrafo agent implementation against real-world scenarios, extending the findings from Phase C.

### Actual Agent Performance

| Metric | Phase 1 Result |
|---|---|
| Memory usage | ~34 MB |
| CPU usage | ~1.6% (single core) |
| Multi-display | **CONFIRMED** — Captured both built-in and external displays independently |
| pHash Threshold | **REVISED** — 8 bits was too aggressive; lowered to **4 bits** default |

### pHash Calibration Findings

Empirical testing with the production agent revealed a more nuanced noise floor:

1. **Idle Noise**: 0-4 bits (matches Phase C).
2. **Raycast / Spotlight**: Opening Raycast on a dark background produced a hamming distance of **6 bits**. With the original threshold of 8, this meaningful change was skipped.
3. **Typing**: Low-contrast typing (e.g., in a dark terminal) produced **2-4 bits**.
4. **Contrast Sensitivity**: pHash is highly sensitive to the magnitude of contrast change. Light-on-dark changes produce higher distances than dark-on-dark.

**Conclusion**: The default threshold was lowered to **4 bits** to ensure high-contrast UI elements (like Raycast) are captured, while still filtering clock ticks and cursor blinks. The threshold is now configurable via `ESCRIBANO_PHASH_THRESHOLD`.

---

## Decisions Locked for Phase 1

| Decision | Confirmed Choice |
|---|---|
| macOS minimum target | **15** — using swift-tools-version 6.0 and macOS(.v15) in Phase B; both APIs available on 12.3+/14+ so 15 is fine for dev |
| Capture API | **`SCStream`** — confirmed by Phase B: persistent session, exact 1s-5s interval, no Timer needed |
| Swift concurrency model | **`@MainActor final class` + `sampleHandlerQueue: .main` + `MainActor.assumeIsolated`** — validated pattern for SCStreamOutput conformance in Swift 6 |
| Non-Sendable C type bridging | **`nonisolated(unsafe) let`** on local variable binding before `assumeIsolated` closure |
| TCC staleness fix | **None needed on macOS 15.3.2** — path-based, survives binary replacement |
| Run loop approach | **`NSApplication.shared.run()`** — confirmed working headlessly |
| Frame format | **JPEG 0.85** — ~50–100KB per frame at half-res, quality adequate |
| Timing mechanism | **`SCStream.minimumFrameInterval`** — no Timer needed, stream handles cadence |
| Display ID strategy | **CoreGraphics `CGDirectDisplayID`** for stable cross-session ID; `SCDisplay.displayID` is session-local only |
| Concurrency pattern | **Swift 6 `Task`** for daemon lifecycle; `assumeIsolated` (not Task) for per-frame callback |
| **Dedup algorithm** | **pHash with threshold ≤ 4 (v2)** — tuned for better sensitivity to low-contrast UI changes |
| **Multi-display** | **Implemented in Phase 1** — no longer deferred to Phase 4 |


---

## Next Steps

1. [x] **Phase A complete** — SCScreenshotManager validated, learnings documented above
2. [x] Update `.gitignore` for `.build/` artifacts
3. [x] **Phase B complete** — SCStream validated, Swift 6 patterns confirmed
4. [x] **Phase C complete** — pHash dedup threshold validated, algorithm chosen
5. [x] Update `docs/adr/009-always-on-recorder.md` with dedup strategy
6. [ ] Begin **Phase 1**: `apps/recorder/` Swift package with pHash threshold=8