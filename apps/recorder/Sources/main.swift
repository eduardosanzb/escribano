import Cocoa
import Foundation
@preconcurrency import ScreenCaptureKit

// NSApplication: necessary for running the capture loop (it provides the NSRunLoop).
// For a headless CLI application, NSApplication.shared behaves like a daemon.
let app = NSApplication.shared

/// FotografoDelegate: Entry point for the fotografo daemon.
///
/// Implements NSApplicationDelegate to handle startup and shutdown.
/// Coordinates database connection, backpressure, and capture orchestration.
@MainActor
final class FotografoDelegate: NSObject, NSApplicationDelegate {
    private var capture:      StreamCapture?
    private var store:        (any FrameStore)?
    private var backpressure: Backpressure?

    /// Called by NSApplication when the app has finished launching.
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Signals for graceful termination: handle launchd unload (SIGTERM)
        // and interactive Ctrl+C (SIGINT).
        signal(SIGTERM) { _ in
            print("[fotografo] SIGTERM — shutting down")
            exit(0)
        }
        signal(SIGINT) { _ in
            print("[fotografo] SIGINT — shutting down")
            exit(0)
        }

        // Asynchronous initialization on the MainActor.
        Task { @MainActor in
            await self.start()
        }
    }

    /// Initializes and starts the capture process.
    private func start() async {
        let dbPath = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".escribano/escribano.db").path

        // Backpressure Watermarks: Read from environment or use sensible defaults.
        // High-water (default 500) pauses capture to avoid DB/disk buildup.
        // Low-water (default 100) resumes capture once unanalyzed frames are cleared.
        let highWater = Int(ProcessInfo.processInfo.environment["ESCRIBANO_CAPTURE_HIGH_WATER"] ?? "") ?? 500
        let lowWater  = Int(ProcessInfo.processInfo.environment["ESCRIBANO_CAPTURE_LOW_WATER"]  ?? "") ?? 100

        // Database setup: ensure the schema is compatible before proceeding.
        let store: any FrameStore
        do {
            store = try SQLiteFrameStore(path: dbPath)
        } catch FrameStoreError.schemaMismatch(let current, let expected) {
            // Error handling for out-of-date schemas (enforces migrations).
            print("[fotografo] ERROR: Database schema out of date (version \(current), expected \(expected)). Run 'escribano recorder install' from Node.js.")
            exit(1)
        } catch {
            print("[fotografo] ERROR: Cannot open database at \(dbPath): \(error.localizedDescription)")
            exit(1)
        }
        self.store = store

        // Backpressure: coordinates pausing/resuming the capture stream based on unanalyzed frame count.
        let bp = Backpressure(store: store, highWater: highWater, lowWater: lowWater)
        self.backpressure = bp

        // Content Discovery: use ScreenCaptureKit to find available displays.
        let content: SCShareableContent
        do {
            content = try await SCShareableContent.current
        } catch {
            print("[fotografo] ERROR: ScreenCaptureKit unavailable: \(error.localizedDescription)")
            exit(1)
        }

        // MVP: capture the first display only. Multi-display is a future enhancement.
        guard let display = content.displays.first else {
            print("[fotografo] ERROR: No displays found")
            exit(1)
        }

        // Capture Start: initializes the SCStream for the selected display.
        let capture: StreamCapture
        do {
            capture = try await StreamCapture(display: display, store: store, backpressure: bp)
        } catch {
            print("[fotografo] ERROR: Failed to start capture: \(error.localizedDescription)")
            exit(1)
        }
        self.capture = capture

        // Event Wiring: link backpressure triggers to StreamCapture controls.
        bp.onPause  = { [weak capture] in capture?.pause()  }
        bp.onResume = { [weak capture] in capture?.resume() }

        print("[fotografo] Running. High-water=\(highWater) Low-water=\(lowWater)")
    }

    /// Cleans up resources before the process terminates.
    func applicationWillTerminate(_ notification: Notification) {
        store?.close()
    }
}

// Global initialization: configure NSApplication and run the loop.
let delegate = FotografoDelegate()
app.delegate  = delegate
app.run()
