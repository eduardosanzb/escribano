// POC: ScreenCaptureKit SCStream headless capture (Swift 6)
// Build: swift build -c release (in scripts/poc-screencapturekit-stream/)
// Run:   .build/release/sck-stream-poc
// Stop:  Ctrl+C
//
// Swift 6 Concurrency Patterns Demonstrated:
// 1. @MainActor final class — protects all mutable state
// 2. nonisolated func stream(...) — Obj-C protocol witness from @MainActor context
// 3. MainActor.assumeIsolated { } — synchronous re-entry to main isolation (no Task spawn)
// 4. sampleHandlerQueue: .main — aligns SCStream callbacks with @MainActor executor
// 5. SCStreamDelegate + SCStreamOutput — both protocols for full stream lifecycle visibility

import Cocoa
import Foundation
@preconcurrency import ScreenCaptureKit
import CoreMedia
import CoreImage

// @preconcurrency on ScreenCaptureKit allows us to use non-Sendable types like
// SCShareableContent in @MainActor contexts. The compiler will treat Sendable violations
// as warnings rather than errors. This is safe here because:
// 1. SCShareableContent is only accessed from @MainActor context
// 2. The data returned is immediately processed on @MainActor
// This is a pragmatic approach until Apple's frameworks are fully Sendable-safe.

let outputDir = URL(fileURLWithPath: "/tmp/sck-stream-frames")

// MARK: - StreamCapture: Manages a single SCStream with Swift 6 concurrency

/// Encapsulates a single SCStream for one display.
/// Uses @MainActor to protect mutable state (frameCount, cumulative time).
/// Conforms to SCStreamOutput for frame delivery callbacks.
@MainActor final class StreamCapture: NSObject, SCStreamOutput {
    // MARK: Isolated State (protected by @MainActor)

    /// The underlying ScreenCaptureKit stream object.
    private var stream: SCStream?

    /// Number of frames captured from this display.
    private var frameCount: Int = 0

    /// Display metadata for logging.
    private let displayID: UInt32
    private let displaySize: (width: CGFloat, height: CGFloat)

    /// CIContext: expensive to create, reuse across frames.
    /// This is a common performance optimization for frame-by-frame processing.
    private let ciContext = CIContext()

    // MARK: Init

    /// Initialize with a display ID and size (captured before @MainActor isolation).
    init(displayID: UInt32, displaySize: (width: Int, height: Int)) {
        self.displayID = displayID
        self.displaySize = (width: CGFloat(displaySize.width), height: CGFloat(displaySize.height))
        super.init()
    }

    // MARK: Lifecycle: start() and stop()

    /// Start capturing from the display.
    /// Configures SCStream with:
    /// - minimumFrameInterval = 5s (so we get ~1 frame per 5 seconds)
    /// - pixelFormat = 32BGRA (matches CVPixelBuffer format we expect)
    /// - sampleHandlerQueue = .main (callbacks arrive on main thread, safe for @MainActor isolation)
    func start() async throws {
        print("[SCStream] Starting capture for display \(displayID)")

        // Get the current shareable content (displays, windows, etc.)
        let content = try await SCShareableContent.current
        guard let display = content.displays.first(where: { $0.displayID == displayID }) else {
            throw NSError(domain: "StreamCapture", code: -1, userInfo: [NSLocalizedDescriptionKey: "Display not found"])
        }

        // Configure the stream: resolution (half of physical), frame interval, pixel format.
        let config = SCStreamConfiguration()
        config.width = Int(displaySize.width) / 2
        config.height = Int(displaySize.height) / 2
        config.minimumFrameInterval = CMTime(value: 5, timescale: 1) // 1 frame every 5 seconds
        config.pixelFormat = kCVPixelFormatType_32BGRA // Match expected CVPixelBuffer format

        // Create a content filter (this display, no excluded windows).
        let filter = SCContentFilter(display: display, excludingWindows: [])

        // Initialize the stream with our configuration.
        self.stream = SCStream(filter: filter, configuration: config, delegate: self)

        // Add ourselves as an output handler. Callbacks will arrive on .main queue.
        // This is CRITICAL for @MainActor.assumeIsolated to be safe.
        try stream?.addStreamOutput(self, type: .screen, sampleHandlerQueue: .main)

        // Start the capture session. This is async; the stream may fail to start (checked via delegate).
        try await stream?.startCapture()
        print("[SCStream] Capture started for display \(displayID)")
    }

    /// Stop capturing.
    func stop() async {
        guard let stream = stream else { return }
        do {
            try await stream.stopCapture()
            print("[SCStream] Capture stopped for display \(displayID)")
        } catch {
            print("[SCStream] Error stopping capture: \(error)")
        }
    }

    // MARK: SCStreamOutput Delegate (Frame Delivery)

    /// Receives video frames from the SCStream.
    ///
    /// CRITICAL: This method is **nonisolated** because it's an Objective-C protocol witness.
    /// Even though `self` is @MainActor, the delegate protocol requires a non-isolated signature.
    /// This is one of Swift 6's concurrency boundaries.
    ///
    /// Frame delivery happens on `sampleHandlerQueue` (configured as `.main`), so we're
    /// already on the main thread. We use `MainActor.assumeIsolated { }` to safely re-enter
    /// the actor's isolation for frame processing.
    ///
    /// Note: Swift 6 strict concurrency may warn about CVPixelBuffer crossing the isolation
    /// boundary. This is safe because:
    /// 1. CVPixelBuffer is obtained from CMSampleBuffer on the main thread
    /// 2. Core Video buffers are designed for multi-threaded access
    /// 3. We immediately use it on @MainActor (no delayed access)
    /// 4. Production code should extract Sendable data (pixel bytes) if passing across task boundaries
    nonisolated func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of outputType: SCStreamOutputType
    ) {
        // Extract CVPixelBuffer while still in the nonisolated context.
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
            print("[SCStream] ERROR: Could not extract pixel buffer from sample buffer")
            return
        }

        // Use nonisolated(unsafe) to capture the pixelBuffer reference locally.
        // This tells Swift 6 we know it's safe: we're on the main thread and will use it
        // immediately without any async crossing.
        nonisolated(unsafe) let safeBuffer = pixelBuffer

        // Re-enter @MainActor isolation for frame processing.
        MainActor.assumeIsolated {
            // Convert CVPixelBuffer → CIImage → CGImage.
            let ciImage = CIImage(cvPixelBuffer: safeBuffer)
            guard let cgImage = ciContext.createCGImage(ciImage, from: ciImage.extent) else {
                print("[SCStream] ERROR: Could not create CGImage from CIImage")
                return
            }

            // Save the frame as JPEG and increment counter.
            let timestamp = Int(Date().timeIntervalSince1970)
            let filename = "display\(displayID)_stream_\(timestamp).jpg"
            let fileURL = outputDir.appendingPathComponent(filename)

            saveJPEG(cgImage, to: fileURL)
            frameCount += 1
            print("[SCStream] [\(frameCount)] display\(displayID): saved \(filename) — \(cgImage.width)x\(cgImage.height)px")
        }
    }

    // MARK: JPEG File I/O

    /// Save a CGImage as JPEG to disk.
    /// Production note: This runs on @MainActor. For high-FPS streams, move to background queue
    /// with Task.detached(priority: .utility) { } to avoid blocking frame delivery.
    /// For this POC (5s interval), main thread I/O is fine.
    private func saveJPEG(_ image: CGImage, to url: URL) {
        guard let destination = CGImageDestinationCreateWithURL(
            url as CFURL,
            "public.jpeg" as CFString,
            1,
            nil
        ) else {
            print("[SCStream] ERROR: Could not create image destination at \(url.path)")
            return
        }

        let options: [CFString: Any] = [kCGImageDestinationLossyCompressionQuality: 0.8]
        CGImageDestinationAddImage(destination, image, options as CFDictionary)

        if !CGImageDestinationFinalize(destination) {
            print("[SCStream] ERROR: Could not finalize JPEG to \(url.path)")
        }
    }
}

// MARK: - StreamCapture + SCStreamDelegate Extension
// Extend StreamCapture to conform to SCStreamDelegate in a separate extension.
// This pattern avoids signature mismatch warnings when adopting optional protocol methods.
extension StreamCapture: SCStreamDelegate {
    /// Called when the stream stops (either by explicit stopCapture or on error).
    /// SCStreamDelegate declares this as optional, so we implement it in an extension
    /// to avoid signature warnings.
    nonisolated func stream(
        _ stream: SCStream,
        didStopWithError error: any Error
    ) {
        // Capture displayID before crossing into isolated context.
        let displayID = self.displayID
        MainActor.assumeIsolated {
            print("[SCStream] ERROR: Stream stopped for display \(displayID) with error: \(error.localizedDescription)")
        }
    }
}

// MARK: - AppDelegate: Manages all stream captures

/// Application delegate that:
/// 1. Creates and starts StreamCapture instances for all displays.
/// 2. Keeps strong references to captures (prevents ARC deallocation).
/// 3. Handles Ctrl+C gracefully (TODO: add signal handler).
@MainActor final class AppDelegate: NSObject, NSApplicationDelegate {
    /// Strong references to all active StreamCapture instances.
    /// CRITICAL: Without this, captures would be deallocated immediately (ARC).
    /// The stream lifecycle is tied to the object lifetime.
    private var captures: [StreamCapture] = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Create output directory.
        do {
            try FileManager.default.createDirectory(at: outputDir, withIntermediateDirectories: true)
        } catch {
            print("[AppDelegate] ERROR: Could not create output dir \(outputDir.path): \(error)")
            NSApplication.shared.terminate(nil)
            return
        }

        print("[AppDelegate] Writing frames to \(outputDir.path)")
        print("[AppDelegate] Capture interval: 5s  |  Press Ctrl+C to stop")

        // Start streams for all displays.
        Task {
            do {
                // Get all connected displays.
                let content = try await SCShareableContent.current
                let displays = content.displays

                if displays.isEmpty {
                    print("[AppDelegate] WARNING: No displays found")
                    NSApplication.shared.terminate(nil)
                    return
                }

                print("[AppDelegate] Found \(displays.count) display(s)")

                // Create and start a StreamCapture for each display.
                for display in displays {
                    let capture = StreamCapture(
                        displayID: display.displayID,
                        displaySize: (width: display.width, height: display.height)
                    )
                    do {
                        try await capture.start()
                        captures.append(capture) // Store strong reference
                    } catch {
                        print("[AppDelegate] ERROR: Failed to start capture for display \(display.displayID): \(error)")
                    }
                }

                print("[AppDelegate] Started \(captures.count) stream(s)")
            } catch {
                print("[AppDelegate] ERROR: Could not get shareable content: \(error)")
                NSApplication.shared.terminate(nil)
            }
        }
    }
}

// MARK: - Entry Point

// In Swift 6, the top-level code context is implicitly @MainActor when run in an application.
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate

// Run the application. This starts the run loop, enabling:
// - NSApplicationDelegate callbacks (applicationDidFinishLaunching)
// - SCStream callbacks on the main thread
// - Ctrl+C signal handling (implicitly by the run loop)
app.run()
