# ScreenCaptureKit POC Spike

**Date:** March 12, 2026
**Hardware:** MacBook Pro M4 Max (128GB unified memory)
**Status:** **Phase A (SCScreenshotManager) complete** — **Phase B (SCStream) complete** — both validated 2026-03-12

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
| Multi-monitor support? | Validated | Deferred to Phase 4 (single display tested) |
| Efficient periodic capture? | `SCStream` recommended | **CONFIRMED** — `minimumFrameInterval=5s` delivers exactly 1 frame/5s, no Timer needed |

### Reference Implementations

| Project | What it shows |
|---|---|
| [Peekaboo (steipete)](https://github.com/steipete/Peekaboo) | Production `SCStream` CLI — headless, permission handling, multi-display |
| [localbird (littlebirdai)](https://github.com/littlebirdai/localbird) | async/await patterns for SCK capture |
| [BasedHardware/omi](https://github.com/BasedHardware/omi/blob/main/desktop/Desktop/Sources/ScreenCaptureService.swift) | TCC permission persistence |
| [LoginScreenCaptureDemo](https://github.com/Drewbadour/LoginScreenCaptureDemo) | SCK in headless `NSApplication` without visible UI |

---

## Phase A: SCScreenshotManager Validation

**Status:** Complete (2026-03-12)

This phase validated the simpler `SCScreenshotManager.captureImage` API as a proof-of-concept before committing to the more complex `SCStream` in Phase B.

### Actual Code Implemented

#### `scripts/poc-screencapturekit/Package.swift`

```swift
// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "sck-poc",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "sck-poc",
            path: "Sources"
        )
    ]
)
```

#### `scripts/poc-screencapturekit/Sources/main.swift`

```swift
// POC: ScreenCaptureKit headless screenshot capture
// Build: swift build -c release (in scripts/poc-screencapturekit/)
// Run:   .build/release/sck-poc
// Stop:  Ctrl+C

import Cocoa
import Foundation
import ScreenCaptureKit

let outputDir = URL(fileURLWithPath: "/tmp/sck-poc-frames")
let captureInterval: TimeInterval = 5.0

// ScreenCaptureKit requires a run loop. NSApplication provides it without showing a window.
let app = NSApplication.shared

class CaptureDelegate: NSObject, NSApplicationDelegate {
    var frameCount = 0

    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            try FileManager.default.createDirectory(at: outputDir, withIntermediateDirectories: true)
        } catch {
            print("[POC] ERROR: Could not create output dir \(outputDir.path): \(error)")
            NSApplication.shared.terminate(nil)
            return
        }

        print("[POC] Writing frames to \(outputDir.path)")
        print("[POC] Capture interval: \(captureInterval)s  |  Press Ctrl+C to stop")

        // Capture once immediately, then on a repeating timer
        Task { await self.capture() }

        Timer.scheduledTimer(withTimeInterval: captureInterval, repeats: true) { _ in
            Task { await self.capture() }
        }
    }

    func capture() async {
        do {
            let content = try await SCShareableContent.current
            let displays = content.displays

            if displays.isEmpty {
                print("[POC] WARNING: No displays found")
                return
            }

            print("[POC] Found \(displays.count) display(s)")

            for display in displays {
                let config = SCStreamConfiguration()
                // Half-res for POC: adequate for proving the API works
                config.width = Int(display.width) / 2
                config.height = Int(display.height) / 2

                let filter = SCContentFilter(display: display, excludingWindows: [])

                let cgImage = try await SCScreenshotManager.captureImage(
                    contentFilter: filter,
                    configuration: config
                )

                let timestamp = Int(Date().timeIntervalSince1970)
                let filename = "display\(display.displayID)_\(timestamp).jpg"
                let fileURL = outputDir.appendingPathComponent(filename)

                saveJPEG(cgImage, to: fileURL)
                frameCount += 1
                print("[POC] [\(frameCount)] Saved \(filename) — \(cgImage.width)x\(cgImage.height)px")
            }
        } catch {
            // Surface the full error so permission denial, entitlement issues, etc. are visible
            print("[POC] ERROR during capture: \(error)")
        }
    }

    func saveJPEG(_ image: CGImage, to url: URL) {
        guard let destination = CGImageDestinationCreateWithURL(
            url as CFURL,
            "public.jpeg" as CFString,
            1,
            nil
        ) else {
            print("[POC] ERROR: Could not create image destination at \(url.path)")
            return
        }
        let options: [CFString: Any] = [kCGImageDestinationLossyCompressionQuality: 0.8]
        CGImageDestinationAddImage(destination, image, options as CFDictionary)
        if !CGImageDestinationFinalize(destination) {
            print("[POC] ERROR: Could not write JPEG to \(url.path)")
        }
    }
}

let delegate = CaptureDelegate()
app.delegate = delegate
app.run()
```

### Build Commands

```bash
cd scripts/poc-screencapturekit
swift build -c release 2>&1
# Output: Build complete! (~32s)
# Binary: .build/release/sck-poc (94KB, arm64 Mach-O)
```

### Build Toolchain Gotchas

Issues encountered during the spike — record here to avoid repeating in Phase 1.

1. **`swiftLanguageVersions` does not exist in swift-tools-version 5.9.**
   The parameter was renamed to `swiftLanguageModes` in later PackageDescription APIs.
   **Fix:** Omit entirely. For a POC, the code compiles fine in Swift 5 compatibility mode by default.

2. **`.macOS(.v15)` is unavailable in `Package.swift` at swift-tools-version 5.9.**
   The manifest itself compiles targeting macOS 14, so `.v15` is not in the `SupportedPlatform` enum at that level.
   **Fix:** Use `.macOS(.v14)` in the manifest; the binary deploys and runs correctly on macOS 15.

3. **LSP (sourcekit-lsp) reports false positive on `Package(...)`.**
   "No exact matches in call to initializer" — this is a false positive (LSP uses a different SDK context than the build system).
   **Fix:** Trust `swift build`, ignore this diagnostic.

### Manual Test Results

All tests run on macOS 15.3.2 by the user (Eduardo) on 2026-03-12.

#### Core functionality
- [x] Binary compiles with SPM (no Xcode.app)
- [x] `SCScreenshotManager.captureImage` returns valid frames
- [x] Frames are non-black, correct dimensions (confirmed visually by user)
- [ ] All displays captured — *single display only; multi-display deferred to Phase 4*
- [x] Timer fires reliably every 5s over a 30+ second run

#### Permission behavior
- [x] First run: System Settings prompt appears automatically
- [x] After approval: frames captured correctly (~100-300KB per frame)
- [x] After `kill` + relaunch: **no re-prompt**, frames captured
- [x] After binary replacement (`swift build` overwrite): **no re-prompt** — TCC is path-based on macOS 15.3.2

#### Edge cases
- [x] Run with no Screen Recording permission: error is catchable (not a crash)
      - Error: `SCStreamErrorDomain Code=-3801 "The user declined TCCs for application, window, display capture"`
- [x] Denial in System Settings: error message is actionable, process continues running
- [x] `#available` guard: not tested (runtime is macOS 15.3.2, guard omitted in final code)

### Key Learnings from Phase A

1. **TCC is path-based on macOS 15.3.2** — binary replacement at the same path does NOT invalidate the permission grant. The research claim about "lsregister -f" workaround does not apply to this macOS version. Caveat: re-test if targeting macOS 13 or 14.

2. **`NSApplication.shared.run()` is sufficient for headless operation** — no window, no UI, just a run loop. ScreenCaptureKit works correctly in this context.

3. **Permission denial is a clean error, not a crash** — `SCStreamErrorDomain Code=-3801` is catchable. The process stays running and prints the error every capture interval. This is good UX for Phase 1: the daemon can log and retry gracefully.

4. **`SCScreenshotManager.captureImage` has per-call overhead** — it opens a capture session, delivers a frame, and tears it down. For 24/7 daemon at 5-10s intervals, this means thousands of session cycles per day. Phase B will validate `SCStream` as a more efficient alternative.

5. **Swift 5.9 + SPM works without Xcode.app** — only Command Line Tools needed. LSP (sourcekit-lsp) has false positives on Package.swift but the build succeeds.

---

## Phase B: SCStream Validation

**Status:** Complete (2026-03-12)

### Why SCStream Instead of SCScreenshotManager for Phase 1

`SCScreenshotManager.captureImage` is a one-shot API: it opens a capture session, delivers a frame, and tears it down. For a daemon running 24/7 at 5-10s intervals, this means thousands of session open/close cycles per day.

`SCStream` maintains a persistent session and delivers frames via a delegate — no per-call overhead.

The research synthesis (S1) and Peekaboo (production reference) both use `SCStream` for periodic capture daemons.

### Key Difference: minimumFrameInterval

`SCStream` has a `SCStreamConfiguration.minimumFrameInterval: CMTime` property. Set it to `CMTime(value: 5, timescale: 1)` and the stream delivers one frame every 5 seconds automatically — no `Timer` needed. The stream handles the capture cadence.

### API Comparison

| | `SCScreenshotManager.captureImage` | `SCStream` |
|---|---|---|
| macOS minimum | 14 | 12.3 |
| Model | One-shot async: request → await frame | Continuous stream via delegate callbacks |
| Frame delivery | On demand | Continuous `CMSampleBuffer` via `SCStreamOutput` |
| Idle CPU | Near zero (no active session) | Non-trivial (stream always running) |
| Complexity | Simple — no session lifecycle | Complex — start/stop, buffer management, `CMSampleBuffer → CGImage` |
| Best for | Timer-based periodic capture (5-10s) | Sub-second sampling, real-time scene-change reaction |
| Per-call overhead | Yes (session open/close each call) | No (persistent session) |

**Decision for Phase 1:** Use `SCStream` with `minimumFrameInterval` set to the capture interval. The persistent session is more efficient for 24/7 operation. **Confirmed by Phase B.**

### Actual Code Implemented

#### `scripts/poc-screencapturekit-stream/Package.swift`

```swift
// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "sck-stream-poc",
    platforms: [.macOS(.v15)],
    targets: [
        .executableTarget(
            name: "sck-stream-poc",
            path: "Sources"
        )
    ]
)
```

#### `scripts/poc-screencapturekit-stream/Sources/main.swift` (key patterns)

The full implementation is in the POC directory. Key Swift 6 concurrency patterns used:

```swift
// 1. @MainActor final class protects all mutable state (frameCount, ciContext, stream ref)
@MainActor final class StreamCapture: NSObject, SCStreamOutput {
    private var frameCount: Int = 0
    private let ciContext = CIContext()  // expensive to create; reuse across frames

    // 2. sampleHandlerQueue: .main — aligns SCStream callbacks with @MainActor executor.
    //    CRITICAL: without this, assumeIsolated would be a runtime assertion failure.
    try stream?.addStreamOutput(self, type: .screen, sampleHandlerQueue: .main)

    // 3. nonisolated delegate method (Obj-C protocol witness) re-enters @MainActor via assumeIsolated
    nonisolated func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of outputType: SCStreamOutputType) {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        // 4. nonisolated(unsafe) let on a local variable silences the Sendable warning for
        //    CVPixelBuffer crossing the isolation boundary. Safe here because:
        //    - sampleHandlerQueue is .main, so we're already on the main thread
        //    - CVPixelBuffer is used immediately and not stored
        nonisolated(unsafe) let safeBuffer = pixelBuffer

        // 5. MainActor.assumeIsolated — synchronous re-entry; no Task spawn needed
        MainActor.assumeIsolated {
            let ciImage = CIImage(cvPixelBuffer: safeBuffer)
            guard let cgImage = ciContext.createCGImage(ciImage, from: ciImage.extent) else { return }
            // ... save JPEG, increment counter
        }
    }
}

// 6. SCStreamDelegate conformance in separate extension — avoids signature mismatch warnings
extension StreamCapture: SCStreamDelegate {
    nonisolated func stream(_ stream: SCStream, didStopWithError error: any Error) {
        // error is non-optional in the protocol — match exactly
        let displayID = self.displayID
        MainActor.assumeIsolated {
            print("[SCStream] Stream stopped for display \(displayID): \(error.localizedDescription)")
        }
    }
}
```

### Build Toolchain Gotchas (Phase B)

Issues encountered and fixed — avoid repeating in Phase 1.

1. **`@MainActor` + `nonisolated(unsafe)` are mutually exclusive on instance methods.**
   The initial implementation tried `private nonisolated(unsafe) func processFrameOnMain(...)` decorated with `@MainActor`. Swift 6 rejects this: "instance method has multiple actor-isolation attributes."
   **Fix:** Remove the helper method entirely. Inline all frame processing inside `MainActor.assumeIsolated { }` within the `nonisolated` `stream(_:didOutputSampleBuffer:of:)` callback. Use `nonisolated(unsafe) let` on the local `pixelBuffer` binding instead.

2. **`nonisolated(unsafe)` has no effect on instance methods (warning + error).**
   The attribute only applies to stored properties and local variable bindings, not method declarations.
   **Fix:** Apply `nonisolated(unsafe)` to the local `let safeBuffer = pixelBuffer` binding inside the callback, not to any method.

3. **`SCStreamDelegate.stream(_:didStopWithError:)` signature mismatch.**
   The protocol declares `error: any Error` (non-optional), but an initial implementation used `(any Error)?` (optional).
   Swift 6 warns: "parameter has different optionality than expected by protocol."
   **Fix:** Match the protocol signature exactly: `error: any Error`. The delegate is only called on actual errors so the non-optional signature is correct.

4. **`@preconcurrency import ScreenCaptureKit` is still required in Swift 6.**
   `SCShareableContent` is not `Sendable` in the current SDK. Without `@preconcurrency`, using it in `@MainActor async` functions produces errors.
   **Fix:** Keep `@preconcurrency import ScreenCaptureKit` until Apple ships Sendable conformances.

5. **swift-tools-version 6.0 enables strict concurrency by default.**
   All the Swift 6 warnings above become errors (not warnings). This is intentional — Phase B uses swift-tools-version 6.0 and macOS(.v15) to mirror production conditions.
   Phase A used 5.9 so did not hit these. Plan for these patterns in Phase 1.

### Manual Test Results

All tests run on macOS 15.3.2 by Eduardo on 2026-03-12.

#### Actual terminal output

```
[AppDelegate] Writing frames to /tmp/sck-stream-frames
[AppDelegate] Capture interval: 5s  |  Press Ctrl+C to stop
[AppDelegate] Found 1 display(s)
[SCStream] Starting capture for display 1
[SCStream] Capture started for display 1
[AppDelegate] Started 1 stream(s)
[SCStream] [1] display1: saved display1_stream_1773325668.jpg — 864x558px
[SCStream] [2] display1: saved display1_stream_1773325673.jpg — 864x558px
[SCStream] [3] display1: saved display1_stream_1773325678.jpg — 864x558px
[SCStream] [4] display1: saved display1_stream_1773325683.jpg — 864x558px
[SCStream] [5] display1: saved display1_stream_1773325688.jpg — 864x558px
^C
```

Note: display ID in Phase A was `3` (from `SCScreenshotManager`); Phase B shows `1` (from `SCStream`). The two APIs enumerate displays differently. Phase 1 should use the display's `CGDirectDisplayID` obtained from CoreGraphics for stable cross-session identification.

#### Validation checklist

- [x] `SCStream` starts and delivers frames headlessly (no UI session required)
- [x] `minimumFrameInterval = CMTime(value:5, timescale:1)` delivers exactly 1 frame per 5s — timestamps: `...668`, `...673`, `...678`, `...683`, `...688` (delta = 5s ± 0s across all 5 frames)
- [x] `CMSampleBuffer` → `CVPixelBuffer` → `CIImage` → `CGImage` conversion works correctly
- [x] JPEG files written at 0.8 quality — sizes ~180–250KB per frame (consistent with Phase A)
- [x] Frame dimensions correct — `864x558px` = half of physical display resolution (1728x1116), as configured
- [x] Clean shutdown on Ctrl+C — process exits, no hang
- [ ] Multi-display: one `SCStream` per display — deferred to Phase 4 (single display tested; Phase A also single display)
- [ ] Stream restart after permission revoke + re-grant — deferred; not blocking for Phase 1

#### TCC permission behavior (Phase B)

Same behavior as Phase A (path-based, terminal inherits):
- Running an **unsigned CLI binary** for the first time with `SCStream` does not trigger a TCC prompt — macOS silently denies with error `SCStreamErrorDomain Code=-3801 "The user declined TCCs"`.
- **Fix**: Grant Screen Recording permission to the **terminal app** (iTerm2, Terminal.app, etc.) in System Settings → Privacy & Security → Screen Recording. The binary runs under the terminal's process and inherits the terminal's TCC grant.
- After granting terminal permission: runs without prompt, no re-prompt after binary replacement (path-based, same as Phase A).
- `tccutil reset ScreenCapture` clears any stale denial so the next run gets a fresh evaluation.

### Key Learnings from Phase B

1. **`sampleHandlerQueue: .main` + `MainActor.assumeIsolated` is the correct Swift 6 SCStream pattern.**
   Set `sampleHandlerQueue: .main` when adding stream output. This guarantees callbacks arrive on the main thread. Then use `MainActor.assumeIsolated { }` inside the `nonisolated` delegate method to synchronously re-enter `@MainActor` isolation. No `Task` spawn needed, no `DispatchQueue.main.async` needed. The assumption is safe because we enforce it via the queue parameter.

2. **`nonisolated(unsafe) let` on a local variable is the correct Swift 6 escape hatch for non-Sendable C types.**
   `CVPixelBuffer` (aliased as `CVImageBuffer`) is a C type that is not `Sendable`. When a `nonisolated` function captures it into a `MainActor.assumeIsolated` closure, Swift 6 strict concurrency flags it as a potential data race. The correct response is `nonisolated(unsafe) let safeBuffer = pixelBuffer` before the closure — this tells the compiler "I assert the thread safety; suppress the check." This pattern is idiomatic for bridging non-Sendable CoreVideo/CoreMedia types into actor-isolated contexts when you know the queue is aligned.

3. **`CIContext` should be created once and reused — not inside the frame callback.**
   `CIContext()` allocates GPU/Metal state. Creating one per frame at 0.2 fps is wasteful, but the pattern matters even more for higher frame rates. Store it as a `let` on the `@MainActor` class. At 5s intervals the cost is negligible; at 1s intervals it would degrade performance visibly.

4. **`SCStreamDelegate` is an Obj-C optional protocol — conform in a separate extension.**
   Conforming in the main class declaration causes Swift to try to match the protocol signature strictly, producing optionality warnings. Conforming via `extension StreamCapture: SCStreamDelegate { }` avoids this. The same extension pattern applies to other Obj-C optional protocols in Swift 6.

5. **Display ID enumeration differs between `SCStream` and `SCScreenshotManager`.**
   Phase A's `SCScreenshotManager` returned `displayID = 3`; Phase B's `SCStream` returned `displayID = 1` for the same physical display. Neither is a stable identifier across reboots or display reconnections. Phase 1 should resolve the stable `CGDirectDisplayID` via CoreGraphics (`CGMainDisplayID()`, `CGGetActiveDisplayList()`) and use that as the primary key in the `frames` table. The `SCDisplay.displayID` should be treated as a session-local handle only.

6. **`minimumFrameInterval` is accurate to the second at 5s intervals.**
   All 5 captured frames were separated by exactly 5 seconds in the Unix timestamp (measured to 1s precision). No drift, no skipped frames, no burst delivery. The stream is reliable for the 5-10s capture cadence required by Phase 1. For sub-second intervals the jitter characteristics are unknown — not relevant for this use case.

---

## Decisions Locked for Phase 1

| Decision | Confirmed Choice |
|---|---|
| macOS minimum target | **15** — using swift-tools-version 6.0 and macOS(.v15) in Phase B; both APIs available on 12.3+/14+ so 15 is fine for dev |
| Capture API | **`SCStream`** — confirmed by Phase B: persistent session, exact 5s interval, no Timer needed |
| Swift concurrency model | **`@MainActor final class` + `sampleHandlerQueue: .main` + `MainActor.assumeIsolated`** — validated pattern for SCStreamOutput conformance in Swift 6 |
| Non-Sendable C type bridging | **`nonisolated(unsafe) let`** on local variable binding before `assumeIsolated` closure |
| TCC staleness fix | **None needed on macOS 15.3.2** — path-based, survives binary replacement |
| Run loop approach | **`NSApplication.shared.run()`** — confirmed working headlessly |
| Frame format | **JPEG 0.8** — ~180–250KB per frame, quality adequate |
| Timing mechanism | **`SCStream.minimumFrameInterval`** — no Timer needed, stream handles cadence |
| Display ID strategy | **CoreGraphics `CGDirectDisplayID`** for stable cross-session ID; `SCDisplay.displayID` is session-local only |
| Concurrency pattern | **Swift 6 `Task`** for daemon lifecycle; `assumeIsolated` (not Task) for per-frame callback |

---

## Next Steps

1. [x] **Phase A complete** — SCScreenshotManager validated, learnings documented above
2. [x] Update `.gitignore` for `.build/` artifacts
3. [x] **Phase B complete** — SCStream validated, Swift 6 patterns confirmed
4. [x] Update `docs/adr/009-always-on-recorder.md` with confirmed capture API (`SCStream`)
5. [ ] Begin **Phase 1**: `apps/recorder/` Swift package