# ScreenCaptureKit POC Spike

**Date:** March 12, 2026
**Hardware:** MacBook Pro M4 Max (128GB unified memory)
**Status:** **Phase A (SCScreenshotManager) complete** — Phase B (SCStream) pending

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
| Efficient periodic capture? | `SCStream` recommended | **Phase B will validate** — `SCScreenshotManager` has per-call overhead |

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

**Status:** Pending — required before Phase 1 implementation starts.

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

**Decision for Phase 1:** Use `SCStream` with `minimumFrameInterval` set to the capture interval. The persistent session is more efficient for 24/7 operation.

### What to Prove

- [ ] `SCStream` starts and delivers frames headlessly (no UI session required)
- [ ] `minimumFrameInterval` controls delivery rate — set to 5s, confirm ~1 frame/5s
- [ ] `CMSampleBuffer` → `CGImage` conversion works correctly (via `CVPixelBuffer`)
- [ ] Multi-display: one `SCStream` per display, confirmed separate frame delivery
- [ ] Stream restarts cleanly after permission revoke + re-grant

### Swift 6 Pattern (Replace Timer with Task)

For Phase 1, replace the `Timer` pattern from Phase A with Swift 6 idiomatic code:

```swift
// Instead of Timer.scheduledTimer — use a cancellable Task loop
let captureTask = Task {
    while !Task.isCancelled {
        await capture()
        try await Task.sleep(for: .seconds(captureInterval))
    }
}
```

With `SCStream` this loop is not even needed — the stream's `minimumFrameInterval` handles cadence. The `Task` pattern is still useful for the overall daemon lifecycle (startup, shutdown, error recovery).

### SCStream Sketch for Phase B POC

```swift
import ScreenCaptureKit
import CoreMedia

let outputDir = URL(fileURLWithPath: "/tmp/sck-stream-frames")

class StreamCapture: NSObject, SCStreamOutput {
    let stream: SCStream
    var frameCount = 0

    init(display: SCDisplay) async throws {
        let config = SCStreamConfiguration()
        config.width = Int(display.width) / 2
        config.height = Int(display.height) / 2
        config.minimumFrameInterval = CMTime(value: 5, timescale: 1) // 1 frame per 5s
        config.pixelFormat = kCVPixelFormatType_32BGRA

        let filter = SCContentFilter(display: display, excludingWindows: [])
        stream = SCStream(filter: filter, configuration: config, delegate: nil)
        super.init()
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: .main)
        try await stream.startCapture()
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen,
              let imageBuffer = CMSampleBufferGetImageBuffer(buffer) else { return }
        let ciImage = CIImage(cvPixelBuffer: imageBuffer)
        let context = CIContext()
        guard let cgImage = context.createCGImage(ciImage, from: ciImage.extent) else { return }
        let timestamp = Int(Date().timeIntervalSince1970)
        let url = outputDir.appendingPathComponent("stream_\(timestamp).jpg")
        saveJPEG(cgImage, to: url)
        frameCount += 1
        print("[SCStream] [\(frameCount)] Saved stream_\(timestamp).jpg — \(cgImage.width)x\(cgImage.height)px")
    }

    func saveJPEG(_ image: CGImage, to url: URL) {
        guard let destination = CGImageDestinationCreateWithURL(
            url as CFURL,
            "public.jpeg" as CFString,
            1,
            nil
        ) else { return }
        let options: [CFString: Any] = [kCGImageDestinationLossyCompressionQuality: 0.8]
        CGImageDestinationAddImage(destination, image, options as CFDictionary)
        CGImageDestinationFinalize(destination)
    }
}

// Usage in NSApplicationDelegate:
let app = NSApplication.shared
class AppDelegate: NSObject, NSApplicationDelegate {
    var captures: [StreamCapture] = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        Task {
            let content = try await SCShareableContent.current
            for display in content.displays {
                let capture = try await StreamCapture(display: display)
                captures.append(capture)
            }
            print("[SCStream] Started \(captures.count) stream(s)")
        }
    }
}
let delegate = AppDelegate()
app.delegate = delegate
app.run()
```

---

## Decisions Locked for Phase 1

| Decision | Confirmed Choice |
|---|---|
| macOS minimum target | **14** — `SCStream` available on 12.3+, `SCScreenshotManager` on 14+ |
| Capture API | **`SCStream`** — more efficient for 24/7 periodic capture (Phase B will validate) |
| TCC staleness fix | **None needed on macOS 15.3.2** — path-based, survives binary replacement |
| Run loop approach | **`NSApplication.shared.run()`** — confirmed working headlessly |
| Frame format | **JPEG 0.8** — confirmed ~100-300KB per frame, quality adequate |
| Timing mechanism | **`SCStream.minimumFrameInterval`** — no Timer needed, stream handles cadence |
| Concurrency pattern | **Swift 6 `Task`** for daemon lifecycle, not for capture timing |

---

## Next Steps

1. [x] **Phase A complete** — SCScreenshotManager validated, learnings documented above
2. [x] Update `.gitignore` for `.build/` artifacts
3. [ ] **Run Phase B: SCStream validation** — required before Phase 1
4. [ ] Update `docs/adr/009-always-on-recorder.md` with confirmed capture API (`SCStream`)
5. [ ] Begin **Phase 1**: `apps/recorder/` Swift package