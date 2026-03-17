import Foundation

private let logDateFormatter: DateFormatter = {
  let formatter = DateFormatter()
  formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
  formatter.locale = Locale(identifier: "en_US_POSIX")
  formatter.timeZone = TimeZone.current
  return formatter
}()

func log(_ message: String) {
  let timestamp = logDateFormatter.string(from: Date())
  print("\(timestamp) \(message)")
}
