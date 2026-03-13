import Cocoa
@preconcurrency import ScreenCaptureKit
import CoreMedia
import CoreImage

// ── Shared result type ──────────────────────────────────────────────────────

struct FrameResult {
    let scenario:      String
    let frameNum:      Int       // counter resets per scenario (via startScenario)
    let elapsedS:      Double    // seconds since scenario start
    let scStatus:      String    // "idle" | "complete" | "blank" | "suspended" | "unknown"

    // Populated only when scStatus == "complete":
    let pHashHex:      String?
    let pHashHamming:  Int?      // nil for first complete frame of scenario (no previous)
    let dHashHex:      String?
    let dHashHamming:  Int?
    let vnDistance:    Float?
    let vnLatencyMs:   Double?
    let jpegPath:      String?
}

// ── FrameCapture ────────────────────────────────────────────────────────────

@MainActor
final class FrameCapture: NSObject, SCStreamOutput, SCStreamDelegate {
    // ── SCStream state ──────────────────────────────────────────────────────
    private var stream:      SCStream?
    private let displayID:   UInt32
    private let displaySize: (width: Int, height: Int)
    private let ciContext  = CIContext()
    private let framesDir:   URL

    // ── Signal analyzers ────────────────────────────────────────────────────
    private let pHasher  = PHash()
    private let dHasher  = DHash()
    private let vnDedup  = VNDedup()

    // ── Per-scenario state (reset by startScenario) ─────────────────────────
    private var currentScenario: String = "UNKNOWN"
    private var scenarioStart:   Date   = Date()
    private var frameCount:      Int    = 0
    private var prevPHash:       UInt64? = nil
    private var prevDHash:       UInt64? = nil

    // ── Callback ────────────────────────────────────────────────────────────
    var onFrame: ((FrameResult) -> Void)?

    init(displayID: UInt32, displaySize: (width: Int, height: Int), framesDir: URL) {
        self.displayID   = displayID
        self.displaySize = displaySize
        self.framesDir   = framesDir
    }

    // Call at the start of each scenario to reset counters and previous hashes
    func startScenario(_ name: String) {
        currentScenario = name
        scenarioStart   = Date()
        frameCount      = 0
        prevPHash       = nil
        prevDHash       = nil
        vnDedup.reset()
    }

    func start() async throws {
        let content = try await SCShareableContent.current
        guard let display = content.displays.first(where: { $0.displayID == displayID }) else {
            throw NSError(domain: "FrameCapture", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Display \(displayID) not found"])
        }

        let config = SCStreamConfiguration()
        config.width               = displaySize.width  / 2    // half-res for POC
        config.height              = displaySize.height / 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)   // 1 frame/s
        config.pixelFormat         = kCVPixelFormatType_32BGRA

        let filter = SCContentFilter(display: display, excludingWindows: [])
        stream = SCStream(filter: filter, configuration: config, delegate: self)
        try stream?.addStreamOutput(self, type: .screen, sampleHandlerQueue: .main)
        try await stream?.startCapture()
    }

    func stop() async {
        try? await stream?.stopCapture()
    }

    // ── SCStreamOutput ──────────────────────────────────────────────────────

    nonisolated func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of type: SCStreamOutputType
    ) {
        // Extract SCFrameStatus from sample buffer attachments
        var statusString = "unknown"
        var isComplete   = true   // assume complete if we can't read status

        if let attachments = CMSampleBufferGetSampleAttachmentsArray(
                sampleBuffer, createIfNecessary: false) as? [NSDictionary],
           let first    = attachments.first,
           let rawInt   = (first[SCStreamFrameInfo.status] as? NSNumber)?.intValue,
           let status   = SCFrameStatus(rawValue: rawInt) {
            switch status {
            case .complete:  statusString = "complete";  isComplete = true
            case .idle:      statusString = "idle";      isComplete = false
            case .blank:     statusString = "blank";     isComplete = false
            case .suspended: statusString = "suspended"; isComplete = false
            default:         statusString = "unknown";   isComplete = true
            }
        }

        // Idle frames: report status, no pixel data
        guard isComplete else {
            let s = statusString
            MainActor.assumeIsolated {
                frameCount += 1
                let result = FrameResult(
                    scenario: currentScenario,
                    frameNum: frameCount,
                    elapsedS: Date().timeIntervalSince(scenarioStart),
                    scStatus: s,
                    pHashHex: nil, pHashHamming: nil,
                    dHashHex: nil, dHashHamming: nil,
                    vnDistance: nil, vnLatencyMs: nil,
                    jpegPath: nil
                )
                onFrame?(result)
            }
            return
        }

        // Complete frames: extract pixel buffer and process
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        nonisolated(unsafe) let safeBuffer = pixelBuffer
        let safeStatus = statusString

        MainActor.assumeIsolated {
            frameCount += 1
            let elapsed = Date().timeIntervalSince(scenarioStart)

            // CGImage from pixel buffer
            let ciImage = CIImage(cvPixelBuffer: safeBuffer)
            guard let cgImage = ciContext.createCGImage(ciImage, from: ciImage.extent) else { return }

            // pHash
            let ph          = pHasher.compute(cgImage)
            let phHamming   = prevPHash.map { (ph ^ $0).nonzeroBitCount }
            prevPHash       = ph

            // dHash
            let dh          = dHasher.compute(cgImage)
            let dhHamming   = prevDHash.map { (dh ^ $0).nonzeroBitCount }
            prevDHash       = dh

            // VN feature print
            let vnResult    = vnDedup.computeDistance(from: cgImage)

            // Save JPEG
            let ts       = Int(Date().timeIntervalSince1970 * 1000)
            let filename = "\(currentScenario)_\(String(format: "%04d", frameCount))_\(ts).jpg"
            let fileURL  = framesDir.appendingPathComponent(filename)
            saveJPEG(cgImage, to: fileURL)

            let result = FrameResult(
                scenario:     currentScenario,
                frameNum:     frameCount,
                elapsedS:     elapsed,
                scStatus:     safeStatus,
                pHashHex:     String(ph, radix: 16, uppercase: false),
                pHashHamming: phHamming,
                dHashHex:     String(dh, radix: 16, uppercase: false),
                dHashHamming: dhHamming,
                vnDistance:   vnResult?.distance,
                vnLatencyMs:  vnResult?.latencyMs,
                jpegPath:     fileURL.path
            )
            onFrame?(result)
        }
    }

    nonisolated func stream(_ stream: SCStream, didStopWithError error: any Error) {
        let id = self.displayID
        MainActor.assumeIsolated {
            print("[FrameCapture] Stream for display \(id) stopped: \(error.localizedDescription)")
        }
    }

    // ── JPEG write ──────────────────────────────────────────────────────────

    private func saveJPEG(_ image: CGImage, to url: URL) {
        guard let dest = CGImageDestinationCreateWithURL(
            url as CFURL, "public.jpeg" as CFString, 1, nil
        ) else { return }
        CGImageDestinationAddImage(dest, image,
            [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
        CGImageDestinationFinalize(dest)
    }
}
