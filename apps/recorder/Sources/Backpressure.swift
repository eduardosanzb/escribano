import Foundation

/// Backpressure: Monitors pending frame count to avoid overloading the system.
///
/// Every 10 captured frames, it queries the frame store for unanalyzed frames.
/// If high-water (e.g. 500) is reached, it signals the capture stream to pause.
/// If low-water (e.g. 100) is reached after a pause, it signals to resume.
///
/// @MainActor: ensures all state changes occur on the main thread, 
/// which matches ScreenCaptureKit's main queue delivery.
///
/// Architecture note: This class depends on the FrameStore protocol (Port),
/// not a concrete implementation. This allows swapping storage backends
/// without changing backpressure logic.
@MainActor
final class Backpressure {
    private let store: any FrameStore
    private let highWater: Int
    private let lowWater: Int
    private var isPaused = false
    private var frameCounter = 0
    private var resumeTimer: Timer?
    private var lastLoggedPending: Int?
    private var lastLogDate: Date?
    private let logThrottleInterval: TimeInterval = 60
    var currentlyPaused: Bool { isPaused }

    // Closures for external handlers (like StreamCapture.pause/resume)
    var onPause:  (() -> Void)?
    var onResume: (() -> Void)?

    /// Creates a backpressure monitor.
    /// - Parameters:
    ///   - store: The frame store to query for pending counts.
    ///   - highWater: Pause capture when pending frames >= this value (default: 500).
    ///   - lowWater: Resume capture when pending frames <= this value (default: 100).
    init(store: any FrameStore, highWater: Int = 500, lowWater: Int = 100) {
        self.store     = store
        self.highWater = highWater
        self.lowWater  = lowWater
    }

    /// Increments internal counter and checks watermarks every 10 frames.
    func onFrameCaptured() {
        frameCounter += 1
        // Frequency: check every 10 frames (approx 10s at 1fps) 
        // to balance database activity and response time.
        if frameCounter % 10 == 0 {
            check()
        }
    }

    /// Queries the frame store and triggers pause/resume handlers if needed.
    private func check() {
        // Query storage for total unanalyzed frames.
        let pending = (try? store.pendingFrameCount()) ?? 0
        logPendingCount(pending)

        // High-water trigger: stop capturing to avoid disk/memory buildup.
        if !isPaused && pending >= highWater {
            isPaused = true
            log("[Backpressure] High-water reached (\(pending) pending). Pausing capture.")
            onPause?()
            startResumeTimer()
        } 
        // Low-water trigger: resume only after unanalyzed frames are cleared.
        else if isPaused && pending <= lowWater {
            isPaused = false
            log("[Backpressure] Low-water reached (\(pending) pending). Resuming capture.")
            onResume?()
            stopResumeTimer()
        }
    }

    private func startResumeTimer() {
        guard resumeTimer == nil else { return }
        resumeTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.check()
            }
        }
    }

    private func stopResumeTimer() {
        resumeTimer?.invalidate()
        resumeTimer = nil
    }

    func performInitialCheck() {
        let pending = (try? store.pendingFrameCount()) ?? 0
        log("[Backpressure] Initial check: \(pending) pending frames (high-water: \(highWater))")
        if pending >= highWater {
            isPaused = true
            log("[Backpressure] Starting paused (\(pending) >= \(highWater))")
            startResumeTimer()
        }
    }

    private func logPendingCount(_ pending: Int) {
        let now = Date()
        if let last = lastLoggedPending, let lastDate = lastLogDate {
            if pending == last && now.timeIntervalSince(lastDate) < logThrottleInterval {
                return
            }
        }
        log("[Backpressure] Checked, \(pending) pending frames.")
        lastLoggedPending = pending
        lastLogDate = now
    }
}
