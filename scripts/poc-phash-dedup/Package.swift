// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "phash-dedup-poc",
    platforms: [.macOS(.v15)],
    targets: [
        .executableTarget(
            name: "phash-dedup-poc",
            path: "Sources"
        )
    ]
)
