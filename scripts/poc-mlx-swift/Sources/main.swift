import Foundation

let args = CommandLine.arguments
guard args.count >= 2 else {
    print("""
    Usage:
      poc-mlx-swift vlm <image-path> [<image-path> ...] [model-dir]
      poc-mlx-swift llm <prompt> [model-dir]
      poc-mlx-swift compare

    Examples:
      # Single image (vlm-single.md prompt)
      poc-mlx-swift vlm ~/.escribano/frames/2026-03-13/1773422039076_1.jpg

      # Multiple images (vlm-batch.md prompt, interleaved)
      poc-mlx-swift vlm frame1.jpg frame2.jpg frame3.jpg

      # Default LLM prompt
      poc-mlx-swift llm default

      # Custom LLM prompt
      poc-mlx-swift llm "What is MLX?"

      # Compare VLM descriptions vs database
      poc-mlx-swift compare
    """)
    exit(1)
}

let command = args[1]

// Default model snapshot paths — cached, no download needed
let homeDir = NSHomeDirectory()
let defaultVLMDir = "\(homeDir)/.cache/huggingface/hub/models--mlx-community--Qwen3-VL-4B-Instruct-4bit/snapshots/2fd8dacbdb8f1e54b8c005f081ec5bf79c56376b"
/// /Users/eduardosanchez/.cache/huggingface/hub/models--mlx-community--Qwen3-VL-4B-Instruct-4bit/snapshots/2fd8dacbdb8f1e54b8c005f081ec5bf79c56376b
let defaultLLMDir = "\(homeDir)/.cache/huggingface/hub/models--mlx-community--Qwen3.5-4B-4bit/snapshots/0e7ffd5c629ef7719d4cbc04069232580bfa9d9c"

/// now we always run the vlm command fuck it; and then we loop all the files
/// in the  ~/.escribano/frames/2026-03-13/
var modelDir = defaultVLMDir

let imagesDir: String = "\(homeDir)/.escribano/frames/2026-03-13/"
let fm = FileManager.default
var imagePaths: [String] = []
do {
    let content = try fm.contentsOfDirectory(atPath: imagesDir)
    print(content)
    let dirURL = URL(fileURLWithPath: imagesDir)
    let fullPaths = content
        .filter { $0.hasSuffix(".jpg") }
        .prefix(5)
        .map { dirURL.appendingPathComponent($0).path }
    print(fullPaths)
    imagePaths = fullPaths

} catch {
    print("Error listing dir: \(error)")
    exit(1)
}

let result = try await VLMRunner.runBatch(imagePaths: imagePaths, modelDir: modelDir)
print(result)

// switch command {
// case "vlm":
//    guard args.count >= 3 else {
//        print("Error: vlm requires at least one image path")
//        exit(1)
//    }
//
//    // Remaining args: image paths and optional final model-dir
//    // Model dir heuristic: if last arg contains "/" and is a valid path, treat as model-dir
//    let remaining = Array(args.dropFirst(2))
//    var imagePaths = remaining
//
//    if let last = remaining.last, FileManager.default.fileExists(atPath: last) {
//        // Could be either image or model dir — check if it's a model dir (contains snapshots hash)
//        if last.contains("models--mlx-community") || last.hasSuffix(".ndjson") == false {
//            // Likely a model dir
//            if !last.hasSuffix(".jpg") && !last.hasSuffix(".png") && !last.hasSuffix(".jpeg") {
//                modelDir = last
//                imagePaths.removeLast()
//            }
//        }
//    }
//
//    guard !imagePaths.isEmpty else {
//        print("Error: provide at least one image path")
//        exit(1)
//    }
//
//    try await VLMRunner.run(imagePaths: imagePaths, modelDir: modelDir)
//
// case "llm":
//    guard args.count >= 3 else {
//        print("Error: llm requires a prompt")
//        exit(1)
//    }
//    let prompt   = args[2]
//    let modelDir = args.count > 3 ? args[3] : defaultLLMDir
//    try await LLMRunner.run(prompt: prompt, modelDir: modelDir)
//
// case "compare":
//    try await CompareRunner.run(modelDir: defaultVLMDir)
//
// default:
//    print("Unknown command: \(command). Use 'vlm', 'llm', or 'compare'.")
//    exit(1)
// }
