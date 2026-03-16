// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "poc-mlx-swift",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/ml-explore/mlx-swift-lm", from: "2.30.6"),
    ],
    targets: [
        .executableTarget(
            name: "poc-mlx-swift",
            dependencies: [
                .product(name: "MLXLLM",      package: "mlx-swift-lm"),
                .product(name: "MLXVLM",      package: "mlx-swift-lm"),
                .product(name: "MLXLMCommon", package: "mlx-swift-lm"),
            ],
            path: "Sources",
            linkerSettings: [
                .linkedLibrary("sqlite3")
            ]
        )
    ]
)
