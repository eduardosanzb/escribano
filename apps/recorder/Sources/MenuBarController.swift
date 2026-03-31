import Cocoa
import ServiceManagement
import Darwin

// MARK: - MenuBarController
//
// Manages the NSStatusItem (menu bar icon) for the Escribano recorder app.
// Displays live stats (display count, frame counts, topic blocks, RAM) and
// provides controls for pause/resume, start at login, and quit.
//
// Stats are refreshed every 5 seconds using synchronous SQLite queries via
// the FrameStore and TopicBlockStore ports.
//
// Thread safety: Marked @MainActor — all UI mutations happen on the main thread.
// FrameStore is @unchecked Sendable and confined to MainActor for stat queries.

@MainActor
final class MenuBarController {

    // MARK: - Status

    enum Status {
        case setup
        case running
        case paused
        case permissionNeeded
        case error(String)
    }

    // MARK: - Private Properties

    private let statusItem: NSStatusItem
    private let menu: NSMenu
    private var statsTimer: Timer?
    private var currentStatus: Status = .setup

    // Display-only menu items (disabled, used as stat labels)
    private let statsDisplaysItem: NSMenuItem
    private let statsFramesItem: NSMenuItem
    private let statsTopicBlocksItem: NSMenuItem
    private let statsResourcesItem: NSMenuItem

    // Interactive menu items
    private let pauseResumeItem: NSMenuItem
    private let startAtLoginItem: NSMenuItem

    // CPU tracking state for delta-based percentage calculation
    private var prevCPUTime: UInt64 = 0
    private var prevTimestamp: Double = 0

    // MARK: - Public Closures

    /// Called when the user toggles pause/resume. `true` = pause, `false` = resume.
    var onPauseResume: ((Bool) -> Void)?

    /// Called when the user taps "Relaunch Escribano" (permission flow).
    var onRelaunch: (() -> Void)?

    // MARK: - Initialization

    init() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

        // Build display-only stat items (disabled, non-clickable)
        statsDisplaysItem = NSMenuItem(title: "Recording — —", action: nil, keyEquivalent: "")
        statsDisplaysItem.isEnabled = false

        statsFramesItem = NSMenuItem(title: "Frames: — captured · — pending", action: nil, keyEquivalent: "")
        statsFramesItem.isEnabled = false

        statsTopicBlocksItem = NSMenuItem(title: "Topic Blocks: —", action: nil, keyEquivalent: "")
        statsTopicBlocksItem.isEnabled = false

        statsResourcesItem = NSMenuItem(title: "RAM: — MB  CPU: —%", action: nil, keyEquivalent: "")
        statsResourcesItem.isEnabled = false

        // Build interactive items (target/action set after self is initialized)
        pauseResumeItem = NSMenuItem(title: "⏸  Pause Recording", action: nil, keyEquivalent: "")
        startAtLoginItem = NSMenuItem(title: "Start at Login", action: nil, keyEquivalent: "")
        let quitItem = NSMenuItem(title: "Quit Escribano", action: nil, keyEquivalent: "")

        menu = NSMenu()

        // Title row (disabled)
        let titleItem = NSMenuItem(title: "Escribano", action: nil, keyEquivalent: "")
        titleItem.isEnabled = false
        menu.addItem(titleItem)

        menu.addItem(NSMenuItem.separator())

        // Stats section
        menu.addItem(statsDisplaysItem)
        menu.addItem(statsFramesItem)
        menu.addItem(statsTopicBlocksItem)
        menu.addItem(statsResourcesItem)

        menu.addItem(NSMenuItem.separator())

        // Controls
        menu.addItem(pauseResumeItem)

        menu.addItem(NSMenuItem.separator())

        // Start at Login (checkbox)
        let loginEnabled = SMAppService.mainApp.status == .enabled
        startAtLoginItem.state = loginEnabled ? .on : .off
        menu.addItem(startAtLoginItem)

        menu.addItem(quitItem)

        // Assign menu to status item
        statusItem.menu = menu

        // Wire up actions after self is fully initialized
        pauseResumeItem.target = self
        pauseResumeItem.action = #selector(togglePauseResume)

        startAtLoginItem.target = self
        startAtLoginItem.action = #selector(toggleStartAtLogin)

        quitItem.target = self
        quitItem.action = #selector(quitApp)

        // Set initial button appearance
        setStatus(.setup)
    }

    // MARK: - Status

    /// Updates the menu bar icon and button title to reflect the current status.
    func setStatus(_ status: Status) {
        currentStatus = status

        guard let button = statusItem.button else { return }

        // Build an attributed string: colored dot + plain text
        let dot: NSMutableAttributedString
        let dotChar = "●"
        let label = " Escribano"

        switch status {
        case .setup:
            dot = coloredDot(dotChar, color: .systemYellow)
        case .running:
            dot = coloredDot(dotChar, color: .systemGreen)
        case .paused:
            dot = coloredDot(dotChar, color: .systemYellow)
        case .permissionNeeded:
            dot = coloredDot(dotChar, color: .systemRed)
            // Update stats area to show the permission warning
            statsDisplaysItem.title = "⚠️ Grant Screen Recording permission"
            // Add a "Relaunch" item after the stats display item if not already present
            if menu.item(withTitle: "Relaunch Escribano") == nil {
                let relaunchItem = NSMenuItem(title: "Relaunch Escribano", action: #selector(relaunchApp), keyEquivalent: "")
                relaunchItem.target = self
                if let idx = menu.items.firstIndex(of: statsDisplaysItem) {
                    menu.insertItem(relaunchItem, at: idx + 1)
                }
            }
        case .error:
            dot = coloredDot(dotChar, color: .systemRed)
        }

        // Combine dot + label as attributed string
        let labelAttr = NSAttributedString(
            string: label,
            attributes: [.foregroundColor: NSColor.labelColor]
        )
        dot.append(labelAttr)

        button.attributedTitle = dot
    }

    /// Updates the stats display area with a setup progress message.
    func setSetupProgress(_ message: String) {
        statsDisplaysItem.title = message
    }

    // MARK: - Stats Timer

    /// Starts a 5-second repeating timer that queries live stats from the stores.
    ///
    /// - Parameters:
    ///   - frameStore: The FrameStore port for querying frame counts.
    ///   - tbStore: The TopicBlockStore port for querying topic block count.
    ///   - displayCount: Number of displays being captured.
    ///   - bridgePID: Closure returning the current Python bridge PID (or -1 if not running).
    func startStatsTimer(
        frameStore: any FrameStore,
        tbStore: any TopicBlockStore,
        displayCount: Int,
        bridgePID: @escaping @Sendable () -> Int32
    ) {
        statsDisplaysItem.title = "Recording — \(displayCount) display(s)"

        statsTimer?.invalidate()
        statsTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.refreshStats(frameStore: frameStore, tbStore: tbStore, bridgePID: bridgePID)
            }
        }
        // Fire once immediately
        Task { @MainActor [weak self] in
            guard let self else { return }
            self.refreshStats(frameStore: frameStore, tbStore: tbStore, bridgePID: bridgePID)
        }
    }

    // MARK: - Private Stats Refresh

    private func refreshStats(
        frameStore: any FrameStore,
        tbStore: any TopicBlockStore,
        bridgePID: @escaping @Sendable () -> Int32
    ) {
        // Synchronous frame queries (FrameStore is @unchecked Sendable, confined to MainActor)
        let total = (try? frameStore.totalFrameCount()) ?? 0
        let pending = (try? frameStore.pendingFrameCount()) ?? 0
        statsFramesItem.title = "Frames: \(total) captured · \(pending) pending"

        // Self process RSS
        let selfBytes = selfProcessRSS()
        let selfMB = selfBytes / (1024 * 1024)

        // Bridge process RSS + CPU
        let pid = bridgePID()
        let (bridgeBytes, cpuPct) = bridgeProcessRSS(pid: pid)
        let bridgeMB = bridgeBytes / (1024 * 1024)
        let totalMB = selfMB + bridgeMB

        let cpuStr = cpuPct > 0 ? String(format: "%.1f", cpuPct) : "—"
        statsResourcesItem.title = "RAM: \(totalMB) MB (recorder \(selfMB) + bridge \(bridgeMB))  CPU: \(cpuStr)%"

        // Async topic block count query
        Task { @MainActor [weak self] in
            guard let self else { return }
            let tbCount = (try? await tbStore.count()) ?? 0
            self.statsTopicBlocksItem.title = "Topic Blocks: \(tbCount)"
        }
    }

    // MARK: - Private Resource Helpers

    /// Returns the resident set size (bytes) of this process using mach_task_basic_info.
    private func selfProcessRSS() -> UInt64 {
        var info = mach_task_basic_info()
        var count = mach_msg_type_number_t(
            MemoryLayout<mach_task_basic_info>.size / MemoryLayout<integer_t>.size
        )
        let result = withUnsafeMutablePointer(to: &info) { ptr in
            ptr.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { intPtr in
                task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), intPtr, &count)
            }
        }
        return result == KERN_SUCCESS ? info.resident_size : 0
    }

    /// Returns the resident set size (bytes) and approximate CPU% for a given PID.
    /// Uses proc_pidinfo(PROC_PIDTASKINFO) from libproc.
    ///
    /// CPU% is approximated via a delta of total user+sys time between 5s polling ticks.
    private func bridgeProcessRSS(pid: Int32) -> (rssBytes: UInt64, cpuPct: Double) {
        guard pid > 0 else { return (0, 0) }
        var info = proc_taskinfo()
        let size = Int32(MemoryLayout<proc_taskinfo>.size)
        let result = proc_pidinfo(pid, PROC_PIDTASKINFO, 0, &info, size)
        guard result > 0 else { return (0, 0) }
        let rss = info.pti_resident_size

        // Delta-based CPU% calculation between successive 5s timer ticks
        let now = Date().timeIntervalSince1970
        let elapsed = now - prevTimestamp
        let currentCPUTime = info.pti_total_user + info.pti_total_system
        var cpuPct = 0.0
        if prevTimestamp > 0 && elapsed > 0 && prevCPUTime > 0 {
            // pti_total_user/system are in Mach time units (nanoseconds on Apple Silicon)
            let deltaCPUNs = Double(currentCPUTime &- prevCPUTime)
            let elapsedNs = elapsed * 1_000_000_000.0
            cpuPct = (deltaCPUNs / elapsedNs) * 100.0
        }
        prevCPUTime = currentCPUTime
        prevTimestamp = now

        return (rss, cpuPct)
    }

    // MARK: - Private Helpers

    /// Builds an NSMutableAttributedString with the given color for the dot character.
    private func coloredDot(_ char: String, color: NSColor) -> NSMutableAttributedString {
        NSMutableAttributedString(
            string: char,
            attributes: [.foregroundColor: color]
        )
    }

    // MARK: - Actions

    @objc private func togglePauseResume() {
        switch currentStatus {
        case .running:
            onPauseResume?(true)
            pauseResumeItem.title = "▶  Resume Recording"
            setStatus(.paused)
        case .paused:
            onPauseResume?(false)
            pauseResumeItem.title = "⏸  Pause Recording"
            setStatus(.running)
        default:
            break
        }
    }

    @objc private func toggleStartAtLogin() {
        if SMAppService.mainApp.status == .enabled {
            try? SMAppService.mainApp.unregister()
            startAtLoginItem.state = .off
        } else {
            try? SMAppService.mainApp.register()
            startAtLoginItem.state = .on
        }
    }

    @objc private func quitApp() {
        NSApp.terminate(nil)
    }

    @objc private func relaunchApp() {
        onRelaunch?()
    }
}
