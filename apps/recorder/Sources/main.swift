import Cocoa
import Foundation
@preconcurrency import ScreenCaptureKit

// NSApplication: necessary for running the capture loop (it provides the NSRunLoop).
// For a headless CLI application, NSApplication.shared behaves like a daemon.
let app = NSApplication.shared

// Hide from the Dock — run as a menu bar accessory app.
app.setActivationPolicy(.accessory)

// Ignore SIGPIPE globally. This prevents the process from being killed when
// writing to a Unix domain socket (FileHandle) whose remote end has disconnected.
// Without this, a VLM inference timeout that closes the readability handler can
// leave the pipe broken — the next write triggers SIGPIPE and crashes the process.
signal(SIGPIPE, SIG_IGN)

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
    private var vlmAdapter: PythonBridgeVLMAdapter?
    private var workQueue: WorkQueue?
    private var analyzerFrameStore: (any FrameStore)?
    private var tbStore: (any TopicBlockStore)?
    private var aggregator: SessionAggregator?
    private var aggregatorTask: Task<Void, Never>?
    private var menuBar: MenuBarController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        signal(SIGTERM) { _ in
            DispatchQueue.main.async {
                print("[escribano-recorder] SIGTERM — shutting down")
                NSApp.terminate(nil)
            }
        }
        signal(SIGINT) { _ in
            DispatchQueue.main.async {
                print("[escribano-recorder] SIGINT — shutting down")
                NSApp.terminate(nil)
            }
        }

        let buildCommit = ProcessInfo.processInfo.environment["ESCRIBANO_BUILD_COMMIT"] ?? "unknown"
        log("[escribano-recorder] Build commit: \(buildCommit)")

        // 1. Create menu bar immediately (shows "Setting up..." to user)
        let menuBar = MenuBarController()
        self.menuBar = menuBar
        menuBar.setStatus(.setup)
        menuBar.setSetupProgress("Starting up...")

        // 2. Run bootstrap in a Task (async operations)
        Task { @MainActor in
            await self.bootstrap(menuBar: menuBar)
        }
    }

    private func bootstrap(menuBar: MenuBarController) async {
        // Step 4a — Duplicate instance check
        if let bundleId = Bundle.main.bundleIdentifier {
            let running = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId)
            if running.count > 1 {
                log("[escribano-recorder] Another instance is already running. Exiting.")
                NSApp.terminate(nil)
                return
            }
        }

        // Step 4b — LaunchAgent migration (remove old plist if present)
        let home = FileManager.default.homeDirectoryForCurrentUser
        let oldPlist = home.appendingPathComponent("Library/LaunchAgents/com.escribano.capture.plist")
        if FileManager.default.fileExists(atPath: oldPlist.path) {
            log("[escribano-recorder] Found old LaunchAgent plist — migrating to .app")
            let uid = getuid()
            let proc = Process()
            proc.executableURL = URL(fileURLWithPath: "/bin/launchctl")
            proc.arguments = ["bootout", "gui/\(uid)/com.escribano.capture"]
            do {
                try proc.run()
                await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                    proc.terminationHandler = { _ in continuation.resume() }
                }
            } catch {
                log("[escribano-recorder] launchctl bootout failed to launch: \(error)")
            }
            try? FileManager.default.removeItem(at: oldPlist)
            log("[escribano-recorder] Old LaunchAgent removed")
        }

        // Step 4c — Create directory structure
        let escribanoDir = home.appendingPathComponent(".escribano")
        let dirs = ["", "frames", "logs", "artifacts", "scripts"]
        for dir in dirs {
            let path = escribanoDir.appendingPathComponent(dir)
            try? FileManager.default.createDirectory(at: path, withIntermediateDirectories: true)
        }

        // Step 4d — Run DB migrations
        menuBar.setSetupProgress("Running database migrations...")
        let dbPath = home.appendingPathComponent(".escribano/escribano.db").path
        if let migrationsDir = MigrationRunner.resolveMigrationsDir() {
            do {
                let result = try MigrationRunner.run(dbPath: dbPath, migrationsDir: migrationsDir)
                if !result.applied.isEmpty {
                    log("[escribano-recorder] Applied \(result.applied.count) migration(s). Schema version: \(result.currentVersion)")
                } else {
                    log("[escribano-recorder] Database up to date (version \(result.currentVersion))")
                }
            } catch {
                log("[escribano-recorder] Migration error: \(error.localizedDescription)")
                menuBar.setStatus(.error("Database migration failed"))
                return
            }
        } else {
            log("[escribano-recorder] WARNING: No migrations directory found. Skipping migrations.")
        }

        // Step 4e — Python venv setup
        menuBar.setSetupProgress("Checking Python environment...")
        do {
            let pythonPath = try await PythonSetup.ensureVenv { message in
                Task { @MainActor in
                    menuBar.setSetupProgress(message)
                }
            }
            log("[escribano-recorder] Python ready: \(pythonPath)")
        } catch {
            log("[escribano-recorder] Python setup failed: \(error.localizedDescription)")
            log("[escribano-recorder] VLM analysis will not be available until Python is configured")
            // Don't return — capture can still run, just without VLM analysis
        }

        // Step 4f — Screen Recording permission check
        if !CGPreflightScreenCaptureAccess() {
            log("[escribano-recorder] Screen Recording permission not granted.")
            CGRequestScreenCaptureAccess()
            menuBar.setStatus(.permissionNeeded)
            menuBar.onRelaunch = { [weak menuBar] in
                _ = menuBar // suppress unused capture warning if needed
                Task { @MainActor in
                    let bundleURL = Bundle.main.bundleURL
                    let config = NSWorkspace.OpenConfiguration()
                    config.createsNewApplicationInstance = true
                    NSWorkspace.shared.openApplication(at: bundleURL, configuration: config) { _, _ in }
                    try? await Task.sleep(nanoseconds: 500_000_000)
                    NSApp.terminate(nil)
                }
            }
            return  // Don't start capture — user must relaunch after granting
        }
        log("[escribano-recorder] Screen Recording permission: granted")
        menuBar.setSetupProgress("Starting capture...")

        // Step 4g — Normal startup (preserve existing logic)
        let highWater = Int(ProcessInfo.processInfo.environment["ESCRIBANO_CAPTURE_HIGH_WATER"] ?? "") ?? 500
        let lowWater = Int(ProcessInfo.processInfo.environment["ESCRIBANO_CAPTURE_LOW_WATER"] ?? "") ?? 100

        let store: any FrameStore
        do {
            log("[escribano-recorder] Opening database at \(dbPath)")
            store = try SQLiteFrameStore(path: dbPath)
            log("[escribano-recorder] Database ready")
        } catch FrameStoreError.schemaMismatch(let current, let expected) {
            log("[escribano-recorder] ERROR: Schema mismatch (version \(current), expected \(expected))")
            menuBar.setStatus(.error("Database schema error"))
            return
        } catch {
            log("[escribano-recorder] ERROR: Cannot open database: \(error.localizedDescription)")
            menuBar.setStatus(.error("Database error"))
            return
        }
        self.store = store

        let bp = Backpressure(store: store, highWater: highWater, lowWater: lowWater)
        self.backpressure = bp

        let content: SCShareableContent
        do {
            content = try await SCShareableContent.current
        } catch {
            log("[escribano-recorder] ERROR: ScreenCaptureKit unavailable: \(error.localizedDescription)")
            menuBar.setStatus(.error("ScreenCaptureKit unavailable"))
            return
        }

        if content.displays.isEmpty {
            log("[escribano-recorder] ERROR: No displays found")
            menuBar.setStatus(.error("No displays found"))
            return
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

        // 1. Open a second SQLite connection for observation writes (WAL allows concurrent access)
        let obsStore: any ObservationStore
        do {
            obsStore = try SQLiteObservationStore(path: dbPath)
        } catch {
            log("[escribano-recorder] ERROR: Cannot open observation store: \(error.localizedDescription)")
            menuBar.setStatus(.error("Observation store error"))
            return
        }
        self.obsStore = obsStore
        // Open a dedicated SQLiteFrameStore connection for FrameAnalyzer.
        // FrameAnalyzer runs on its own actor executor (background thread) while
        // StreamCapture/Backpressure use the original `store` on @MainActor.
        // WAL mode supports multiple concurrent connections — this avoids data races
        // on a single sqlite3* handle.
        let analyzerFrameStore: any FrameStore
        do {
            analyzerFrameStore = try SQLiteFrameStore(path: dbPath)
        } catch {
            log("[escribano-recorder] ERROR: Cannot open analyzer frame store: \(error.localizedDescription)")
            menuBar.setStatus(.error("Analyzer frame store error"))
            return
        }
        self.analyzerFrameStore = analyzerFrameStore
        // 2. Create the VLM adapter (Python bridge) and inject it into FrameAnalyzer.
        //    Also store a direct reference so applicationWillTerminate can call
        //    terminateSync() without needing an async context.
        let vlmService = PythonBridgeVLMAdapter()
        self.vlmAdapter = vlmService
        let realtimeStreak = Int(
            ProcessInfo.processInfo.environment["ESCRIBANO_QUEUE_REALTIME_STREAK"] ?? ""
        ) ?? 10
        let workQueue = WorkQueue(maxRealtimeStreak: realtimeStreak)
        self.workQueue = workQueue
        let analyzer = FrameAnalyzer(frameStore: analyzerFrameStore, obsStore: obsStore, vlmService: vlmService, queue: workQueue)
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

        // 4. Create TopicBlockStore and SessionAggregator for Phase 3a.
        //    The aggregator polls unclaimed observations every TB_POLL_INTERVAL
        //    and groups them into TopicBlocks using the VLM bridge for semantic grouping.
        //    Note: The bridge is started by FrameAnalyzer.analyzer.start() above.
        //    SessionAggregator will wait for textService.isStarted before processing.
        let tbStore: any TopicBlockStore
        do {
            tbStore = try SQLiteTopicBlockStore(path: dbPath)
        } catch TopicBlockStoreError.schemaMismatch(let current, let expected) {
            log("[escribano-recorder] ERROR: Database schema out of date (version \(current), expected \(expected)). Run 'escribano recorder install' from Node.js.")
            menuBar.setStatus(.error("Database schema error"))
            return
        } catch {
            log("[escribano-recorder] ERROR: Cannot open topic block store: \(error.localizedDescription)")
            menuBar.setStatus(.error("Topic block store error"))
            return
        }
        self.tbStore = tbStore

        // vlmService conforms to both VLMInferenceService and TextGenerationService
        let aggregator = SessionAggregator(
            obsStore: obsStore,
            tbStore: tbStore,
            textService: vlmService,
            queue: workQueue
        )
        self.aggregator = aggregator
        self.aggregatorTask = Task {
            // Bridge is already up (analyzer.start() awaited above).
            // WorkQueue serialises bridge calls — SA starts immediately.
            await aggregator.aggregateLoop()
        }
        log("[escribano-recorder] SessionAggregator task started.")

        bp.onPause = { [weak self] in
            self?.captures.forEach { $0.pause() }
            self?.menuBar?.setStatus(.paused)
        }
        bp.onResume = { [weak self] in
            self?.captures.forEach { $0.resume() }
            self?.menuBar?.setStatus(.running)
        }

        let threshold = Int(ProcessInfo.processInfo.environment["ESCRIBANO_PHASH_THRESHOLD"] ?? "4") ?? 4
        log("[escribano-recorder] Running. High-water=\(highWater) Low-water=\(lowWater) Threshold=\(threshold) QueueStreak=\(realtimeStreak)")

        // Step 4h — Wire menu bar
        // Set running status
        menuBar.setStatus(.running)

        // Wire pause/resume
        menuBar.onPauseResume = { [weak self] shouldPause in
            guard let self = self else { return }
            if shouldPause {
                self.captures.forEach { $0.pause() }
            } else {
                self.captures.forEach { $0.resume() }
            }
        }

        // Start stats timer
        menuBar.startStatsTimer(
            frameStore: store,
            tbStore: tbStore,
            displayCount: captures.count,
            bridgePID: { [vlmAdapter] in vlmAdapter?.storedPID ?? 0 }
        )
    }

    func applicationWillTerminate(_ notification: Notification) {
        log("[escribano-recorder] applicationWillTerminate — cleaning up")
        // Cancel the analyzer and aggregator tasks so their loops exit cleanly.
        analyzerTask?.cancel()
        aggregatorTask?.cancel()
        // Kill the Python bridge. Child processes are NOT automatically killed when the
        // parent exits on macOS — they become orphaned without this explicit call.
        vlmAdapter?.terminateSync()
        // Close synchronous (class-based) frame store handles.
        store?.close()
        analyzerFrameStore?.close()
        // Close async (actor-based) store handles. We capture references locally so the
        // Task.detached closure can access them without crossing @MainActor isolation.
        // Block up to 2 seconds to allow sqlite3_close to complete before the process exits.
        let localObs = obsStore
        let localTb  = tbStore
        let sema = DispatchSemaphore(value: 0)
        Task.detached {
            await localObs?.close()
            await localTb?.close()
            sema.signal()
        }
        _ = sema.wait(timeout: .now() + 2)
        // MenuBarController cleanup (timer invalidation happens automatically when the controller is deallocated)
        menuBar = nil
    }
}

let delegate = EscribanoRecorderDelegate()
app.delegate = delegate
app.run()
