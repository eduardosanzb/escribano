import Foundation
@preconcurrency import MLXVLM
@preconcurrency import MLXLMCommon
// MARK: - VLMAnalyzerError
enum VLMAnalyzerError: Error, LocalizedError {
    case modelNotLoaded
    case modelLoadFailed(String)
    var errorDescription: String? {
        switch self {
        case .modelNotLoaded:           return "VLM model not loaded — call loadModel() first"
        case .modelLoadFailed(let m):   return "VLM model load failed: \(m)"
        }
    }
}
// MARK: - VLMAnalyzer
//
// Actor that owns the VLM model and drives the continuous analysis loop.
//
// Lifecycle:
//   1. main.swift creates VLMAnalyzer and calls loadModel() — model downloads/loads into GPU
//   2. main.swift spawns analyzeLoop() as a Task — runs until SIGTERM cancels it
//   3. analyzeLoop() polls the DB, runs VLM on batches, writes observations, marks frames done
//   4. On shutdown, Task.isCancelled becomes true → loop exits cleanly
actor VLMAnalyzer {
    private let obsStore: any ObservationStore
    private var modelContainer: MLXLMCommon.ModelContainer?
    private let modelId:      String
    private let batchSize:    Int
    private let pollInterval: Double
    init(obsStore: any ObservationStore) {
        self.obsStore     = obsStore
        self.modelId      = ProcessInfo.processInfo.environment["ESCRIBANO_VLM_MODEL"]
//                            ?? "mlx-community/Qwen3-VL-2B-Instruct-4bit"
//                            ?? "mlx-community/Qwen3-VL-4B-Instruct-4bit"
//                            ?? "mlx-community/Qwen3.5-2B-6bit"
                            ?? "mlx-community/Qwen3.5-0.8B-8bit"
        self.batchSize    = Int(ProcessInfo.processInfo.environment["ESCRIBANO_ANALYZE_BATCH_SIZE"] ?? "") ?? 5
        self.pollInterval = 10.0
    }
    func loadModel() async throws {
        print("[VLMAnalyzer] Loading model: \(modelId)")
        print("[VLMAnalyzer] (First run downloads ~4GB to ~/.cache/huggingface/hub/)")
        let t0 = Date()
        let config = ModelConfiguration(id: modelId)
        do {
            let container = try await VLMModelFactory.shared.loadContainer(configuration: config) { progress in
                let pct = Int(progress.fractionCompleted * 100)
                print("[VLMAnalyzer] Loading... \(pct)%", terminator: "\r")
                fflush(stdout)
            }
            self.modelContainer = container
            let elapsed = String(format: "%.1f", Date().timeIntervalSince(t0))
            print("\n[VLMAnalyzer] Model loaded in \(elapsed)s")
        } catch {
            throw VLMAnalyzerError.modelLoadFailed(error.localizedDescription)
        }
    }
    func analyzeLoop() async {
        print("[VLMAnalyzer] Starting analysis loop. Batch size: \(batchSize), Poll interval: \(pollInterval)s")
        while !Task.isCancelled {
            do {
                let frames = try await obsStore.claimFrames(batchSize: batchSize)
                if frames.isEmpty {
                    try await Task.sleep(for: .seconds(pollInterval))
                    continue
                }
                print("[VLMAnalyzer] Analyzing \(frames.count) frames...")
                let t0 = Date()
                guard let container = modelContainer else {
                    print("[VLMAnalyzer] ERROR: Model not loaded. Skipping batch.")
                    try await Task.sleep(for: .seconds(pollInterval))
                    continue
                }
                let descriptions: [FrameDescription]
                do {
                    descriptions = try await VLMRunner.runBatch(frames: frames, container: container)
                } catch {
                    print("[VLMAnalyzer] VLM inference error: \(error.localizedDescription)")
                    for frame in frames {
                        try? await obsStore.markFrameFailed(id: frame.id)
                    }
                    continue
                }
                let elapsed = String(format: "%.1f", Date().timeIntervalSince(t0))
                print("[VLMAnalyzer] Batch complete: \(descriptions.count)/\(frames.count) parsed in \(elapsed)s")
                do {
                    try await obsStore.saveObservations(from: frames, descriptions: descriptions)
                } catch {
                    print("[VLMAnalyzer] DB write error: \(error.localizedDescription)")
                    continue
                }
                let analyzedCount = min(frames.count, descriptions.count)
                let analyzedIds   = frames.prefix(analyzedCount).map { $0.id }
                do {
                    try await obsStore.markFramesAnalyzed(ids: analyzedIds)
                } catch {
                    print("[VLMAnalyzer] Failed to mark frames analyzed: \(error.localizedDescription)")
                }
                if descriptions.count < frames.count {
                    let failedFrames = Array(frames.dropFirst(analyzedCount))
                    print("[VLMAnalyzer] \(failedFrames.count) frames unparsed — marking for retry")
                    for frame in failedFrames {
                        try? await obsStore.markFrameFailed(id: frame.id)
                    }
                }
            } catch is CancellationError {
                break
            } catch {
                print("[VLMAnalyzer] Unexpected error: \(error.localizedDescription)")
                try? await Task.sleep(for: .seconds(pollInterval))
            }
        }
        print("[VLMAnalyzer] Loop exited.")
    }
}
