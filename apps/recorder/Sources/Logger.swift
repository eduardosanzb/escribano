import Foundation

/// Log file path constants (computed once at file load).
private let logsDirPath: String = (ProcessInfo.processInfo.environment["HOME"] ?? NSHomeDirectory()) + "/.escribano/logs"
private let logFilePath: String = logsDirPath + "/recorder.log"

/// Serial queue for thread-safe log file writes.
private let logQueue = DispatchQueue(label: "com.escribano.logger", qos: .utility)

/// Lazily-opened persistent file handle for append-only log writes.
/// Only ever accessed from logQueue (serial), so nonisolated(unsafe) is safe here.
nonisolated(unsafe) private var logFileHandle: FileHandle?

/// Global logging function for the escribano recorder.
///
/// Writes timestamped messages to both stdout and a log file at
/// ~/.escribano/logs/recorder.log. The file is created on first use.
func log(_ message: String) {
    let timestamp = Date().ISO8601Format()
    let line = "[\(timestamp)] \(message)"

    // Always print to stdout (captured by `log stream` or Console.app)
    print(line)
    fflush(stdout)

    // Thread-safe file write via serial queue
    logQueue.async {
        writeToLogFile(line)
    }
}

private func writeToLogFile(_ line: String) {
    if logFileHandle == nil {
        // Ensure directory exists
        try? FileManager.default.createDirectory(atPath: logsDirPath, withIntermediateDirectories: true)

        // Create file if needed
        if !FileManager.default.fileExists(atPath: logFilePath) {
            FileManager.default.createFile(atPath: logFilePath, contents: nil)
        }

        logFileHandle = FileHandle(forWritingAtPath: logFilePath)
        logFileHandle?.seekToEndOfFile()
    }

    guard let handle = logFileHandle,
          let data = (line + "\n").data(using: .utf8) else { return }
    handle.write(data)
}
