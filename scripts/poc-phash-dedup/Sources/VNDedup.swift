import Vision
import CoreGraphics

// VNDedup: Apple Vision Framework perceptual similarity (extra signal)
//
// Uses VNGenerateImageFeaturePrintRequest to produce a 768-dim float vector (macOS 14+).
// Compares consecutive frame observations using computeDistance(_:to:).
//
// Important notes:
//   - Latency is measured and logged so we can detect ANE vs CPU fallback
//     (ANE ~1–2ms, CPU fallback ~15–30ms for 1024×768)
//   - This POC runs foreground (Terminal), so GPU/ANE should be accessible.
//   - In a headless LaunchAgent, CoreML would need .cpuOnly — not tested here.
//   - distance = 0.0 is returned for the first frame (no previous frame to compare).

final class VNDedup {
    private var previousObservation: VNFeaturePrintObservation? = nil

    // Call at the start of each scenario to reset state
    func reset() {
        previousObservation = nil
    }

    // Returns (distance, latencyMs) or nil on error.
    // latencyMs includes both VN inference + computeDistance.
    func computeDistance(from image: CGImage) -> (distance: Float, latencyMs: Double)? {
        let startTime = Date()
        let request = VNGenerateImageFeaturePrintRequest()
        request.imageCropAndScaleOption = .scaleFit  // preserve aspect ratio for screen captures

        let handler = VNImageRequestHandler(cgImage: image, options: [:])
        do {
            try handler.perform([request])
        } catch {
            print("[VNDedup] Request failed: \(error.localizedDescription)")
            return nil
        }

        let latencyMs = Date().timeIntervalSince(startTime) * 1000.0

        guard let observation = request.results?.first as? VNFeaturePrintObservation else {
            print("[VNDedup] No VNFeaturePrintObservation in results")
            return nil
        }

        defer { previousObservation = observation }

        guard let prev = previousObservation else {
            return (distance: 0.0, latencyMs: latencyMs)
        }

        var distance: Float = 0
        do {
            try prev.computeDistance(&distance, to: observation)
        } catch {
            print("[VNDedup] computeDistance failed: \(error.localizedDescription)")
            return nil
        }

        return (distance: distance, latencyMs: latencyMs)
    }
}
