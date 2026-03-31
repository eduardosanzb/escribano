import Foundation

/// Global logging function for the escribano recorder.
///
/// Writes timestamped messages to both stdout and a log file at
/// ~/.escribano/logs/recorder.log. The file is created on first use.
func log(_ message: String) {
    let timestamp = ISO8601DateFormatter().string(from: Date())
    let line = "[\(timestamp)] \(message)"

    // Always print to stdout (captured by `log stream` or Console.app)
    print(line)
    fflush(stdout)

    // Also write to log file
    writeToLogFile(line)
}

private func writeToLogFile(_ line: String) {
    let logsDir = (ProcessInfo.processInfo.environment["HOME"] ?? NSHomeDirectory())
        + "/.escribano/logs"
    let logPath = logsDir + "/recorder.log"

    // Ensure directory exists
    try? FileManager.default.createDirectory(atPath: logsDir, withIntermediateDirectories: true)

    // Append to log file
    guard let handle = FileHandle(forWritingAtPath: logPath) else {
        // File doesn't exist — create it
        try? (line + "\n").write(toFile: logPath, atomically: true, encoding: .utf8)
        return
    }

    defer { try? handle.close() }
    handle.seekToEndOfFile()
    if let data = (line + "\n").data(using: .utf8) {
        handle.write(data)
    }
}
