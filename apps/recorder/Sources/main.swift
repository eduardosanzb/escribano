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
    private var obsStore: (any ObservationStore)?
    private var analyzer: FrameAnalyzer?
    private var analyzerTask: Task<Void, Never>?

    /// Called by NSApplication when the app has finished launching.
    func applicationDidFinishLaunching(_ notification: Notification) {
        signal(SIGTERM) { _ in
            DispatchQueue.main.async {
                log("[escribano-recorder] SIGTERM — shutting down")
                NSApp.terminate(nil)
            }
        }
        signal(SIGINT) { _ in
            DispatchQueue.main.async {
                log("[escribano-recorder] SIGINT — shutting down")
                NSApp.terminate(nil)
            }
        }

        Task { @MainActor in
            await self.start()
        }
    }

    private func start() async {
        // Permission check: wait for Screen Recording permission before proceeding.
        // This is necessary because every swift build creates a new CDHash,
        // so TCC forgets the permission each time during development.
        let hasPermission = CGPreflightScreenCaptureAccess()
        log("[escribano-recorder] Screen Recording permission: \(hasPermission)")
        if !hasPermission {
            log("[escribano-recorder] Screen Recording permission not granted")
            log("[escribano-recorder] Requesting permission...")

            // Trigger system dialog (only works from foreground process)
            CGRequestScreenCaptureAccess()

            // Poll until permission is granted
            var attempts = 0
            while !CGPreflightScreenCaptureAccess() {
                attempts += 1
                if attempts % 10 == 0 {
                    log("[escribano-recorder] Still waiting for permission... (grant in System Settings > Privacy & Security > Screen Recording)")
                }
                try? await Task.sleep(for: .seconds(1))
                if attempts > 30 {
                fatalError("[escribano-recorder] Aborting: couldn't get Screen Recording permission in a reasonable amount of time")
              }
            }
            log("[escribano-recorder] Permission granted! Starting capture...")
        }

        let dbPath = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".escribano/escribano.db").path

        let highWater = Int(ProcessInfo.processInfo.environment["ESCRIBANO_CAPTURE_HIGH_WATER"] ?? "") ?? 500
        let lowWater = Int(ProcessInfo.processInfo.environment["ESCRIBANO_CAPTURE_LOW_WATER"] ?? "") ?? 100

        let store: any FrameStore
        do {
            log("[escribano-recorder] Opening database at \(dbPath)")
            store = try SQLiteFrameStore(path: dbPath)
            log("[escribano-recorder] Database ready")
        } catch FrameStoreError.schemaMismatch(let current, let expected) {
            log("[escribano-recorder] ERROR: Database schema out of date (version \(current), expected \(expected)). Run 'escribano recorder install' from Node.js.")
            exit(1)
        } catch {
            log("[escribano-recorder] ERROR: Cannot open database at \(dbPath): \(error.localizedDescription)")
            exit(1)
        }
        self.store = store

        let bp = Backpressure(store: store, highWater: highWater, lowWater: lowWater)
        self.backpressure = bp
        bp.performInitialCheck()

        let content: SCShareableContent
        do {
            content = try await SCShareableContent.current
        } catch {
            log("[escribano-recorder] ERROR: ScreenCaptureKit unavailable: \(error.localizedDescription)")
            exit(1)
        }

        if content.displays.isEmpty {
            log("[escribano-recorder] ERROR: No displays found")
            exit(1)
        }

        log("[escribano-recorder] Found \(content.displays.count) display(s). Starting capture for ALL.")

        var captures: [StreamCapture] = []
        for display in content.displays {
            do {
                let cap = try await StreamCapture(display: display, store: store, backpressure: bp)
                captures.append(cap)
            } catch {
                log("[escribano-recorder] ERROR: Failed to start capture for display \(display.displayID): \(error.localizedDescription)")
            }
        }
        self.captures = captures

        bp.onPause = { [weak self] in
            self?.captures.forEach { $0.pause() }
        }
        bp.onResume = { [weak self] in
            self?.captures.forEach { $0.resume() }
        }

        // 1. Open a second SQLite connection for observation writes (WAL allows concurrent access)
        let obsStore: any ObservationStore
        do {
            obsStore = try SQLiteObservationStore(path: dbPath)
        } catch {
            log("[escribano-recorder] ERROR: Cannot open observation store: \(error.localizedDescription)")
            exit(1)
        }
        self.obsStore = obsStore
        // 2. Create the VLM adapter (Python bridge) and inject it into FrameAnalyzer.
        //    This wires the port (VLMInferenceService) to its concrete adapter.
        let vlmService = PythonBridgeVLMAdapter()
        let analyzer = FrameAnalyzer(obsStore: obsStore, vlmService: vlmService)
        self.analyzer = analyzer
        // 3. Start the analyzer in a background Task. start() blocks until the Python
        //    process is ready, then analyzeLoop() runs forever without blocking capture.
        self.analyzerTask = Task {
            do {
                try await analyzer.start()
            } catch {
                log("[FrameAnalyzer] Failed to start: \(error.localizedDescription)")
                return
            }
            await analyzer.analyzeLoop()
        }
        log("[escribano-recorder] VLM analyzer task started.")

        bp.onPause = { [weak self] in
            self?.captures.forEach { $0.pause() }
        }
        bp.onResume = { [weak self] in
            self?.captures.forEach { $0.resume() }
        }

        let threshold = Int(ProcessInfo.processInfo.environment["ESCRIBANO_PHASH_THRESHOLD"] ?? "4") ?? 4
        log("[escribano-recorder] Running. High-water=\(highWater) Low-water=\(lowWater) Threshold=\(threshold)")
    }

    func applicationWillTerminate(_ notification: Notification) {
        Task { @MainActor in
            for cap in captures {
                await cap.stop()
            }
            analyzerTask?.cancel()
            await obsStore?.close()
        }
        store?.close()
    }
}

let delegate = EscribanoRecorderDelegate()
app.delegate = delegate
app.run()
