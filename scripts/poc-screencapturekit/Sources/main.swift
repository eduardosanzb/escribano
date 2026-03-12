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
