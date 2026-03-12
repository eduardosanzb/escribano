// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "sck-stream-poc",
    platforms: [.macOS(.v15)],
    targets: [
        .executableTarget(
            name: "sck-stream-poc",
            path: "Sources"
        )
    ]
)
