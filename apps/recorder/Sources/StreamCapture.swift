import Cocoa
@preconcurrency import ScreenCaptureKit
import CoreMedia
import CoreImage

/// StreamCapture: Manages SCStream lifecycle and frame processing.
///
/// Implements SCStreamOutput to receive screen frames and SCStreamDelegate for stream events.
///
/// @MainActor: ensures all stream configuration, management, and frame processing 
/// occur on the main thread for consistent state management.
///
/// Architecture note: This class depends on the FrameStore protocol (Port),
/// not a concrete implementation. The store is injected at initialization,
/// allowing different storage backends without modifying capture logic.
@MainActor
final class StreamCapture: NSObject, SCStreamOutput, SCStreamDelegate {
    private var stream:       SCStream?
    private let displayID:    UInt32
    private let ciContext   = CIContext()
    private let pHasher     = PHash()
    private let store:       any FrameStore
    private let backpressure: Backpressure

    private var prevPHash:    UInt64? = nil
    private var frameCounter: Int     = 0

    // Frame storage root (persistent): ~/.escribano/frames/
    private static var framesBaseDir: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".escribano/frames")
    }

    /// Prepares SCStream for a given display and starts capture.
    /// - Parameters:
    ///   - display: The display to capture.
    ///   - store: The frame store for persisting metadata.
    ///   - backpressure: The backpressure monitor for pause/resume control.
    init(display: SCDisplay, store: any FrameStore, backpressure: Backpressure) async throws {
        self.displayID    = display.displayID
        self.store        = store
        self.backpressure = backpressure
        super.init()

        // SCStreamConfiguration: controls capture parameters
        let config = SCStreamConfiguration()
        // Resolution: half-res is adequate for VLM analysis while saving bandwidth.
        config.width                = display.width  / 2   
        config.height               = display.height / 2
        // Minimum interval: 1s. The actual deduplication (pHash) is the primary throttle.
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)  
        // Pixel format: 32BGRA is native on Apple Silicon (no conversion needed).
        config.pixelFormat          = kCVPixelFormatType_32BGRA

        // Filter: captures all content from the selected display.
        let filter = SCContentFilter(display: display, excludingWindows: [])
        stream = SCStream(filter: filter, configuration: config, delegate: self)
        
        // Output: delivers frames directly to the main actor's queue.
        try stream?.addStreamOutput(self, type: .screen, sampleHandlerQueue: .main)
        try await stream?.startCapture()

        print("[StreamCapture] Started — display \(displayID), \(display.width/2)x\(display.height/2)")
    }

    /// Stops the capture stream.
    func stop() async {
        try? await stream?.stopCapture()
        print("[StreamCapture] Stopped.")
    }

    /// Pauses capture stream to prevent further frames from being delivered.
    func pause() {
        Task { @MainActor in
            try? await self.stream?.stopCapture()
            print("[StreamCapture] Paused.")
        }
    }

    /// Resumes capture stream after a pause.
    func resume() {
        Task { @MainActor in
            try? await self.stream?.startCapture()
            print("[StreamCapture] Resumed.")
        }
    }

    // MARK: — SCStreamOutput

    /// SCStreamOutput delegate: called for every frame delivered by the stream.
    nonisolated func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of type: SCStreamOutputType
    ) {
        // SCFrameStatus check: only process complete frames with actual pixel data.
        var isComplete = true
        if let attachments = CMSampleBufferGetSampleAttachmentsArray(
                sampleBuffer, createIfNecessary: false) as? [NSDictionary],
           let first  = attachments.first,
           let rawInt = (first[SCStreamFrameInfo.status] as? NSNumber)?.intValue,
           let status = SCFrameStatus(rawValue: rawInt) {
            isComplete = (status == .complete)
        }
        guard isComplete else { return }
        
        // Extract pixel buffer from CMSampleBuffer.
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        // Use assumeIsolated to safely process frame data on the MainActor.
        nonisolated(unsafe) let safeBuffer = pixelBuffer
        MainActor.assumeIsolated { self.processFrame(safeBuffer) }
    }

    /// SCStreamDelegate: called if the stream stops due to an error.
    nonisolated func stream(_ stream: SCStream, didStopWithError error: any Error) {
        MainActor.assumeIsolated {
            print("[StreamCapture] Stream error: \(error.localizedDescription)")
        }
    }

    // MARK: — Frame processing

    /// Processes a single frame: pHash deduplication, JPEG saving, and store insert.
    private func processFrame(_ pixelBuffer: CVPixelBuffer) {
        // Pixel buffer to CGImage conversion using CIImage and CIContext.
        let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        guard let cgImage = ciContext.createCGImage(ciImage, from: ciImage.extent) else { return }

        // pHash Deduplication: identifies if the current frame is visually similar to the previous.
        // Hamming distance threshold (8 bits) separates noise (0-4) from activity (10+).
        let hash = pHasher.compute(cgImage)
        if let prev = prevPHash, (hash ^ prev).nonzeroBitCount <= 8 { return }
        prevPHash = hash

        // Frame metadata generation
        let now         = Date()
        let timestamp   = now.timeIntervalSince1970
        let hashHex     = String(hash, radix: 16, uppercase: false)

        // Frame filesystem directory: ~/.escribano/frames/YYYY-MM-DD/
        let dateFmt = DateFormatter()
        dateFmt.dateFormat = "yyyy-MM-dd"
        let dayDir  = Self.framesBaseDir.appendingPathComponent(dateFmt.string(from: now))
        let fileURL = dayDir.appendingPathComponent("\(Int(timestamp * 1000))_\(displayID).jpg")

        do {
            // Create day-specific directory lazily
            try FileManager.default.createDirectory(at: dayDir, withIntermediateDirectories: true)
            // Save as JPEG at 85% quality to balance size and fidelity.
            saveJPEG(cgImage, to: fileURL)
        } catch {
            print("[StreamCapture] Filesystem error: \(error.localizedDescription)")
            return
        }

        // ISO8601 timestamp for SQL table (text-based sorting compatibility).
        let isoFmt = ISO8601DateFormatter()
        let capturedAt = isoFmt.string(from: now)

        // Build metadata struct and persist via store protocol.
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
            print("[StreamCapture] Store insert failed: \(error.localizedDescription)")
            // cleanup: delete orphaned JPEG if store insert fails.
            try? FileManager.default.removeItem(at: fileURL)  
            return
        }

        // Successful capture notification for backpressure logic.
        frameCounter += 1
        backpressure.onFrameCaptured()

        // Log capture progress every 100 frames.
        if frameCounter % 100 == 0 {
            print("[StreamCapture] \(frameCounter) frames captured")
        }
    }

    /// Writes a CGImage as a JPEG file to the provided URL.
    private func saveJPEG(_ image: CGImage, to url: URL) {
        guard let dest = CGImageDestinationCreateWithURL(
            url as CFURL, "public.jpeg" as CFString, 1, nil
        ) else { return }
        // Options include quality control. 0.85 is a safe balance for text legibility.
        CGImageDestinationAddImage(dest, image,
            [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
        CGImageDestinationFinalize(dest)
    }
}
