import Foundation
import Cocoa

/// Observes macOS screen lock/unlock notifications and forwards them via closures.
///
/// macOS publishes `com.apple.screenIsLocked` and `com.apple.screenIsUnlocked`
/// via `DistributedNotificationCenter`. This observer subscribes to both and
/// calls the `onLock`/`onUnlock` closures when they fire.
///
/// Architecture note: Fully standalone — no dependencies on other recorder types.
/// Follows the same closure-callback pattern as `Backpressure` (`onPause`/`onResume`).
///
/// Threading: The class is `@MainActor`, but `DistributedNotificationCenter`
/// delivers on arbitrary threads. The `@objc nonisolated` handler methods bounce
/// back to the MainActor via `Task { @MainActor in }`, matching the pattern used
/// in `StreamBridge` (StreamCapture.swift).
@MainActor final class ScreenLockObserver: NSObject {

    var onLock:   (() -> Void)?
    var onUnlock: (() -> Void)?

    override init() {
        super.init()
        let center = DistributedNotificationCenter.default()
        center.addObserver(
            self,
            selector: #selector(handleLock(_:)),
            name: NSNotification.Name("com.apple.screenIsLocked"),
            object: nil
        )
        center.addObserver(
            self,
            selector: #selector(handleUnlock(_:)),
            name: NSNotification.Name("com.apple.screenIsUnlocked"),
            object: nil
        )
        print("[ScreenLock] Observer registered")
    }

    deinit {
        DistributedNotificationCenter.default().removeObserver(self)
    }

    @objc nonisolated private func handleLock(_ notification: Notification) {
        print("[ScreenLock] Screen locked — pausing capture")
        Task { @MainActor [weak self] in
            self?.onLock?()
        }
    }

    @objc nonisolated private func handleUnlock(_ notification: Notification) {
        print("[ScreenLock] Screen unlocked — resuming capture")
        Task { @MainActor [weak self] in
            self?.onUnlock?()
        }
    }
}
