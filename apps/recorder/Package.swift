// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "escribano-recorder",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "escribano",
            path: "Sources",
            linkerSettings: [
                .linkedLibrary("sqlite3")
            ]
        )
    ]
)
