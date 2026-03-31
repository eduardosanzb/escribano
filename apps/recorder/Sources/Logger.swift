import Foundation

/// Global logging function for the escribano recorder daemon.
///
/// Writes messages to stdout (not timestamped — the LaunchAgent captures
/// stdout to a log file where macOS adds timestamps automatically).
func log(_ message: String) {
    print(message)
    fflush(stdout)
}
