// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "escribano-recorder",
    platforms: [.macOS(.v14)],
<<<<<<< HEAD
    // No external Swift package dependencies.
    // VLM inference is handled by the Python mlx_bridge.py process (via Unix socket),
    // which uses mlx-vlm at 170-190 tok/s — 15x faster than mlx-swift-lm.
    dependencies: [],
    targets: [
        .executableTarget(
            name: "escribano",
            dependencies: [],
=======
    dependencies: [
        // mlx-swift-lm: Apple's Swift-native MLX inference library.
        // Same version as scripts/poc-mlx-swift/Package.swift — do NOT change.
        // This adds VLM inference capability without any Python dependency.
        .package(url: "https://github.com/ml-explore/mlx-swift-lm/", branch: "main"),

    ],
    targets: [
        .executableTarget(
            name: "escribano",
            dependencies: [
                // MLXVLM: vision-language model support (image + text input)
                .product(name: "MLXVLM",      package: "mlx-swift-lm"),
                // MLXLMCommon: shared types — ModelContainer, UserInput, generate()
                .product(name: "MLXLMCommon", package: "mlx-swift-lm"),
            ],
>>>>>>> b8d426e (failed swift inference)
            path: "Sources",
            linkerSettings: [
                .linkedLibrary("sqlite3")
            ]
        )
    ]
)
