// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "fotografo",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "fotografo",
            path: "Sources",
            linkerSettings: [
                .linkedLibrary("sqlite3")
            ]
        )
    ]
)
