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
    private var captures:    [StreamCapture] = []
    private var store:       (any FrameStore)?
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

        if content.displays.isEmpty {
            print("[fotografo] ERROR: No displays found")
            exit(1)
        }

        print("[fotografo] Found \(content.displays.count) display(s). Starting capture for ALL.")

        var captures: [StreamCapture] = []
        for display in content.displays {
            do {
                let cap = try await StreamCapture(display: display, store: store, backpressure: bp)
                captures.append(cap)
            } catch {
                print("[fotografo] ERROR: Failed to start capture for display \(display.displayID): \(error.localizedDescription)")
            }
        }
        self.captures = captures

        // Event Wiring: link backpressure triggers to all StreamCapture controls.
        bp.onPause  = { [weak self] in 
            self?.captures.forEach { $0.pause() }
        }
        bp.onResume = { [weak self] in 
            self?.captures.forEach { $0.resume() }
        }

        print("[fotografo] Running. High-water=\(highWater) Low-water=\(lowWater) Threshold=\(Int(ProcessInfo.processInfo.environment["ESCRIBANO_PHASH_THRESHOLD"] ?? "4") ?? 4)")
    }

    /// Cleans up resources before the process terminates.
    func applicationWillTerminate(_ notification: Notification) {
        Task { @MainActor in
            for cap in captures {
                await cap.stop()
            }
        }
        store?.close()
    }
}

// Global initialization: configure NSApplication and run the loop.
let delegate = FotografoDelegate()
app.delegate  = delegate
app.run()
