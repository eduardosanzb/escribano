import Foundation

// CSVLogger: Appends FrameResult rows to /tmp/poc-dedup-results.csv

final class CSVLogger {
    let csvPath: String
    private let outputURL: URL
    private var fileHandle: FileHandle?

    init() {
        let url = URL(fileURLWithPath: "/tmp/poc-dedup-results.csv")
        self.outputURL = url
        self.csvPath   = url.path
    }

    func setup() {
        let header = "scenario,frame_num,elapsed_s,sc_status," +
                     "phash_hex,phash_hamming," +
                     "dhash_hex,dhash_hamming," +
                     "vn_distance,vn_latency_ms," +
                     "jpeg_path\n"
        FileManager.default.createFile(atPath: outputURL.path, contents: Data(header.utf8))
        fileHandle = try? FileHandle(forWritingTo: outputURL)
        fileHandle?.seekToEndOfFile()
    }

    func log(_ result: FrameResult) {
        let row: [String] = [
            result.scenario,
            "\(result.frameNum)",
            String(format: "%.1f", result.elapsedS),
            result.scStatus,
            result.pHashHex          ?? "",
            result.pHashHamming.map { "\($0)" } ?? "",
            result.dHashHex          ?? "",
            result.dHashHamming.map { "\($0)" } ?? "",
            result.vnDistance.map    { String(format: "%.4f", $0) } ?? "",
            result.vnLatencyMs.map   { String(format: "%.1f",  $0) } ?? "",
            result.jpegPath          ?? "",
        ]
        fileHandle?.write(Data((row.joined(separator: ",") + "\n").utf8))
    }

    func close() {
        fileHandle?.closeFile()
    }
}
