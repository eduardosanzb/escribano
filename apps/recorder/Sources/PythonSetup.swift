import Foundation

// MARK: - PythonSetup
//
// Caseless namespace enum for zero-config Python environment bootstrapping.
//
// Responsibilities:
//   1. Detect whether ~/.escribano/venv already has the required packages (fast path).
//   2. If not, create the venv with system python3 and install the required packages.
//   3. Verify installation by importing the packages.
//   4. Report progress via a callback so callers (e.g. menu bar) can show status.
//
// Required packages (from src/python-deps.ts PYTHON_PACKAGES.vlm):
//   mlx-vlm[torch]>=0.4.0  — Vision-language model
//   mlx>=0.14.0             — MLX inference framework
//   mlx-lm>=0.9.0           — LLM support in MLX
//
enum PythonSetup {
    // MARK: - Package list

    private static let requiredPackages = [
        "mlx-vlm[torch]>=0.4.0",
        "mlx>=0.14.0",
        "mlx-lm>=0.9.0",
    ]

    // MARK: - Public API

    /// Ensure that ~/.escribano/venv exists and has the required ML packages.
    ///
    /// Fast path: if `~/.escribano/venv/bin/python3` exists and `import mlx_vlm; import mlx_lm; import mlx`
    /// succeeds, returns immediately.
    ///
    /// Slow path: creates the venv with a system python3 and installs all required packages.
    ///
    /// - Parameter progress: Called with a human-readable status string at each major step.
    /// - Returns: Absolute path to the python3 executable inside the managed venv.
    /// - Throws: `PythonSetupError` on any failure.
    static func ensureVenv(progress: @escaping @Sendable (String) -> Void) async throws -> String {
        let home = ProcessInfo.processInfo.environment["HOME"] ?? "/tmp"
        let venvPath = home + "/.escribano/venv"
        let pythonPath = venvPath + "/bin/python3"

        // Fast path: already installed?
        if FileManager.default.fileExists(atPath: pythonPath) {
            log("[PythonSetup] Venv found at \(venvPath) — checking packages...")
            if await packagesImportable(pythonPath: pythonPath) {
                log("[PythonSetup] All packages importable — venv ready.")
                return pythonPath
            }
            log("[PythonSetup] Packages missing — will install.")
        }

        // Slow path: create venv if needed
        if !FileManager.default.fileExists(atPath: pythonPath) {
            progress("Creating Python environment...")
            log("[PythonSetup] Creating venv at \(venvPath)...")

            guard let systemPython = findSystemPython() else {
                log("[PythonSetup] ERROR: No system python3 found.")
                throw PythonSetupError.pythonNotFound
            }

            log("[PythonSetup] Using system python: \(systemPython)")
            let (exitCode, _, stderr) = try await runProcess(
                executable: systemPython,
                arguments: ["-m", "venv", venvPath],
                timeout: 60
            )
            if exitCode != 0 {
                log("[PythonSetup] ERROR: venv creation failed (exit \(exitCode)): \(stderr)")
                throw PythonSetupError.venvCreationFailed(stderr)
            }
            log("[PythonSetup] Venv created successfully.")
        }

        // Install packages
        progress("Installing ML packages (first run — may take several minutes)...")
        log("[PythonSetup] Installing packages: \(requiredPackages.joined(separator: ", "))")

        let pip3Path = venvPath + "/bin/pip3"
        let (pipExit, _, pipStderr) = try await runProcess(
            executable: pip3Path,
            arguments: ["install"] + requiredPackages,
            timeout: 300
        )
        if pipExit != 0 {
            log("[PythonSetup] ERROR: pip install failed (exit \(pipExit)): \(pipStderr)")
            throw PythonSetupError.installFailed(pipStderr)
        }
        log("[PythonSetup] Packages installed successfully.")

        // Verify
        log("[PythonSetup] Verifying installation...")
        if !(await packagesImportable(pythonPath: pythonPath)) {
            log("[PythonSetup] ERROR: verification failed — packages not importable after install.")
            throw PythonSetupError.verificationFailed
        }

        log("[PythonSetup] Venv ready at \(pythonPath).")
        return pythonPath
    }

    // MARK: - Private Helpers

    /// Returns true when `import mlx_vlm; import mlx_lm; import mlx` exits 0.
    private static func packagesImportable(pythonPath: String) async -> Bool {
        do {
            let (exitCode, _, _) = try await runProcess(
                executable: pythonPath,
                arguments: ["-c", "import mlx_vlm; import mlx_lm; import mlx"],
                timeout: 10
            )
            return exitCode == 0
        } catch {
            return false
        }
    }

    /// Find the first system python3 in the standard installation candidates.
    ///
    /// Resolution order mirrors PythonBridge.vlm.adapter.swift lines 80-87.
    private static func findSystemPython() -> String? {
        let candidates = [
            "/opt/homebrew/bin/python3",
            "/usr/local/bin/python3",
            "/usr/bin/python3",
        ]
        return candidates.first {
            FileManager.default.fileExists(atPath: $0)
        }
    }

    /// Run a child process and collect its output, with a timeout.
    ///
    /// - Parameters:
    ///   - executable: Absolute path to the binary.
    ///   - arguments: Arguments to pass.
    ///   - timeout: Maximum seconds to wait before terminating the process.
    /// - Returns: Exit code, stdout text, and stderr text.
    private static func runProcess(
        executable: String,
        arguments: [String],
        timeout: TimeInterval
    ) async throws -> (exitCode: Int32, stdout: String, stderr: String) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments

        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        try process.run()

        // Timeout: poll isRunning until deadline, then terminate.
        let deadline = Date(timeIntervalSinceNow: timeout)
        while process.isRunning {
            if Date() > deadline {
                process.terminate()
                log("[PythonSetup] Process timed out after \(Int(timeout))s: \(executable)")
                break
            }
            try await Task.sleep(nanoseconds: 100_000_000) // 100ms
        }

        process.waitUntilExit()

        let stdoutData = stdoutPipe.fileHandleForReading.readDataToEndOfFile()
        let stderrData = stderrPipe.fileHandleForReading.readDataToEndOfFile()
        let stdoutStr = String(data: stdoutData, encoding: .utf8) ?? ""
        let stderrStr = String(data: stderrData, encoding: .utf8) ?? ""

        return (process.terminationStatus, stdoutStr, stderrStr)
    }
}

// MARK: - PythonSetupError

enum PythonSetupError: Error, LocalizedError {
    case pythonNotFound
    case venvCreationFailed(String)
    case installFailed(String)
    case verificationFailed

    var errorDescription: String? {
        switch self {
        case .pythonNotFound:
            return "No system python3 found. Install Python 3 via Homebrew or the python.org installer."
        case let .venvCreationFailed(details):
            return "Failed to create Python virtual environment: \(details)"
        case let .installFailed(details):
            return "Failed to install ML packages: \(details)"
        case .verificationFailed:
            return "Package installation verification failed — packages not importable after install."
        }
    }
}
