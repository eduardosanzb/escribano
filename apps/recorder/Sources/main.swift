import Cocoa
import Foundation
@preconcurrency import ScreenCaptureKit

// NSApplication: necessary for running the capture loop (it provides the NSRunLoop).
// For a headless CLI application, NSApplication.shared behaves like a daemon.
let app = NSApplication.shared

/// EscribanoRecorderDelegate: Entry point for the escribano recorder daemon.
///
/// Implements NSApplicationDelegate to handle startup and shutdown.
/// Coordinates database connection, backpressure, and capture orchestration.
@MainActor
final class EscribanoRecorderDelegate: NSObject, NSApplicationDelegate {
    private var captures: [StreamCapture] = []
    private var store: (any FrameStore)?
    private var backpressure: Backpressure?

    /// Called by NSApplication when the app has finished launching.
    func applicationDidFinishLaunching(_ notification: Notification) {
        signal(SIGTERM) { _ in
            print("[escribano-recorder] SIGTERM — shutting down")
            exit(0)
        }
        signal(SIGINT) { _ in
            print("[escribano-recorder] SIGINT — shutting down")
            exit(0)
        }

        Task { @MainActor in
            await self.start()
        }
    }

    private func start() async {
        // Permission check: wait for Screen Recording permission before proceeding.
        // This is necessary because every swift build creates a new CDHash,
        // so TCC forgets the permission each time during development.
        if !CGPreflightScreenCaptureAccess() {
            print("[escribano-recorder] Screen Recording permission not granted")
            print("[escribano-recorder] Requesting permission...")
            
            // Trigger system dialog (only works from foreground process)
            CGRequestScreenCaptureAccess()
            
            // Poll until permission is granted
            var attempts = 0
            while !CGPreflightScreenCaptureAccess() {
                attempts += 1
                if attempts % 10 == 0 {
                    print("[escribano-recorder] Still waiting for permission... (grant in System Settings > Privacy & Security > Screen Recording)")
                }
                try? await Task.sleep(for: .seconds(1))
            }
            print("[escribano-recorder] Permission granted! Starting capture...")
        }

        let dbPath = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".escribano/escribano.db").path

        let highWater = Int(ProcessInfo.processInfo.environment["ESCRIBANO_CAPTURE_HIGH_WATER"] ?? "") ?? 500
        let lowWater = Int(ProcessInfo.processInfo.environment["ESCRIBANO_CAPTURE_LOW_WATER"] ?? "") ?? 100

        let store: any FrameStore
        do {
            print("[escribano-recorder] Opening database at \(dbPath)")
            store = try SQLiteFrameStore(path: dbPath)
            print("[escribano-recorder] Database ready")
        } catch FrameStoreError.schemaMismatch(let current, let expected) {
            print("[escribano-recorder] ERROR: Database schema out of date (version \(current), expected \(expected)). Run 'escribano recorder install' from Node.js.")
            exit(1)
        } catch {
            print("[escribano-recorder] ERROR: Cannot open database at \(dbPath): \(error.localizedDescription)")
            exit(1)
        }
        self.store = store

        let bp = Backpressure(store: store, highWater: highWater, lowWater: lowWater)
        self.backpressure = bp

        let content: SCShareableContent
        do {
            content = try await SCShareableContent.current
        } catch {
            print("[escribano-recorder] ERROR: ScreenCaptureKit unavailable: \(error.localizedDescription)")
            exit(1)
        }

        if content.displays.isEmpty {
            print("[escribano-recorder] ERROR: No displays found")
            exit(1)
        }

        print("[escribano-recorder] Found \(content.displays.count) display(s). Starting capture for ALL.")

        var captures: [StreamCapture] = []
        for display in content.displays {
            do {
                let cap = try await StreamCapture(display: display, store: store, backpressure: bp)
                captures.append(cap)
            } catch {
                print("[escribano-recorder] ERROR: Failed to start capture for display \(display.displayID): \(error.localizedDescription)")
            }
        }
        self.captures = captures

        bp.onPause = { [weak self] in
            self?.captures.forEach { $0.pause() }
        }
        bp.onResume = { [weak self] in
            self?.captures.forEach { $0.resume() }
        }

        let threshold = Int(ProcessInfo.processInfo.environment["ESCRIBANO_PHASH_THRESHOLD"] ?? "4") ?? 4
        print("[escribano-recorder] Running. High-water=\(highWater) Low-water=\(lowWater) Threshold=\(threshold)")
    }

    func applicationWillTerminate(_ notification: Notification) {
        Task { @MainActor in
            for cap in captures {
                await cap.stop()
            }
        }
        store?.close()
    }
}

let delegate = EscribanoRecorderDelegate()
app.delegate = delegate
app.run()