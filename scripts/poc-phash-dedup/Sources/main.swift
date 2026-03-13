import Cocoa
@preconcurrency import ScreenCaptureKit

// ── Scenario definitions ────────────────────────────────────────────────────

struct Scenario {
    let name:        String    // used in CSV + file names (no spaces)
    let label:       String    // human-readable title
    let instruction: String    // shown to user; use \n for line breaks
    let durationS:   Int
}

let scenarios: [Scenario] = [
    Scenario(
        name: "CLOCK_TICK",
        label: "CLOCK_TICK — Menu bar clock with seconds",
        instruction: "Keep the menu bar visible with seconds showing.\n  Do nothing. Let the clock tick.",
        durationS: 15
    ),
    Scenario(
        name: "CURSOR_BLINK",
        label: "CURSOR_BLINK — Cursor in text editor",
        instruction: "Click into a text editor (VS Code, TextEdit, Terminal).\n  Do NOT type. Watch the cursor blink.",
        durationS: 15
    ),
    Scenario(
        name: "MOUSE_MOVE",
        label: "MOUSE_MOVE — Mouse movement only",
        instruction: "Move your mouse slowly around the screen.\n  Do NOT type or click anything.",
        durationS: 10
    ),
    Scenario(
        name: "TYPING",
        label: "TYPING — Keyboard input",
        instruction: "Type freely in your text editor. Anything you like.",
        durationS: 15
    ),
    Scenario(
        name: "WINDOW_SWITCH",
        label: "WINDOW_SWITCH — App switching",
        instruction: "Switch between 3+ apps using Cmd+Tab.\n  Pause 2–3 seconds on each app.",
        durationS: 15
    ),
    Scenario(
        name: "IDLE",
        label: "IDLE — Baseline noise (last)",
        instruction: "Hide all windows now (Cmd+Option+H+M or show Desktop).\n  Leave your machine completely idle.\n  Come back in 30 seconds.",
        durationS: 30
    ),
]

// ── ScenarioRunner ──────────────────────────────────────────────────────────

@MainActor
final class ScenarioRunner {
    private let capture:  FrameCapture
    private let logger:   CSVLogger
    private var allResults: [FrameResult] = []

    init(capture: FrameCapture, logger: CSVLogger) {
        self.capture = capture
        self.logger  = logger
        capture.onFrame = { [weak self] result in
            self?.handleFrame(result)
        }
    }

    func run() async {
        let totalSecs = scenarios.map(\.durationS).reduce(0, +) + scenarios.count * 3
        print("══════════════════════════════════════════════════")
        print("  pHash Dedup POC")
        print("  6 scenarios  |  ~\(totalSecs)s total")
        print("  CSV:    \(logger.csvPath)")
        print("  Frames: /tmp/poc-dedup-frames/")
        print("══════════════════════════════════════════════════")

        for (i, scenario) in scenarios.enumerated() {
            await runScenario(scenario, index: i + 1, total: scenarios.count)
        }

        printSummary()
        logger.close()

        print("\n══════════════════════════════════════════════════")
        print("  POC COMPLETE")
        print("  CSV:    \(logger.csvPath)")
        print("  Frames: /tmp/poc-dedup-frames/")
        print("══════════════════════════════════════════════════\n")

        NSApplication.shared.terminate(nil)
    }

    // ── Single scenario ─────────────────────────────────────────────────────

    private func runScenario(_ s: Scenario, index: Int, total: Int) async {
        print("\n──────────────────────────────────────────────────")
        print("  Scenario \(index)/\(total) — \(s.label)")
        print("──────────────────────────────────────────────────")
        for line in s.instruction.components(separatedBy: "\n") {
            print("  \(line)")
        }
        print("")

        for i in stride(from: 3, through: 1, by: -1) {
            print("  Starting in \(i)s...   ", terminator: "\r")
            flushStdout()
            try? await Task.sleep(nanoseconds: 1_000_000_000)
        }
        print("  GO!                                          ")

        capture.startScenario(s.name)

        try? await Task.sleep(nanoseconds: UInt64(s.durationS) * 1_000_000_000)

        print("  Scenario complete.                           ")
    }

    // ── Frame callback ──────────────────────────────────────────────────────

    private func handleFrame(_ r: FrameResult) {
        allResults.append(r)
        logger.log(r)
    }

    // ── End summary ─────────────────────────────────────────────────────────

    private func printSummary() {
        print("\n\n══════════════════════════════════════════════════")
        print("  SUMMARY")
        print("══════════════════════════════════════════════════")

        let byScenario = Dictionary(grouping: allResults, by: { $0.scenario })

        for s in scenarios {
            let frames    = byScenario[s.name] ?? []
            let complete  = frames.filter { $0.scStatus == "complete" }
            let idle      = frames.filter { $0.scStatus == "idle" }
            let idlePct   = frames.isEmpty ? 0 : idle.count * 100 / frames.count

            print("\n  [\(s.name)]")
            print("    frames=\(frames.count)  idle=\(idle.count) (\(idlePct)%)  complete=\(complete.count)")

            func stats(_ vals: [Int]) -> String {
                guard !vals.isEmpty else { return "n/a" }
                let avg = Double(vals.reduce(0, +)) / Double(vals.count)
                return "min=\(vals.min()!) max=\(vals.max()!) avg=\(String(format: "%.1f", avg))"
            }

            func statsF(_ vals: [Float]) -> String {
                guard !vals.isEmpty else { return "n/a" }
                let avg = vals.reduce(0, +) / Float(vals.count)
                return String(format: "min=%.4f max=%.4f avg=%.4f", vals.min()!, vals.max()!, avg)
            }

            print("    pHash hamming: \(stats(complete.compactMap { $0.pHashHamming }))")
            print("    dHash hamming: \(stats(complete.compactMap { $0.dHashHamming }))")
            print("    VN distance:   \(statsF(complete.compactMap { $0.vnDistance }))")

            let vnLat = complete.compactMap { $0.vnLatencyMs }
            if !vnLat.isEmpty {
                print("    VN latency:    avg=\(String(format: "%.1f", vnLat.reduce(0,+)/Double(vnLat.count)))ms  (ANE if <5ms, CPU if >15ms)")
            }
        }
    }

    private func flushStdout() {
        fflush(stdout)
    }
}

// ── AppDelegate ─────────────────────────────────────────────────────────────

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var capture: FrameCapture?
    private var runner:  ScenarioRunner?
    private var logger:  CSVLogger?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let framesDir = URL(fileURLWithPath: "/tmp/poc-dedup-frames")
        try? FileManager.default.createDirectory(at: framesDir, withIntermediateDirectories: true)

        let csvLogger = CSVLogger()
        csvLogger.setup()
        self.logger = csvLogger

        Task {
            do {
                let content = try await SCShareableContent.current
                guard let display = content.displays.first else {
                    print("[AppDelegate] No displays found.")
                    NSApplication.shared.terminate(nil)
                    return
                }

                let fc = FrameCapture(
                    displayID:   display.displayID,
                    displaySize: (width: display.width, height: display.height),
                    framesDir:   framesDir
                )
                self.capture = fc
                try await fc.start()

                let sr = ScenarioRunner(capture: fc, logger: csvLogger)
                self.runner = sr
                await sr.run()

                await fc.stop()
            } catch {
                print("[AppDelegate] Fatal: \(error.localizedDescription)")
                NSApplication.shared.terminate(nil)
            }
        }
    }
}

// ── Entry point ──────────────────────────────────────────────────────────────

let app      = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
