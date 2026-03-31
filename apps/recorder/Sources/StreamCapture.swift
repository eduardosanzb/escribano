import Cocoa
@preconcurrency import ScreenCaptureKit
import CoreMedia
import CoreImage

enum PauseReason: Hashable {
    case backpressure
    case screenLock
    case sleep
    case user
}

/// StreamCapture: Manages SCStream lifecycle and frame processing.
@MainActor
final class StreamCapture: NSObject {
    private var stream:       SCStream?
    private var bridge:       StreamBridge?
    private let displayID:    UInt32
    private let ciContext   = CIContext()
    private let pHasher     = PHash()
    private let store:       any FrameStore
    private let backpressure: Backpressure

    private var pauseReasons: Set<PauseReason> = []
    private var isPaused: Bool { !pauseReasons.isEmpty }

    // Debugging configuration
    private let debugPHash: Bool
    private let pHashThreshold: Int

    private var prevPHash:    UInt64? = nil
    private var frameCounter: Int     = 0

    // Rolling stats
    private var framesSeen:    Int = 0
    private var framesSkipped: Int = 0
    private var captureStartTime: Date?

    // Reuse formatters — DateFormatter allocation is expensive (~5ms each)
    private let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
    private let isoFormatter = ISO8601DateFormatter()

    // Churn rate detection
    private var lastSeenPHash: UInt64? = nil       // Updated EVERY frame (for churn measurement)
    private var churnTimestamps: [Date] = []        // Rolling window of frame-to-frame changes
    private var isThrottled: Bool = false
    private var lastThrottledKeptTime: Date? = nil
    private let churnThreshold: Int                 // Unique frames/min to trigger throttle
    private let churnThrottleInterval: TimeInterval  // Seconds between kept frames when throttled

    // Frame storage root (persistent): ~/.escribano/frames/
    private static var framesBaseDir: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".escribano/frames")
    }

    /// Prepares SCStream for a given display and starts capture.
    init(display: SCDisplay, store: any FrameStore, backpressure: Backpressure) async throws {
        self.displayID    = display.displayID
        self.store        = store
        self.backpressure = backpressure
        
        // Read debug flag and threshold from environment
        self.debugPHash = ProcessInfo.processInfo.environment["ESCRIBANO_DEBUG_PHASH"] == "true"
        self.pHashThreshold = Int(ProcessInfo.processInfo.environment["ESCRIBANO_PHASH_THRESHOLD"] ?? "") ?? 4
        self.churnThreshold = Int(ProcessInfo.processInfo.environment["ESCRIBANO_CHURN_THRESHOLD"] ?? "") ?? 40
        self.churnThrottleInterval = Double(ProcessInfo.processInfo.environment["ESCRIBANO_CHURN_THROTTLE_INTERVAL"] ?? "") ?? 30.0
        
        super.init()

        let bridge = StreamBridge(capture: self)
        self.bridge = bridge

        let config = SCStreamConfiguration()
        config.width                = display.width  / 2   
        config.height               = display.height / 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)  
        config.pixelFormat          = kCVPixelFormatType_32BGRA

        let filter = SCContentFilter(display: display, excludingWindows: [])
        stream = SCStream(filter: filter, configuration: config, delegate: bridge)
        
        try stream?.addStreamOutput(bridge, type: .screen, sampleHandlerQueue: .main)
        try await stream?.startCapture()
        captureStartTime = Date()

        log("[StreamCapture] Started — display \(displayID), \(display.width/2)x\(display.height/2)")
        if debugPHash {
            print("[pHash] Verbose logging ENABLED")
        }
    }

    func stop() async {
        try? await stream?.stopCapture()
        log("[StreamCapture] Stopped.")
    }

    func pause(_ reason: PauseReason) {
        let wasEmpty = pauseReasons.isEmpty
        pauseReasons.insert(reason)
        if wasEmpty {
            Task { try? await stream?.stopCapture() }
        }
        log("[StreamCapture] Paused (\(reason)). Active reasons: \(pauseReasons)")
    }

    func resume(_ reason: PauseReason) {
        pauseReasons.remove(reason)
        if pauseReasons.isEmpty {
            Task { try? await stream?.startCapture() }
        }
        log("[StreamCapture] Resumed from \(reason). Active reasons: \(pauseReasons)")
    }

    // MARK: — Frame processing

    fileprivate func processFrame(_ pixelBuffer: CVPixelBuffer) {
        guard !isPaused else { return }
        framesSeen += 1
        
        let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        guard let cgImage = ciContext.createCGImage(ciImage, from: ciImage.extent) else { return }

        let hash = pHasher.compute(cgImage)

        // --- Churn detection: compare to PREVIOUS frame (updated every frame) ---
        let churnHamming = lastSeenPHash.map { (hash ^ $0).nonzeroBitCount } ?? 0
        lastSeenPHash = hash  // Always update — tracks actual screen change rate

        let now = Date()
        if churnHamming > pHashThreshold {
            churnTimestamps.append(now)
        }
        // Prune entries older than 60 seconds
        churnTimestamps.removeAll { now.timeIntervalSince($0) > 60.0 }
        
        let wasThrottled = isThrottled
        isThrottled = churnTimestamps.count > churnThreshold
        
        if isThrottled && !wasThrottled {
            log("[StreamCapture] High churn detected (\(churnTimestamps.count) changes/min > \(churnThreshold)) — throttling to 1 frame per \(Int(churnThrottleInterval))s")
        } else if !isThrottled && wasThrottled {
            log("[StreamCapture] Churn rate normalized (\(churnTimestamps.count) changes/min) — resuming normal capture")
            lastThrottledKeptTime = nil
        }

        // --- Dedup: compare to last KEPT frame ---
        let hamming = prevPHash.map { (hash ^ $0).nonzeroBitCount } ?? 99
        let isDuplicate = hamming <= pHashThreshold

        if debugPHash && !isDuplicate {
            log("[pHash] KEEP frame=\(framesSeen) hamming=\(hamming) churn=\(churnTimestamps.count)/min throttled=\(isThrottled)")
        }

        // Rolling stats every 100 frames seen
        if framesSeen % 100 == 0 {
            let kept = framesSeen - framesSkipped
            let skipPct = (Double(framesSkipped) / Double(framesSeen)) * 100.0
            
            var fpsLine = ""
            if let start = captureStartTime {
                let elapsed = Date().timeIntervalSince(start)
                let deliveredFps = elapsed > 0 ? Double(framesSeen) / elapsed : 0
                let storedFps = elapsed > 0 ? Double(frameCounter) / elapsed : 0
                fpsLine = String(format: ", %.2f fps delivered, %.2f fps stored", deliveredFps, storedFps)
            }
            
            log(String(format: "[pHash] Stats: %d seen, %d skipped (%.1f%%), %d kept, churn=%d/min, throttled=%@%@",
                framesSeen, framesSkipped, skipPct, kept, churnTimestamps.count, isThrottled ? "YES" : "NO", fpsLine))
        }

        if isDuplicate {
            framesSkipped += 1
            return
        }

        // --- Throttle gate: allow only 1 frame per churnThrottleInterval ---
        if isThrottled {
            if let lastKept = lastThrottledKeptTime, 
               now.timeIntervalSince(lastKept) < churnThrottleInterval {
                framesSkipped += 1
                return
            }
            lastThrottledKeptTime = now
        }

        prevPHash = hash

        // Metadata generation
        let timestamp   = now.timeIntervalSince1970
        let hashHex     = String(hash, radix: 16, uppercase: false)

        let dayDir  = Self.framesBaseDir.appendingPathComponent(dayFormatter.string(from: now))
        let fileURL = dayDir.appendingPathComponent("\(Int(timestamp * 1000))_\(displayID).jpg")

        do {
            try FileManager.default.createDirectory(at: dayDir, withIntermediateDirectories: true)
            saveJPEG(cgImage, to: fileURL)
        } catch {
            log("[StreamCapture] Filesystem error: \(error.localizedDescription)")
            return
        }

        let capturedAt = isoFormatter.string(from: now)

        let metadata = FrameMetadata(
            id:         UUID().uuidString,
            displayId:  String(displayID),
            capturedAt: capturedAt,
            timestamp:  timestamp,
            imagePath:  fileURL.path,
            phash:      hashHex,
            width:      cgImage.width,
            height:     cgImage.height
        )

        do {
            try store.insertFrame(metadata)
        } catch {
            log("[StreamCapture] Store insert failed: \(error.localizedDescription)")
            try? FileManager.default.removeItem(at: fileURL)  
            return
        }

        frameCounter += 1
        backpressure.onFrameCaptured()

        if frameCounter % 100 == 0 {
            log("[StreamCapture] \(frameCounter) frames stored in DB")
        }
    }

    fileprivate func handleStreamError(_ error: any Error) {
        log("[StreamCapture] Stream error: \(error.localizedDescription)")
    }

    private func saveJPEG(_ image: CGImage, to url: URL) {
        guard let dest = CGImageDestinationCreateWithURL(
            url as CFURL, "public.jpeg" as CFString, 1, nil
        ) else { return }
        CGImageDestinationAddImage(dest, image,
            [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
        CGImageDestinationFinalize(dest)
    }
}

// MARK: - StreamBridge

/// Non-isolated trampoline for ScreenCaptureKit callbacks.
///
/// StreamCapture is @MainActor, but ScreenCaptureKit is @preconcurrency imported.
/// If StreamCapture directly conforms to the ScreenCaptureKit protocols, Swift 6
/// can insert a hidden actor check into the protocol witness thunk. That check is
/// what crashes when ScreenCaptureKit calls back from a non-main queue.
///
/// This bridge is plain NSObject with no actor isolation, so the witness thunk
/// stays free of actor checks. It forwards work back to StreamCapture on the
/// MainActor explicitly via Task.
final class StreamBridge: NSObject, SCStreamOutput, SCStreamDelegate {
    private weak var capture: StreamCapture?

    init(capture: StreamCapture) {
        self.capture = capture
    }

    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of type: SCStreamOutputType
    ) {
        var isComplete = true
        if let attachments = CMSampleBufferGetSampleAttachmentsArray(
                sampleBuffer, createIfNecessary: false) as? [NSDictionary],
           let first  = attachments.first,
           let rawInt = (first[SCStreamFrameInfo.status] as? NSNumber)?.intValue,
           let status = SCFrameStatus(rawValue: rawInt) {
            isComplete = (status == .complete)
        }
        guard isComplete else { return }

        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        nonisolated(unsafe) let safeBuffer = pixelBuffer
        let capture = capture
        Task { @MainActor [capture] in
            capture?.processFrame(safeBuffer)
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: any Error) {
        let capture = capture
        Task { @MainActor [capture] in
            capture?.handleStreamError(error)
        }
    }
}
