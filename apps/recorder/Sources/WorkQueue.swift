import Foundation

/// Inference queue that owns worker lifecycle and serializes all inference calls.
///
/// Replaces WorkQueue by adding:
///   - Worker health checking (ping before each job)
///   - Automatic restart with exponential backoff on worker death
///   - Circuit breaker (stops after maxRestartAttempts consecutive failures)
///
/// Scheduling/fairness is preserved from the original WorkQueue:
///   - One job runs at a time (matches physical constraint: one bridge process)
///   - Priority ordering: .realtime > .normal > .low
///   - Fairness: after maxRealtimeStreak consecutive realtime jobs, one non-realtime
///     job is allowed through before realtime resumes
actor InferenceQueue {

    // MARK: - Priority

    enum Priority: Int, Comparable, Sendable {
        case realtime = 0   // FrameAnalyzer VLM inference
        case normal   = 1   // SessionAggregator text generation
        case low      = 2   // Future: embeddings, cleanup, etc.

        static func < (lhs: Self, rhs: Self) -> Bool {
            lhs.rawValue < rhs.rawValue
        }
    }

    // MARK: - Internal Types

    private struct Entry {
        let priority: Priority
        let sequence: UInt64
        let work: @Sendable () async -> Void
        let cancel: @Sendable () -> Void
        let fail: @Sendable (Error) -> Void
    }

    // MARK: - State

    private var queue: [Entry] = []
    private var nextSequence: UInt64 = 0
    private var isProcessing = false
    private var realtimeStreak = 0
    private var lastLoggedBucket: Int = -1
    private let maxRealtimeStreak: Int

    // MARK: - Worker Management

    private let workers: [any InferenceWorker]
    private var workerFailureCount: Int = 0
    private let maxRestartAttempts: Int
    private var circuitOpen: Bool = false
    private let restartDelays: [Double] = [5, 10, 20, 40, 60]

    // MARK: - Init

    init(workers: [any InferenceWorker], maxRealtimeStreak: Int = 10, maxRestartAttempts: Int = 5) {
        self.workers = workers
        self.maxRealtimeStreak = maxRealtimeStreak
        self.maxRestartAttempts = maxRestartAttempts
    }

    // MARK: - Worker Lifecycle

    /// Start all workers. Called once at startup from main.swift.
    func startWorkers() async throws {
        for worker in workers {
            try await worker.start()
        }
        log("[InferenceQueue] All workers started (\(workers.count))")
    }

    /// Stop all workers gracefully. Called during shutdown.
    func stopWorkers() async {
        for worker in workers {
            await worker.stop()
        }
        log("[InferenceQueue] All workers stopped")
    }

    /// Synchronously terminate all worker processes.
    /// For use in applicationWillTerminate where async context is unavailable.
    nonisolated func terminateWorkersSync() {
        for worker in workers {
            worker.terminateSync()
        }
    }

    // MARK: - Public API

    /// Submit work to the queue. Suspends the caller until the work completes.
    func submit<T: Sendable>(
        priority: Priority,
        _ operation: @Sendable @escaping () async throws -> T
    ) async throws -> T {
        try Task.checkCancellation()

        if circuitOpen {
            throw PythonBridgeError.bridgeDied
        }

        let entryId = nextSequence + 1

        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { cont in
                nextSequence += 1
                let entry = Entry(
                    priority: priority,
                    sequence: nextSequence,
                    work: {
                        do {
                            let result = try await operation()
                            cont.resume(returning: result)
                        } catch {
                            cont.resume(throwing: error)
                        }
                    },
                    cancel: {
                        cont.resume(throwing: CancellationError())
                    },
                    fail: { error in
                        cont.resume(throwing: error)
                    }
                )
                queue.append(entry)
                logQueueIfNeeded()
                if !isProcessing {
                    isProcessing = true
                    Task { await self.processLoop() }
                }
            }
        } onCancel: {
            Task { await self.removeEntry(id: entryId) }
        }
    }

    /// Convenience: run VLM frame analysis through the queue at realtime priority.
    func analyzeFrames(frames: [DbFrame]) async throws -> [FrameDescription] {
        try await submit(priority: .realtime) { [workers] in
            guard let worker = workers.first else {
                throw PythonBridgeError.notStarted
            }
            return try await worker.analyzeFrames(frames: frames)
        }
    }

    /// Convenience: run text generation through the queue at normal priority.
    func generateText(prompt: String, maxTokens: Int = 2000) async throws -> String {
        try await submit(priority: .normal) { [workers] in
            guard let worker = workers.first else {
                throw PythonBridgeError.notStarted
            }
            return try await worker.generateText(prompt: prompt, maxTokens: maxTokens)
        }
    }

    /// Convenience: zero-cost health check through the queue.
    func ping() async throws {
        _ = try await submit(priority: .low) { [workers] in
            guard let worker = workers.first else {
                throw PythonBridgeError.notStarted
            }
            return try await worker.ping()
        }
    }

    // MARK: - Processing Loop

    private func removeEntry(id: UInt64) {
        if let idx = queue.firstIndex(where: { $0.sequence == id }) {
            let entry = queue.remove(at: idx)
            entry.cancel()
            logQueueIfNeeded()
        }
    }

    func cancelAll() {
        let pending = queue
        queue.removeAll()
        for entry in pending {
            entry.cancel()
        }
        if !pending.isEmpty {
            log("[InferenceQueue] Cancelled \(pending.count) pending entries during shutdown")
        }
    }

    /// Drain the queue resuming all pending continuations with a specific error.
    /// Used when the circuit breaker opens — callers need to distinguish bridge
    /// death from user cancellation so they can take the correct cleanup path.
    private func drainWithError(_ error: Error) {
        let pending = queue
        queue.removeAll()
        for entry in pending {
            entry.fail(error)
        }
        if !pending.isEmpty {
            log("[InferenceQueue] Drained \(pending.count) pending entries with error: \(error.localizedDescription)")
        }
    }

    private func processLoop() async {
        while let entry = pickNext() {
            // Health check: verify worker is alive before running the job
            await ensureWorkerHealthy()
            if circuitOpen {
                entry.fail(PythonBridgeError.bridgeDied)
                drainWithError(PythonBridgeError.bridgeDied)
                break
            }
            await entry.work()
        }
        isProcessing = false
    }

    /// Check worker health and attempt restart if needed.
    private func ensureWorkerHealthy() async {
        guard let worker = workers.first else { return }

        // Fast path: worker reports ready
        let ready = await worker.isReady
        if ready {
            // Verify with a ping to catch zombie processes
            do {
                _ = try await worker.ping()
                workerFailureCount = 0
                return
            } catch {
                log("[InferenceQueue] Ping failed despite isReady=true: \(error.localizedDescription)")
            }
        }

        // Worker is down — attempt restart with backoff
        log("[InferenceQueue] Worker not healthy — attempting restart...")
        // Restart loop: try each delay, check circuit breaker AFTER failed attempt.
        // Delays are applied between failed attempts (5s → 10s → 20s → 40s → 60s).
        for (attempt, delay) in restartDelays.enumerated() {
            await worker.stop()
            do {
                try await worker.start()
                log("[InferenceQueue] Worker restarted on attempt \(attempt + 1)")
                workerFailureCount = 0
                return
            } catch {
                workerFailureCount += 1
                log("[InferenceQueue] Restart attempt \(attempt + 1)/\(restartDelays.count) failed: \(error.localizedDescription)")
                if workerFailureCount >= maxRestartAttempts {
                    log("[InferenceQueue] FATAL: Worker failed \(workerFailureCount) times — circuit open, stopping all inference")
                    circuitOpen = true
                    return
                }
                if attempt < restartDelays.count - 1 {
                    try? await Task.sleep(for: .seconds(delay))
                }
            }
        }
        log("[InferenceQueue] FATAL: All restart attempts exhausted — circuit open")
        circuitOpen = true
    }

    // MARK: - Scheduling (preserved from WorkQueue)

    private func pickNext() -> Entry? {
        guard !queue.isEmpty else { return nil }

        let hasRealtime = queue.contains { $0.priority == .realtime }
        let hasNonRealtime = queue.contains { $0.priority != .realtime }

        let idx: Int

        if realtimeStreak >= maxRealtimeStreak && hasNonRealtime {
            realtimeStreak = 0
            idx = queue.enumerated()
                .filter { $0.element.priority != .realtime }
                .min(by: Self.entryOrder)!.offset
        } else if hasRealtime {
            realtimeStreak += 1
            idx = queue.enumerated()
                .filter { $0.element.priority == .realtime }
                .min(by: Self.entryOrder)!.offset
        } else {
            realtimeStreak = 0
            idx = queue.enumerated()
                .min(by: Self.entryOrder)!.offset
        }

        let entry = queue.remove(at: idx)
        logQueueIfNeeded()
        return entry
    }

    private static func entryOrder(
        _ a: (offset: Int, element: Entry),
        _ b: (offset: Int, element: Entry)
    ) -> Bool {
        if a.element.priority != b.element.priority {
            return a.element.priority < b.element.priority
        }
        return a.element.sequence < b.element.sequence
    }

    private func logQueueIfNeeded() {
        let size = queue.count
        let bucket: Int
        if size == 0 {
            bucket = 0
        } else {
            let pct = maxRealtimeStreak > 0 ? (size * 100) / maxRealtimeStreak : 100
            switch pct {
            case 0..<25:   bucket = 1
            case 25..<50:  bucket = 2
            case 50..<75:  bucket = 3
            case 75...100: bucket = 4
            default:       bucket = 5
            }
        }
        guard bucket != lastLoggedBucket else { return }
        lastLoggedBucket = bucket
        let realtimeCount = queue.filter { $0.priority == .realtime }.count
        let normalCount   = queue.filter { $0.priority == .normal }.count
        let pct = maxRealtimeStreak > 0 ? (size * 100) / maxRealtimeStreak : 0
        log("[InferenceQueue] size=\(size)/\(maxRealtimeStreak) (\(pct)%) realtime=\(realtimeCount) normal=\(normalCount) streak=\(realtimeStreak)")
    }
}
