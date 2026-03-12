# ScreenCaptureKit POC Spike

**Date:** March 12, 2026
**Hardware:** MacBook Pro M4 Max (128GB unified memory)
**Status:** Research complete — POC pending

---

## Goal

Validate that a standalone Swift CLI using ScreenCaptureKit can:

1. Run headlessly (no visible window) as a launchd LaunchAgent
2. Take periodic screenshots on a timer
3. Capture all connected displays
4. Persist TCC permissions across binary restarts

This is **throwaway code** — isolated from the main Escribano pipeline. Delete after findings are incorporated into Phase 1 implementation.

Analogous to: `scripts/poc-vllm-mlx/` (MLX-VLM proof-of-concept)
Outcome feeds into: `docs/adr/009-always-on-recorder.md` + Phase 1 implementation

---

## Research Summary (from @researcher agent, 2026-03-12)

### Verdict: Proceed with SCK for macOS 14+, CGWindowListCreateImage fallback for macOS 13

| Question | Result | Key Finding |
|---|---|---|
| Headless launchd agent? | **Partially validated** | Requires `NSApplication` run loop — no visible UI needed, just boilerplate |
| TCC persists across restarts? | **Partially validated** | Persists, but **goes stale after binary updates** — fix with `lsregister -f` |
| Periodic screenshot mode? | **Validated (macOS 14+)** | `SCScreenshotManager.captureImage` is the correct API |
| Multi-monitor support? | **Validated** | `SCShareableContent.current.displays` works headlessly |

### Key Risks

1. **TCC staleness** — After binary replacement (e.g. `npm install` update), TCC entry goes stale. Fix: run `lsregister -f /path/to/binary` on install/update (wire into `escribano daemon install`)
2. **NSApplication required** — Even without UI, SCK needs a run loop. Use `NSApplication.shared.run()` after setup.
3. **macOS 14+ only for `SCScreenshotManager`** — macOS 13 needs `SCStream` or `CGWindowListCreateImage` fallback

### Reference Implementations

| Project | What it shows |
|---|---|
| [Peekaboo (steipete)](https://github.com/steipete/Peekaboo) | SCK in automation/headless context |
| [localbird (littlebirdai)](https://github.com/littlebirdai/localbird) | async/await patterns for SCK capture |
| [BasedHardware/omi](https://github.com/BasedHardware/omi/blob/main/desktop/Desktop/Sources/ScreenCaptureService.swift) | TCC permission persistence + `lsregister` workaround |
| [LoginScreenCaptureDemo](https://github.com/Drewbadour/LoginScreenCaptureDemo) | SCK in headless `NSApplication` without visible UI |
| [efficient-recorder (janwilmake)](https://github.com/janwilmake/efficient-recorder) | Permission request flow and capture loop |

---

## POC Scope

**Location:** `scripts/poc-screencapturekit/`
**Language:** Swift (command-line tool, no Xcode project needed — `swiftc` only)
**Duration:** ~half day to build + validate

### What to prove

- [ ] `SCScreenshotManager.captureImage` works from a CLI binary (macOS 14+)
- [ ] Binary can run without a window using `NSApplication.shared.run()` + timer
- [ ] All connected displays are enumerated and captured separately
- [ ] JPEG frames written to a temp dir
- [ ] TCC permission is requested and granted (user approves in System Settings)
- [ ] After `kill` + relaunch, permission is still valid (no re-prompt)
- [ ] After replacing binary (`cp new_binary old_binary`), document TCC behavior

### What NOT to do

- No SQLite integration (that's Phase 1)
- No pHash deduplication (that's Phase 1)
- No launchd plist (just run interactively from terminal)
- No integration with Escribano pipeline

---

## Minimal Swift Sketch

```swift
// scripts/poc-screencapturekit/main.swift
// Run with: swiftc main.swift -o sck-poc && ./sck-poc
// Requires macOS 14+

import ScreenCaptureKit
import Cocoa
import Foundation

// SCK requires a run loop — NSApplication provides it without a UI
let app = NSApplication.shared

class CaptureDelegate: NSObject, NSApplicationDelegate {
    let interval: TimeInterval = 5.0
    var outputDir: URL!

    func applicationDidFinishLaunching(_ notification: Notification) {
        outputDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("sck-poc-frames", isDirectory: true)
        try? FileManager.default.createDirectory(at: outputDir, withIntermediateDirectories: true)
        print("[POC] Writing frames to \(outputDir.path)")

        Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { _ in
            Task { await self.capture() }
        }
        // Trigger once immediately
        Task { await capture() }
    }

    func capture() async {
        guard #available(macOS 14.0, *) else {
            print("[POC] macOS 14+ required for SCScreenshotManager")
            return
        }

        do {
            let content = try await SCShareableContent.current
            print("[POC] Found \(content.displays.count) display(s)")

            for display in content.displays {
                let config = SCStreamConfiguration()
                config.width = Int(display.width / 2)   // half-res for POC
                config.height = Int(display.height / 2)

                let cgImage = try await SCScreenshotManager.captureImage(
                    contentFilter: SCContentFilter(display: display, excludingWindows: []),
                    configuration: config
                )

                let ts = Int(Date().timeIntervalSince1970)
                let filename = "display\(display.displayID)_\(ts).jpg"
                let url = outputDir.appendingPathComponent(filename)
                save(cgImage, to: url)
                print("[POC] Saved \(filename) — \(cgImage.width)x\(cgImage.height)")
            }
        } catch {
            print("[POC] Error: \(error)")
        }
    }

    func save(_ image: CGImage, to url: URL) {
        guard let dest = CGImageDestinationCreateWithURL(url as CFURL, "public.jpeg" as CFString, 1, nil) else { return }
        CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: 0.8] as CFDictionary)
        CGImageDestinationFinalize(dest)
    }
}

let delegate = CaptureDelegate()
app.delegate = delegate
app.run()
```

### How to run

```bash
cd scripts/poc-screencapturekit
swiftc main.swift -o sck-poc
./sck-poc
# → approve Screen Recording in System Settings when prompted
# → check /tmp/sck-poc-frames/ for JPEG output
```

---

## Validation Checklist

After running the POC, record results here before proceeding to Phase 1.

### Core functionality

- [ ] Binary compiles with `swiftc` (no Xcode)
- [ ] `SCScreenshotManager.captureImage` returns valid frames
- [ ] Frames are non-black, correct dimensions
- [ ] All displays captured (check with external monitor connected)
- [ ] Timer fires reliably every 5s over a 2-minute run

### Permission behavior

- [ ] First run: System Settings prompt appears
- [ ] After approval: frames captured correctly
- [ ] After `kill` + relaunch: no re-prompt, frames captured
- [ ] After `cp new_sck-poc sck-poc` (binary replace): document behavior
  - If re-prompt: confirm `lsregister -f ./sck-poc` fixes it
  - If no re-prompt: TCC is path-based, no fix needed

### Edge cases

- [ ] Run with no Screen Recording permission: error is catchable (not a crash)
- [ ] Denial in System Settings: error message is actionable
- [ ] macOS version < 14: `#available` guard prints clear message

---

## Decisions to Make After POC

Based on POC results, lock in these decisions before Phase 1:

| Decision | Options | Depends On |
|---|---|---|
| macOS minimum target | 13 (SCStream fallback) vs 14 (`SCScreenshotManager`) | POC on macOS 13 if available |
| TCC staleness fix | `lsregister -f` in `daemon install` vs bundle ID approach | Permission replace test |
| Run loop approach | `NSApplication.shared.run()` vs `CFRunLoop.main.run()` | Compilation test |
| Frame format | JPEG 0.8 vs PNG vs HEIC | Storage + decode speed test |

---

## Next Steps After POC Succeeds

1. Record results in this doc (fill in checklist above)
2. Update `docs/adr/009-always-on-recorder.md` with confirmed technical choices
3. Add `scripts/poc-screencapturekit/` to `.gitignore` (throwaway code)
4. Begin Phase 1: `apps/recorder/` Swift package
