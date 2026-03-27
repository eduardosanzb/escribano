import Foundation

/// Generic priority work queue.
///
/// Serialises access to a shared resource (e.g. a Python bridge) while ensuring
/// higher-priority work runs first and lower-priority work is never starved.
///
/// Design:
///   - One job runs at a time (matches physical constraint: one bridge process)
///   - Priority ordering: .realtime > .normal > .low
///   - Fairness: after `maxRealtimeStreak` consecutive realtime jobs, one non-realtime
///     job is allowed through before realtime resumes
///   - Future: replace single processLoop with a pool of workers for multiple backends
actor WorkQueue {

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
    }

    // MARK: - State

    private var queue: [Entry] = []
    private var nextSequence: UInt64 = 0
    private var isProcessing = false
    private var realtimeStreak = 0
    private var lastLoggedBucket: Int = -1
    private let maxRealtimeStreak: Int

    // MARK: - Init

    init(maxRealtimeStreak: Int = 10) {
        self.maxRealtimeStreak = maxRealtimeStreak
    }

    // MARK: - Public API

    /// Submit work to the queue. Suspends the caller until the work completes.
    /// Returns the result of the work closure.
    ///
    /// Cancellation: if the calling Task is already cancelled when submit() is called,
    /// CancellationError is thrown immediately before enqueuing. Cancellation that occurs
    /// after enqueuing will remove the pending entry from the queue (if not yet started)
    /// and throw CancellationError when the caller resumes.
    func submit<T: Sendable>(
        priority: Priority,
        _ operation: @Sendable @escaping () async throws -> T
    ) async throws -> T {
        try Task.checkCancellation()
        
        let entryId = nextSequence + 1  // Capture before increment
        
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
            // Remove the entry from queue if still pending
            Task { await self.removeEntry(id: entryId) }
        }
    }

    // MARK: - Processing Loop

    /// Remove an entry from the queue by its sequence ID if still pending.
    private func removeEntry(id: UInt64) {
        if let idx = queue.firstIndex(where: { $0.sequence == id }) {
            queue.remove(at: idx)
            logQueueIfNeeded()
        }
    }

    /// Runs inside the actor. Picks the next item, executes it (the `await` releases
    /// the actor lock so new submits can enqueue), then repeats until the queue is empty.
    private func processLoop() async {
        while let entry = pickNext() {
            await entry.work()
        }
        isProcessing = false
    }

    /// Select the next entry to run based on priority and fairness.
    ///
    /// Rules:
    ///   1. If realtimeStreak >= maxRealtimeStreak AND non-realtime items exist
    ///      → pick highest-priority non-realtime (fairness yield)
    ///   2. Else if realtime items exist → pick realtime (FIFO within tier)
    ///   3. Else → pick highest-priority available (FIFO within tier)
    private func pickNext() -> Entry? {
        guard !queue.isEmpty else { return nil }

        let hasRealtime = queue.contains { $0.priority == .realtime }
        let hasNonRealtime = queue.contains { $0.priority != .realtime }

        let idx: Int

        if realtimeStreak >= maxRealtimeStreak && hasNonRealtime {
            // Fairness yield: pick best non-realtime
            realtimeStreak = 0
            idx = queue.enumerated()
                .filter { $0.element.priority != .realtime }
                .min(by: Self.entryOrder)!.offset
        } else if hasRealtime {
            // Normal path: pick realtime
            realtimeStreak += 1
            idx = queue.enumerated()
                .filter { $0.element.priority == .realtime }
                .min(by: Self.entryOrder)!.offset
        } else {
            // No realtime: pick whatever is available
            realtimeStreak = 0
            idx = queue.enumerated()
                .min(by: Self.entryOrder)!.offset
        }

        let entry = queue.remove(at: idx)
        logQueueIfNeeded()
        return entry
    }

    /// Ordering: priority first (lower rawValue = higher priority), then FIFO by sequence.
    private static func entryOrder(
        _ a: (offset: Int, element: Entry),
        _ b: (offset: Int, element: Entry)
    ) -> Bool {
        if a.element.priority != b.element.priority {
            return a.element.priority < b.element.priority
        }
        return a.element.sequence < b.element.sequence
    }

    /// Log queue depth only when it crosses a new 25%-bucket of maxRealtimeStreak.
    /// Bucket 0=empty, 1=≤25%, 2=≤50%, 3=≤75%, 4=≤100%, 5=>100%.
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
        log("[WorkQueue] size=\(size)/\(maxRealtimeStreak) (\(pct)%) realtime=\(realtimeCount) normal=\(normalCount) streak=\(realtimeStreak)")
    }
}
