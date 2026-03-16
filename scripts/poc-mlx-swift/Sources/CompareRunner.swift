import Foundation

enum CompareRunner {
    
    // --- Configuration (edit these to control the run) ---
    static let frameDir  = "\(NSHomeDirectory())/.escribano/frames/2026-03-13/"
    static let batchSize = 2       // frames per VLM call
    static let limit     = 10      // nil = process all, otherwise limit to N frames
    // ---------------------------------------------------
    
    static func run(modelDir: String) async throws {
        print("[Compare] Loading images from \(frameDir)...")
        let t0 = Date()
        
        // Get all JPG files, sorted by name
        let fileManager = FileManager.default
        let files = try fileManager.contentsOfDirectory(atPath: frameDir)
        let jpgFiles = files.filter { $0.hasSuffix(".jpg") }.sorted()
        let filesToProcess = limit > 0 ? Array(jpgFiles.prefix(limit)) : jpgFiles
        
        print("[Compare] Found \(filesToProcess.count) images\n")
        
        guard !filesToProcess.isEmpty else {
            print("[Compare] No images found in \(frameDir)")
            return
        }
        
        // Split into batches
        let batches = stride(from: 0, to: filesToProcess.count, by: batchSize).map { start in
            let end = min(start + batchSize, filesToProcess.count)
            return Array(filesToProcess[start..<end])
        }
        
        var totalBatchTime = 0.0
        
        for (batchIdx, batch) in batches.enumerated() {
            let startIdx = filesToProcess.firstIndex(of: batch[0])! + 1
            let endIdx = filesToProcess.firstIndex(of: batch.last!)! + 1
            print("=== Batch \(batchIdx + 1)/\(batches.count) (frames \(startIdx)-\(endIdx)) ===\n")
            
            let batchStart = Date()
            let imagePaths = batch.map { frameDir + $0 }
            let descriptions = try await VLMRunner.runBatch(imagePaths: imagePaths, modelDir: modelDir)
            let batchTime = Date().timeIntervalSince(batchStart)
            totalBatchTime += batchTime
            
            for (i, imagePath) in batch.enumerated() {
                let desc = i < descriptions.count ? descriptions[i] : "(parsing failed)"
                print("[\(imagePath)]")
                print("  \(desc)\n")
            }
            
            print("[Compare] Batch \(batchIdx + 1) completed in \(String(format: "%.1f", batchTime))s (\(String(format: "%.1f", Double(batch.count) / batchTime)) frames/s)\n")
        }
        
        let totalTime = Date().timeIntervalSince(t0)
        print("""
        === Done ===
        Frames processed : \(filesToProcess.count)
        Batches          : \(batches.count)
        Total time       : \(String(format: "%.1f", totalTime))s
        Avg per frame    : \(String(format: "%.1f", totalTime / Double(filesToProcess.count)))s
        Avg per batch    : \(String(format: "%.1f", totalBatchTime / Double(batches.count)))s
        """)
    }
}
