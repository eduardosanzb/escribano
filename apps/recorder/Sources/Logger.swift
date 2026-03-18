import Foundation

/// Global logging function for the escribano recorder daemon.
///
/// Writes timestamped messages to stdout. The LaunchAgent captures stdout
/// to a log file, so all `log()` output is persisted automatically.
func log(_ message: String) {
    print(message)
    fflush(stdout)
}
