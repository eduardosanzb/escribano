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
        print("[Backpressure] Checked, \(pending) pending frames.")

        // High-water trigger: stop capturing to avoid disk/memory buildup.
        if !isPaused && pending >= highWater {
            isPaused = true
            print("[Backpressure] High-water reached (\(pending) pending). Pausing capture.")
            onPause?()
        } 
        // Low-water trigger: resume only after unanalyzed frames are cleared.
        else if isPaused && pending <= lowWater {
            isPaused = false
            print("[Backpressure] Low-water reached (\(pending) pending). Resuming capture.")
            onResume?()
        }
    }
}
