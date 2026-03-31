import Cocoa
import Foundation
@preconcurrency import ScreenCaptureKit

// NSApplication: necessary for running the capture loop (it provides the NSRunLoop).
// For a headless CLI application, NSApplication.shared behaves like a daemon.
let app = NSApplication.shared

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
    private var screenLockObserver: ScreenLockObserver?

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

        Task { @MainActor in
            await self.start()
        }
    }

    private func start() async {
        // Permission check: Screen Recording permission must be granted before capture can start.
        //
        // Why no polling loop: CGPreflightScreenCaptureAccess() never updates in the same
        // running process after the user grants permission — macOS only reflects TCC changes
        // on the next process launch. Polling with try? Task.sleep is also dangerous because
        // discarding CancellationError with try? turns a cancelled task into a CPU spin loop.
        //
        // Instead: request the dialog, log clear instructions, exit cleanly (code 0).
        // With KeepAlive=true + ThrottleInterval=30 in the LaunchAgent plist, launchd will
        // restart us every 30s. When the user grants permission, the next restart succeeds.
        if !CGPreflightScreenCaptureAccess() {
            log("[escribano-recorder] Screen Recording permission not granted.")
            // Trigger the system permission dialog. This returns immediately (non-blocking).
            CGRequestScreenCaptureAccess()
            log("[escribano-recorder] Permission dialog shown.")
            log("[escribano-recorder] Grant permission in: System Settings > Privacy & Security > Screen Recording")
            log("[escribano-recorder] The recorder will restart automatically (every 30s) until permission is granted.")
            // Exit cleanly (code 0). The LaunchAgent ThrottleInterval=30 prevents a restart
            // loop: launchd will retry in 30 seconds, by which time the user may have granted.
            NSApp.terminate(nil)
            return
        }
        log("[escribano-recorder] Screen Recording permission: granted")

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

        // 1. Open a second SQLite connection for observation writes (WAL allows concurrent access)
        let obsStore: any ObservationStore
        do {
            obsStore = try SQLiteObservationStore(path: dbPath)
        } catch {
            log("[escribano-recorder] ERROR: Cannot open observation store: \(error.localizedDescription)")
            exit(1)
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
            exit(1)
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
            exit(1)
        } catch {
            log("[escribano-recorder] ERROR: Cannot open topic block store: \(error.localizedDescription)")
            exit(1)
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
            self?.captures.forEach { $0.pauseForBackpressure() }
        }
        bp.onResume = { [weak self] in
            self?.captures.forEach { $0.resumeFromBackpressure() }
        }

        // Screen lock detection — pause capture when screen is locked
        let lockObserver = ScreenLockObserver()
        lockObserver.onLock = { [weak self] in
            self?.captures.forEach { $0.pauseForScreenLock() }
            log("[escribano-recorder] Screen locked — all captures paused")
        }
        lockObserver.onUnlock = { [weak self] in
            self?.captures.forEach { $0.resumeFromScreenLock() }
            log("[escribano-recorder] Screen unlocked — all captures resumed")
        }
        self.screenLockObserver = lockObserver

        let threshold = Int(ProcessInfo.processInfo.environment["ESCRIBANO_PHASH_THRESHOLD"] ?? "4") ?? 4
        let churnThreshold = Int(ProcessInfo.processInfo.environment["ESCRIBANO_CHURN_THRESHOLD"] ?? "") ?? 40
        let churnInterval: TimeInterval = Double(ProcessInfo.processInfo.environment["ESCRIBANO_CHURN_THROTTLE_INTERVAL"] ?? "") ?? 30.0
        log("[escribano-recorder] Running. High-water=\(highWater) Low-water=\(lowWater) Threshold=\(threshold) QueueStreak=\(realtimeStreak) ChurnThreshold=\(churnThreshold)/min ChurnInterval=\(churnInterval)s ScreenLock=active")
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
    }
}

let delegate = EscribanoRecorderDelegate()
app.delegate = delegate
app.run()
