import Foundation
// MARK: - PythonBridgeVLMAdapter
//
// Adapter that implements VLMInferenceService by spawning mlx_bridge.py as a
// child process and communicating over a Unix domain socket.
//
// --- Unix domain socket vs. TCP ---
// A Unix domain socket is a file on disk (e.g. /tmp/foo.sock) that two processes
// on the same machine can connect to, like a very fast local pipe. We use one
// because it's faster than TCP and doesn't need a port number.
//
// --- NDJSON (Newline-Delimited JSON) ---
// Both sides send one JSON object per line, terminated by "\n".
// The receiver reads until it finds a "\n", then parses that line as JSON.
// This is the simplest framing protocol for a stream socket.
//
// --- Process lifecycle ---
// 1. start() spawns Python, waits for {"status":"ready"} on stdout, then
//    connects the Unix socket.
// 2. runBatch() sends one vlm_infer request and waits for {"done":true}.
// 3. stop() sends SIGTERM to the Python process, disconnects the socket.
//
// Why "actor"?
//   An actor in Swift serializes access to its mutable state — only one task
//   can run inside the actor at a time. This prevents two concurrent runBatch()
//   calls from racing on the socket write/read state.
actor PythonBridgeVLMAdapter: VLMInferenceService {
    // MARK: - Configuration
    private let socketPath:   String  // e.g. /tmp/escribano-recorder-vlm.sock
    private let bridgePath:   String  // absolute path to mlx_bridge.py
    private let pythonPath:   String  // python3 executable to use
    private let modelId:      String  // e.g. mlx-community/Qwen3-VL-2B-Instruct-4bit
    private let maxTokens:    Int     // token budget per batch
    // MARK: - Mutable state (protected by actor isolation)
    private var process:      Process?
    private var fileHandle:   FileHandle?
    private var requestId:    Int = 0
    private var isStarted:    Bool = false
    // MARK: - Init
    init() {
        self.socketPath = ProcessInfo.processInfo.environment["ESCRIBANO_MLX_RECORDER_SOCKET"]
            ?? "/tmp/escribano-recorder-vlm.sock"
        if let override = ProcessInfo.processInfo.environment["ESCRIBANO_BRIDGE_PATH"] {
            self.bridgePath = override
        } else {
            self.bridgePath = (ProcessInfo.processInfo.environment["HOME"] ?? "/tmp")
                + "/.escribano/scripts/mlx_bridge.py"
        }
        let home = ProcessInfo.processInfo.environment["HOME"] ?? "/tmp"
        let managedVenv = home + "/.escribano/venv/bin/python3"
        if let explicit = ProcessInfo.processInfo.environment["ESCRIBANO_PYTHON_PATH"] {
            self.pythonPath = explicit
        } else if FileManager.default.fileExists(atPath: managedVenv) {
            self.pythonPath = managedVenv
        } else {
            let candidates = [
                "/opt/homebrew/bin/python3",
                "/usr/local/bin/python3",
                "/usr/bin/python3",
            ]
            self.pythonPath = candidates.first {
                FileManager.default.fileExists(atPath: $0)
            } ?? "/usr/bin/python3"
        }
        self.modelId = ProcessInfo.processInfo.environment["ESCRIBANO_VLM_MODEL"]
            ?? "mlx-community/Qwen3-VL-2B-Instruct-4bit"
        self.maxTokens = Int(ProcessInfo.processInfo.environment["ESCRIBANO_VLM_MAX_TOKENS"] ?? "") ?? 2000
    }
    func start() async throws {
        guard !isStarted else { return }
        print("[PythonBridge] Starting mlx_bridge.py (VLM mode)...")
        print("[PythonBridge] Python: \(pythonPath)")
        print("[PythonBridge] Bridge: \(bridgePath)")
        print("[PythonBridge] Model: \(modelId)")
        if FileManager.default.fileExists(atPath: socketPath) {
            try? FileManager.default.removeItem(atPath: socketPath)
        }
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: pythonPath)
        proc.arguments    = [bridgePath, "--mode", "vlm"]
        proc.environment  = buildEnv()
        let stdoutPipe = Pipe()
        proc.standardOutput = stdoutPipe
        proc.standardError = FileHandle.standardError
        try proc.run()
        self.process = proc
        print("[PythonBridge] Python PID: \(proc.processIdentifier)")
        try await waitForReady(stdout: stdoutPipe)
        try connectSocket()
        isStarted = true
        print("[PythonBridge] Ready. Socket connected at \(socketPath)")
    }
    func runBatch(frames: [DbFrame]) async throws -> [FrameDescription] {
        guard isStarted else {
            throw PythonBridgeError.notStarted
        }
        guard !frames.isEmpty else { return [] }
        requestId += 1
        let id = requestId
        var content: [[String: String]] = []
        for (i, frame) in frames.enumerated() {
            let frameNum = i + 1
            content.append(["type": "text",
                             "text": "Frame \(frameNum) (timestamp: \(Int(frame.timestamp))s):"])
            content.append(["type": "image",
                             "imagePath": frame.imagePath])
        }
        content.append(["type": "text", "text": Prompts.vlmBatch(frameCount: frames.count)])
        let request: [String: Any] = [
            "id":     id,
            "method": "vlm_infer",
            "params": [
                "messages": [["role": "user", "content": content]],
                "maxTokens": maxTokens
            ] as [String: Any]
        ]
        let rawText = try await sendAndReceive(request: request)
        let descriptions = ResponseParser.parseInterleavedOutput(rawText)
        print("[PythonBridge] Parsed \(descriptions.count)/\(frames.count) frame descriptions")
        return descriptions
    }
    func stop() async {
        print("[PythonBridge] Shutting down...")
        fileHandle?.closeFile()
        fileHandle = nil
        process?.terminate()
        process = nil
        isStarted = false
        try? FileManager.default.removeItem(atPath: socketPath)
    }
    private func buildEnv() -> [String: String] {
        var env = ProcessInfo.processInfo.environment
        env["ESCRIBANO_VLM_MODEL"]      = modelId
        env["ESCRIBANO_VLM_MAX_TOKENS"] = String(maxTokens)
        env["ESCRIBANO_MLX_SOCKET_PATH"] = socketPath.replacingOccurrences(
            of: "-vlm.sock", with: ".sock"
        )
        return env
    }
    private func waitForReady(stdout: Pipe) async throws {
        print("[PythonBridge] Waiting for model load (may take 30-120s on first run)...")
        let deadline = Date().addingTimeInterval(180)
        try await withCheckedThrowingContinuation { continuation in
            let buffer = LineBuffer()
            let resumed = ResumeFlag()
            stdout.fileHandleForReading.readabilityHandler = { handle in
                let data = handle.availableData
                guard !data.isEmpty else { return }
                buffer.text += String(data: data, encoding: .utf8) ?? ""
                while let newlineRange = buffer.text.range(of: "\n") {
                    let line = String(buffer.text[..<newlineRange.lowerBound])
                        .trimmingCharacters(in: .whitespaces)
                    buffer.text.removeSubrange(..<newlineRange.upperBound)
                    guard !line.isEmpty else { continue }
                    if let data = line.data(using: .utf8),
                       let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                       let status = json["status"] as? String,
                       status == "ready" {
                        guard !resumed.value else { return }
                        resumed.value = true
                        stdout.fileHandleForReading.readabilityHandler = nil
                        continuation.resume(returning: ())
                        return
                    }
                }
                if Date() > deadline && !resumed.value {
                    resumed.value = true
                    stdout.fileHandleForReading.readabilityHandler = nil
                    continuation.resume(throwing: PythonBridgeError.startupTimeout)
                }
            }
        }
    }
    private func connectSocket() throws {
        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        withUnsafeMutableBytes(of: &addr.sun_path) { ptr in
            _ = socketPath.withCString { cStr in
                strlcpy(ptr.baseAddress!.assumingMemoryBound(to: CChar.self), cStr, ptr.count)
            }
        }
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else {
            throw PythonBridgeError.socketError("socket() failed: \(errno)")
        }
        var connected = false
        for attempt in 1...5 {
            let result = withUnsafePointer(to: &addr) { ptr in
                ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                    Darwin.connect(fd, sockPtr, socklen_t(MemoryLayout<sockaddr_un>.size))
                }
            }
            if result == 0 {
                connected = true
                break
            }
            print("[PythonBridge] Socket connect attempt \(attempt)/5 failed (errno=\(errno)), retrying...")
            Thread.sleep(forTimeInterval: 0.5)
        }
        guard connected else {
            close(fd)
            throw PythonBridgeError.socketError("connect() failed after 5 attempts")
        }
        self.fileHandle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        print("[PythonBridge] Socket connected (fd=\(fd))")
    }
    private func sendAndReceive(request: [String: Any]) async throws -> String {
        guard let fh = fileHandle else {
            throw PythonBridgeError.notStarted
        }
        let jsonData = try JSONSerialization.data(withJSONObject: request)
        guard var line = String(data: jsonData, encoding: .utf8) else {
            throw PythonBridgeError.serializationFailed
        }
        line += "\n"
        fh.write(line.data(using: .utf8)!)
        return try await withCheckedThrowingContinuation { continuation in
            let buffer = LineBuffer()
            let resumed = ResumeFlag()
            fh.readabilityHandler = { handle in
                let data = handle.availableData
                if data.isEmpty {
                    guard !resumed.value else { return }
                    resumed.value = true
                    handle.readabilityHandler = nil
                    continuation.resume(throwing: PythonBridgeError.bridgeDied)
                    return
                }
                buffer.text += String(data: data, encoding: .utf8) ?? ""
                while let newlineRange = buffer.text.range(of: "\n") {
                    let line = String(buffer.text[..<newlineRange.lowerBound])
                    buffer.text.removeSubrange(..<newlineRange.upperBound)
                    guard !line.trimmingCharacters(in: .whitespaces).isEmpty else { continue }
                    guard let jsonData = line.data(using: .utf8),
                          let json = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any]
                    else { continue }
                    if let error = json["error"] as? String {
                        guard !resumed.value else { return }
                        resumed.value = true
                        handle.readabilityHandler = nil
                        continuation.resume(throwing: PythonBridgeError.inferenceError(error))
                        return
                    }
                    if let done = json["done"] as? Bool, done {
                        let text = json["text"] as? String ?? ""
                        guard !resumed.value else { return }
                        resumed.value = true
                        handle.readabilityHandler = nil
                        continuation.resume(returning: text)
                        return
                    }
                }
            }
        }
    }
}
// MARK: - PythonBridgeError
enum PythonBridgeError: Error, LocalizedError {
    case notStarted
    case startupTimeout
    case bridgeDied
    case socketError(String)
    case serializationFailed
    case inferenceError(String)
    var errorDescription: String? {
        switch self {
        case .notStarted:              return "PythonBridge not started — call start() first"
        case .startupTimeout:          return "Python bridge timed out waiting for 'ready' signal (180s)"
        case .bridgeDied:              return "Python bridge process died unexpectedly"
        case .socketError(let m):      return "Unix socket error: \(m)"
        case .serializationFailed:     return "Failed to serialize request to JSON"
        case .inferenceError(let m):   return "VLM inference error from Python: \(m)"
        }
    }
}

// MARK: - Helpers
/// Simple mutable buffer for newline parsing. Actor-isolated closures can mutate this safely.
private final class LineBuffer: @unchecked Sendable {
    var text: String = ""
}

private final class ResumeFlag: @unchecked Sendable {
    var value: Bool = false
}
