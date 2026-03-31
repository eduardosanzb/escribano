import Dispatch
import Foundation
import os

// MARK: - PythonBridgeVLMAdapter

///
/// Adapter that implements InferenceWorker by spawning mlx_bridge.py as a
/// child process and communicating over a Unix domain socket.
///
/// --- Unix domain socket vs. TCP ---
/// A Unix domain socket is a file on disk (e.g. /tmp/foo.sock) that two processes
/// on the same machine can connect to, like a very fast local pipe. We use one
/// because it's faster than TCP and doesn't need a port number.
///
/// --- NDJSON (Newline-Delimited JSON) ---
/// Both sides send one JSON object per line, terminated by "\n".
/// The receiver reads until it finds a "\n", then parses that line as JSON.
/// This is the simplest framing protocol for a stream socket.
///
/// --- Process lifecycle ---
/// 1. start() spawns Python, waits for {"status":"ready"} on stdout, then
///    connects the Unix socket.
/// 2. analyzeFrames() sends one vlm_infer request and waits for {"done":true}.
/// 3. stop() sends SIGTERM to the Python process, disconnects the socket.
///
/// Why "actor"?
///   An actor in Swift serializes access to its mutable state — only one task
///   can run inside the actor at a time. This prevents two concurrent analyzeFrames()
///   calls from racing on the socket write/read state.
actor PythonBridgeVLMAdapter: InferenceWorker {
    // MARK: - Configuration

    private let socketPath: String // e.g. /tmp/escribano-recorder-vlm.sock
    private let bridgePath: String // absolute path to mlx_bridge.py
    private let pythonPath: String // python3 executable to use
    private let modelId: String // e.g. mlx-community/Qwen3.5-2B-6bit (RAM-aware default)
    private let maxTokens: Int // token budget per batch
    private let inferenceTimeout: TimeInterval

    // MARK: - Mutable state (protected by actor isolation)

    private var process: Process?
    private var fileHandle: FileHandle?
    private var requestId: Int = 0
    private var _isReady: Bool = false
    /// PID stored behind a lock so terminateSync() can read it safely from any thread.
    private let pidLock = OSAllocatedUnfairLock(initialState: Int32(0))

    var isReady: Bool {
        _isReady
    }

    // MARK: - Init

    /// Select the default VLM model based on system RAM.
    /// Qwen3.5 is multimodal — handles both frame analysis and text generation.
    private static func defaultVLMModel() -> String {
        let ramGB = ProcessInfo.processInfo.physicalMemory / (1024 * 1024 * 1024)
        if ramGB >= 32 {
            return "mlx-community/Qwen3.5-2B-6bit"
        }
        return "mlx-community/Qwen3.5-0.8B-8bit"
    }

    init() {
        socketPath = ProcessInfo.processInfo.environment["ESCRIBANO_MLX_RECORDER_SOCKET"]
            ?? "/tmp/escribano-recorder-vlm.sock"
        if let override = ProcessInfo.processInfo.environment["ESCRIBANO_BRIDGE_PATH"] {
            bridgePath = override
        } else if let bundled = Bundle.main.resourceURL?.appendingPathComponent("mlx_bridge.py").path,
                  FileManager.default.fileExists(atPath: bundled) {
            bridgePath = bundled
        } else {
            bridgePath = (ProcessInfo.processInfo.environment["HOME"] ?? "/tmp")
                + "/.escribano/scripts/mlx_bridge.py"
        }
        let home = ProcessInfo.processInfo.environment["HOME"] ?? "/tmp"
        let managedVenv = home + "/.escribano/venv/bin/python3"
        if let explicit = ProcessInfo.processInfo.environment["ESCRIBANO_PYTHON_PATH"] {
            pythonPath = explicit
        } else if FileManager.default.fileExists(atPath: managedVenv) {
            pythonPath = managedVenv
        } else {
            let candidates = [
                "/opt/homebrew/bin/python3",
                "/usr/local/bin/python3",
                "/usr/bin/python3",
            ]
            pythonPath = candidates.first {
                FileManager.default.fileExists(atPath: $0)
            } ?? "/usr/bin/python3"
        }
        modelId = ProcessInfo.processInfo.environment["ESCRIBANO_VLM_MODEL"]
            ?? Self.defaultVLMModel()
        maxTokens = Int(ProcessInfo.processInfo.environment["ESCRIBANO_VLM_MAX_TOKENS"] ?? "") ?? 2000
        if let timeoutString = ProcessInfo.processInfo.environment["ESCRIBANO_VLM_TIMEOUT"],
           let parsed = Double(timeoutString)
        {
            inferenceTimeout = parsed
        } else {
            inferenceTimeout = 180.0
        }
    }

    func start() async throws {
        guard !_isReady else { return }
        do {
            log("[PythonBridge] Starting mlx_bridge.py (VLM mode)...")
            log("[PythonBridge] Python: \(pythonPath)")
            log("[PythonBridge] Bridge: \(bridgePath)")
            log("[PythonBridge] Model: \(modelId)")
            log("[PythonBridge] Max tokens: \(maxTokens)")
            if FileManager.default.fileExists(atPath: socketPath) {
                try? FileManager.default.removeItem(atPath: socketPath)
            }
            let proc = Process()
            proc.executableURL = URL(fileURLWithPath: pythonPath)
            proc.arguments = [bridgePath, "--mode", "vlm"]
            proc.environment = buildEnv()
            let stdoutPipe = Pipe()
            proc.standardOutput = stdoutPipe
            let logDir = FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent(".escribano/logs")
            try? FileManager.default.createDirectory(at: logDir, withIntermediateDirectories: true)
            let logURL = logDir.appendingPathComponent("mlx-bridge-recorder-vlm.log")
            let stdoutLogURL = logDir.appendingPathComponent("mlx-bridge-recorder-vlm-stdout.log")
            try? FileManager.default.removeItem(at: logURL)
            try? FileManager.default.removeItem(at: stdoutLogURL)
            FileManager.default.createFile(atPath: logURL.path, contents: nil)
            FileManager.default.createFile(atPath: stdoutLogURL.path, contents: nil)
            let stderrLogHandle = try? FileHandle(forWritingTo: logURL)
            let stdoutLogHandle = try? FileHandle(forWritingTo: stdoutLogURL)
            let stderrPipe = Pipe()
            proc.standardError = stderrPipe
            stderrPipe.fileHandleForReading.readabilityHandler = { handle in
                let data = handle.availableData
                guard !data.isEmpty else { return }
                FileHandle.standardError.write(data)
                stderrLogHandle?.write(data)
            }
            try proc.run()
            process = proc
            pidLock.withLock { $0 = proc.processIdentifier }
            log("[PythonBridge] Python PID: \(proc.processIdentifier)")
            try await waitForReady(stdout: stdoutPipe, logHandle: stdoutLogHandle)
            try connectSocket()
            _isReady = true
            log("[PythonBridge] Ready. Socket connected at \(socketPath)")
        } catch {
            _isReady = false
            // Clean up partially-started process to prevent orphaning
            fileHandle?.closeFile()
            fileHandle = nil
            if let proc = process {
                proc.terminate()
                // Don't waitUntilExit here — we're already in an error path
            }
            process = nil
            pidLock.withLock { $0 = 0 }
            try? FileManager.default.removeItem(atPath: socketPath)
            throw error
        }
    }

    func analyzeFrames(frames: [DbFrame]) async throws -> [FrameDescription] {
        guard _isReady else { throw PythonBridgeError.notStarted }
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
            "id": id,
            "method": "vlm_infer",
            "params": [
                "messages": [["role": "user", "content": content]],
                "maxTokens": maxTokens,
            ] as [String: Any],
        ]
        let rawText: String
        let rawStats: VLMStats?
        do {
            (rawText, rawStats) = try await sendAndReceive(request: request)
        } catch PythonBridgeError.bridgeDied {
            _isReady = false
            throw PythonBridgeError.bridgeDied
        }
        let stats = rawStats.map { s in
            VLMStats(model: s.model, promptTokens: s.promptTokens, generationTokens: s.generationTokens,
                     promptTps: s.promptTps, generationTps: s.generationTps, inferenceMs: s.inferenceMs,
                     peakMemoryGb: s.peakMemoryGb, batchSize: frames.count)
        }
        let parsed = ResponseParser.parseInterleavedOutput(rawText)
        let descriptions = parsed.map { d in
            FrameDescription(description: d.description, activity: d.activity,
                             apps: d.apps, topics: d.topics, vlmStats: stats)
        }
        log("[PythonBridge] Parsed \(descriptions.count)/\(frames.count) frame descriptions")
        return descriptions
    }

    func generateText(prompt: String, maxTokens: Int = 2000) async throws -> String {
        guard _isReady else { throw PythonBridgeError.notStarted }
        requestId += 1
        let id = requestId

        let request: [String: Any] = [
            "id": id,
            "method": "text_infer",
            "params": [
                "messages": [["role": "user", "content": prompt]],
                "maxTokens": maxTokens,
            ] as [String: Any],
        ]

        let rawText: String
        do {
            (rawText, _) = try await sendAndReceive(request: request)
        } catch PythonBridgeError.bridgeDied {
            _isReady = false
            throw PythonBridgeError.bridgeDied
        }
        return rawText
    }

    func stop() async {
        log("[PythonBridge] Shutting down...")
        _isReady = false
        fileHandle?.closeFile()
        fileHandle = nil
        if let proc = process {
            proc.terminate()
            let pid = proc.processIdentifier
            // Time-bounded wait: 5s for graceful exit, then SIGKILL.
            // Unbounded waitUntilExit() would deadlock the actor if Python ignores SIGTERM.
            let exited = await withCheckedContinuation { (cont: CheckedContinuation<Bool, Never>) in
                let flag = ResumeFlag()
                let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global())
                timer.schedule(deadline: .now() + 5)
                timer.setEventHandler {
                    guard flag.trySet() else { return }
                    timer.cancel()
                    cont.resume(returning: false)
                }
                timer.resume()
                DispatchQueue.global().async {
                    proc.waitUntilExit()
                    guard flag.trySet() else { return }
                    timer.cancel()
                    cont.resume(returning: true)
                }
            }
            if !exited {
                log("[PythonBridge] Process did not exit after 5s SIGTERM — sending SIGKILL")
                kill(pid, SIGKILL)
            }
        }
        process = nil
        pidLock.withLock { $0 = 0 }
        try? FileManager.default.removeItem(atPath: socketPath)
    }

    /// Synchronous bridge kill for use in applicationWillTerminate where async is not available.
    /// Sends SIGTERM directly to the stored PID — reliable regardless of socket path or env vars.
    nonisolated func terminateSync() {
        let pid = pidLock.withLock { $0 }
        guard pid > 0 else { return }
        kill(pid, SIGTERM)
        log("[PythonBridge] terminateSync: sent SIGTERM to PID \(pid)")
    }

    func ping() async throws -> Bool {
        guard _isReady else { return false }
        requestId += 1
        let request: [String: Any] = [
            "id": requestId,
            "method": "ping",
        ]
        let (_, _) = try await sendAndReceive(request: request)
        return true
    }

    private func buildEnv() -> [String: String] {
        var env = ProcessInfo.processInfo.environment
        env["ESCRIBANO_VLM_MODEL"] = modelId
        env["ESCRIBANO_VLM_MAX_TOKENS"] = String(maxTokens)
        env["ESCRIBANO_MLX_SOCKET_PATH"] = socketPath.replacingOccurrences(
            of: "-vlm.sock", with: ".sock"
        )
        let home = ProcessInfo.processInfo.environment["HOME"] ?? "/tmp"
        env["ESCRIBANO_MLX_LOG_FILE"] = home + "/.escribano/logs/mlx-bridge-recorder-vlm.log"
        return env
    }

    private func waitForReady(stdout: Pipe, logHandle: FileHandle?) async throws {
        log("[PythonBridge] Waiting for model load (may take 30-120s on first run)...")
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            let buffer = LineBuffer()
            let resumed = ResumeFlag()
            // Arm an independent timer BEFORE reading stdout so the 180s timeout fires
            // unconditionally — even if the Python process hangs silently and produces
            // no output (the old Date-check-inside-readabilityHandler never fired then).
            let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global())
            timer.schedule(deadline: .now() + 180)
            timer.setEventHandler {
                guard resumed.trySet() else { return }
                stdout.fileHandleForReading.readabilityHandler = nil
                timer.cancel()
                log("[PythonBridge] Startup timed out after 180s waiting for 'ready' signal")
                continuation.resume(throwing: PythonBridgeError.startupTimeout)
            }
            timer.resume()
            stdout.fileHandleForReading.readabilityHandler = { handle in
                let data = handle.availableData
                guard !data.isEmpty else { return }
                logHandle?.write(data)
                buffer.text += String(data: data, encoding: .utf8) ?? ""
                while let newlineRange = buffer.text.range(of: "\n") {
                    let line = String(buffer.text[..<newlineRange.lowerBound])
                        .trimmingCharacters(in: .whitespaces)
                    buffer.text.removeSubrange(..<newlineRange.upperBound)
                    guard !line.isEmpty else { continue }
                    if let data = line.data(using: .utf8),
                       let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                       let status = json["status"] as? String,
                       status == "ready"
                    {
                        guard resumed.trySet() else { return }
                        timer.cancel()
                        continuation.resume(returning: ())
                    }
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
        for attempt in 1 ... 5 {
            let result = withUnsafePointer(to: &addr) { ptr in
                ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                    Darwin.connect(fd, sockPtr, socklen_t(MemoryLayout<sockaddr_un>.size))
                }
            }
            if result == 0 {
                connected = true
                break
            }
            log("[PythonBridge] Socket connect attempt \(attempt)/5 failed (errno=\(errno)), retrying...")
            Thread.sleep(forTimeInterval: 0.5)
        }
        guard connected else {
            close(fd)
            throw PythonBridgeError.socketError("connect() failed after 5 attempts")
        }
        fileHandle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        log("[PythonBridge] Socket connected (fd=\(fd))")
    }

    private func sendAndReceive(request: [String: Any]) async throws -> (String, VLMStats?) {
        guard let fh = fileHandle else {
            throw PythonBridgeError.notStarted
        }
        let jsonData = try JSONSerialization.data(withJSONObject: request)
        guard var line = String(data: jsonData, encoding: .utf8) else {
            throw PythonBridgeError.serializationFailed
        }
        line += "\n"
        fh.write(line.data(using: .utf8)!)

        // Capture actor-isolated properties BEFORE entering withCheckedThrowingContinuation.
        // The GCD callbacks (timer + readabilityHandler) run on non-actor threads.
        // Accessing self.inferenceTimeout or self.modelId from those closures would
        // violate Swift 6 actor isolation and crash with:
        //   "Incorrect actor executor assumption; expected 'PythonBridgeVLMAdapter' executor"
        let timeout = self.inferenceTimeout
        let model = self.modelId

        return try await withCheckedThrowingContinuation { continuation in
            let buffer = LineBuffer()
            let resumed = ResumeFlag()
            let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global())
            timer.schedule(deadline: .now() + timeout)
            timer.setEventHandler { [weak fh] in
                guard let handle = fh, resumed.trySet() else { return }
                handle.readabilityHandler = nil
                log("[PythonBridge] Inference timed out after \(Int(timeout))s")
                timer.cancel()
                continuation.resume(throwing: PythonBridgeError.inferenceTimeout(timeout))
            }
            timer.resume()
            fh.readabilityHandler = { handle in
                let data = handle.availableData
                if data.isEmpty {
                    guard resumed.trySet() else { return }
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
                        guard resumed.trySet() else { return }
                        handle.readabilityHandler = nil
                        timer.cancel()
                        continuation.resume(throwing: PythonBridgeError.inferenceError(error))
                        return
                    }
                    if let done = json["done"] as? Bool, done {
                        let text = json["text"] as? String ?? ""
                        var stats: VLMStats? = nil
                        if let s = json["stats"] as? [String: Any] {
                            stats = VLMStats(
                                model:            model,
                                promptTokens:     s["prompt_tokens"]     as? Int    ?? 0,
                                generationTokens: s["generation_tokens"] as? Int    ?? 0,
                                promptTps:        s["prompt_tps"]        as? Double ?? 0,
                                generationTps:    s["generation_tps"]    as? Double ?? 0,
                                inferenceMs:      Int((s["generate_time_s"] as? Double ?? 0) * 1000),
                                peakMemoryGb:     s["peak_memory_gb"]    as? Double ?? 0,
                                batchSize:        0  // filled in by caller once frame count is known
                            )
                        }
                        guard resumed.trySet() else { return }
                        handle.readabilityHandler = nil
                        timer.cancel()
                        continuation.resume(returning: (text, stats))
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
    case inferenceTimeout(TimeInterval)
    var errorDescription: String? {
        switch self {
        case .notStarted: return "PythonBridge not started — call start() first"
        case .startupTimeout: return "Python bridge timed out waiting for 'ready' signal (180s)"
        case .bridgeDied: return "Python bridge process died unexpectedly"
        case let .socketError(m): return "Unix socket error: \(m)"
        case .serializationFailed: return "Failed to serialize request to JSON"
        case let .inferenceError(m): return "VLM inference error from Python: \(m)"
        case let .inferenceTimeout(t): return "VLM inference timed out after \(Int(t))s"
        }
    }
}

// MARK: - Helpers

/// Simple mutable buffer for newline parsing. Actor-isolated closures can mutate this safely.
private final class LineBuffer: @unchecked Sendable {
    var text: String = ""
}

/// Thread-safe one-shot flag used to ensure a continuation is resumed exactly once.
///
/// Both the DispatchSourceTimer and the FileHandle.readabilityHandler run on different
/// dispatch queues and race to resume the same continuation. NSLock makes the
/// false→true transition atomic so only one caller wins, preventing the fatal
/// "Cannot resume a continuation twice" crash.
private final class ResumeFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var _value: Bool = false

    var isSet: Bool {
        lock.lock()
        defer { lock.unlock() }
        return _value
    }

    /// Atomically transitions false → true. Returns true only for the first caller;
    /// subsequent callers get false and must not resume the continuation.
    func trySet() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard !_value else { return false }
        _value = true
        return true
    }
}
