// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "sck-poc",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "sck-poc",
            path: "Sources"
        )
    ]
)
