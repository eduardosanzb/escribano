// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "escribano-recorder",
    platforms: [.macOS(.v14)],
    // No external Swift package dependencies.
    // VLM inference is handled by the Python mlx_bridge.py process (via Unix socket),
    // which uses mlx-vlm at 170-190 tok/s — 15x faster than mlx-swift-lm.
    dependencies: [],
    targets: [
        .executableTarget(
            name: "escribano",
            dependencies: [],
            path: "Sources",
            linkerSettings: [
                .linkedLibrary("sqlite3")
            ]
        )
    ]
)
