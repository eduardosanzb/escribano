# Coding Standards — Escribano

Reference for contributors and AI agents. Covers TypeScript (Node.js pipeline), Swift (recorder agent), and the cross-language bridge between them.

---

## TypeScript Patterns

### 1. Port/Adapter naming

External systems are always accessed through a typed port interface. Adapters follow the file naming convention:

```
[port].[implementation].adapter.ts
```

Examples:
- `intelligence.mlx.adapter.ts` — MLX backend for IntelligenceService
- `intelligence.ollama.adapter.ts` — Ollama backend for IntelligenceService
- `transcription.whisper.adapter.ts` — Whisper backend for TranscriptionService
- `capture.cap.adapter.ts` — Cap recording discovery

Port interfaces are defined in `src/0_types.ts`. Never import a concrete adapter directly in actions or services — always depend on the interface.

---

### 2. Factory functions over classes

Use factory functions that return a typed interface, not classes with constructors.

```ts
// CORRECT
export function createMlxIntelligenceService(
  _config: Partial<IntelligenceConfig> = {}
): IntelligenceService & ResourceTrackable {
  const config = loadConfig();
  // ... private state here (closures), not class fields
  return {
    async describeImages(...) { ... },
    async generateText(...) { ... },
    // ...
  };
}

// WRONG — don't export classes
export class MlxIntelligenceService implements IntelligenceService { ... }
```

The returned object satisfies the port interface. Private state lives in closure scope, not on `this`.

---

### 3. Service purity: `src/services/` has no I/O

Files in `src/services/` contain **pure business logic only**:
- No `process.env` reads
- No file system access
- No database calls
- No network requests

Orchestration (injecting adapters, calling repos, reading config) belongs in `src/actions/`.

| Directory | Responsibility |
|-----------|---------------|
| `src/services/` | Pure logic (math, algorithms, data transforms) |
| `src/actions/` | Pipeline orchestration (I/O, adapters, repos, config) |
| `src/adapters/` | External system implementations |

---

### 4. Pipeline observability: `withPipeline()` + `step()`

Every top-level action runs inside `withPipeline()`. Every named phase runs inside `step()`. Both come from `src/pipeline/context.ts`.

```ts
import { withPipeline, step, log } from '../pipeline/context.js';

// Top-level entry point in an action
await withPipeline(recordingId, 'initial', metadata, async () => {
  // Each phase is a named step
  const frames = await step('frame-extraction-batch', async () => {
    const result = await adapters.video.extractFramesAtTimestampsBatch(...);
    log('info', `Extracted ${result.length} frames`);
    return result;
  });

  await step('vlm-batch-inference', async () => {
    // work here
    return { itemsProcessed: frames.length }; // optional — shown in summary
  }, { itemsTotal: frames.length });
});
```

`step()` automatically times each phase, prints `✅` / `❌` with duration, and emits events for the stats pipeline. Do not add timing or try/catch inside a step — `step()` handles both.

`log()` is the context-aware alternative to `console.log` inside a `withPipeline` block:

```ts
import { log } from '../pipeline/context.js';
log('info', 'message');   // always shown
log('debug', 'message');  // shown only when verbose=true
```

---

### 5. Config access: always `loadConfig()`

Never read `process.env.ESCRIBANO_*` directly. Always go through `loadConfig()` from `src/config.ts`.

```ts
// CORRECT
import { loadConfig } from '../config.js';
const config = loadConfig();
const width = config.frameWidth;

// WRONG
const width = parseInt(process.env.ESCRIBANO_FRAME_WIDTH ?? '1024', 10);
```

`loadConfig()` is cached after the first call. It merges `~/.escribano/.env`, shell environment variables, and RAM-aware defaults. Zod validates the result on every load.

---

### 6. Logger: `createLogger(prefix)`

Never use `console.log` directly in adapters or services. Use `createLogger` from `src/utils/logger.ts`.

```ts
import { createLogger } from '../utils/logger.js';

const log = createLogger('MLX'); // prefix shown as [MLX] in output

log.info('Bridge ready');          // always emits
log.debug('Socket connected');     // only emits when verbose/debugVlm/debugOllama enabled
log.warn('Retry attempt 2');       // always emits to stderr
log.error('Connection failed');    // always emits to stderr
```

The `debug` method is automatically gated:
- `prefix === 'MLX'` or `'VLM'` → gated by `config.debugVlm`
- `prefix === 'Ollama'` → gated by `config.debugOllama`
- `prefix === 'LLM'` → gated by `config.debugLlm`
- Any other prefix → gated by `config.verbose`

Use `createLogger` at module scope (one logger per file), not inside functions.

---

### 7. Error types: domain errors from `src/domain/errors.ts`

Throw typed domain errors instead of `new Error('...')` for recoverable or classifiable failures.

```ts
import { PipelineError, AdapterError, ModelError, ConfigError } from '../domain/errors.js';

// Wrong pipeline step or state
throw new PipelineError('Frame extraction failed: no video path', 'frame_extraction');

// An adapter cannot fulfil a request
throw new AdapterError('Whisper binary not found', 'transcription.whisper');

// A specific model failed to load
throw new ModelError('OOM during load', 'intelligence.mlx', 'Qwen3-VL-2B-Instruct-4bit');

// Invalid or missing configuration
throw new ConfigError('ESCRIBANO_OUTLINE_TOKEN is required for publishing');
```

Error hierarchy:
```
EscribanoError (base)
├── PipelineError   — step: string
├── AdapterError    — adapter: string
│   └── ModelError  — model: string
└── ConfigError
```

Catch `EscribanoError` when you need to handle any application error uniformly. Catch specific subtypes when the recovery path differs.

---

### 8. Resume safety

The pipeline checkpoints progress to the database so a crash or interruption can be resumed without starting over.

Key rules:
- Advance `recording.processingStep` in the DB **after** each step completes, not before.
- Use `INSERT OR IGNORE` (via `repos.contexts.saveOrIgnore()`) for idempotent writes when the same row might be written more than once.
- Check for already-processed data at the start of expensive steps:

```ts
// Resume safety: skip already-processed frames
const existingObs = repos.observations
  .findByRecording(recording.id)
  .filter((o) => o.type === 'visual' && o.vlm_description);

const processedTimestamps = new Set(existingObs.map((o) => o.timestamp));
const framesToProcess = extractedFrames.filter(
  (f) => !processedTimestamps.has(f.timestamp)
);
```

Write results to the DB **inside** the callback passed to `step()`, not after it returns.

---

## Swift Patterns

### 1. Actor model for concurrent components

Core recorder components are Swift actors, which serialise access to mutable state. Only one async task runs inside an actor at a time — no locks needed for internal state.

```swift
// FrameAnalyzer, PythonBridgeVLMAdapter, and ObservationStore are actors
actor PythonBridgeVLMAdapter: VLMInferenceService {
    // All mutable state is automatically protected
    private var isStarted: Bool = false
    private var process: Process?
    private var fileHandle: FileHandle?

    func start() async throws { ... }   // called from async context
    func runBatch(frames: [DbFrame]) async throws -> [FrameDescription] { ... }
    func stop() async { ... }

    // nonisolated: allows synchronous call from non-async context (e.g. app shutdown)
    nonisolated func terminateSync() {
        let pid = storedPID  // must be nonisolated(unsafe) for this to work
        guard pid > 0 else { return }
        kill(pid, SIGTERM)
    }
}
```

Use `nonisolated(unsafe)` only for values written exactly once before any concurrent reads (e.g., PID stored in `start()` and read in `terminateSync()`).

---

### 2. Port/Adapter naming

Swift follows the same Port/Adapter convention as TypeScript, using filename suffixes:

```
FrameStore.port.swift          ← protocol definition (the "outlet shape")
FrameStore.sqlite.adapter.swift ← SQLite implementation (the "plug")

ObservationStore.port.swift
ObservationStore.sqlite.adapter.swift

VLMInferenceService.port.swift
PythonBridge.vlm.adapter.swift
```

Port files contain only the protocol and its associated types/errors. Adapter files contain the concrete implementation. Business logic (e.g., `FrameAnalyzer`, `StreamCapture`) depends only on the protocol, never the adapter.

---

### 3. Error enums with `LocalizedError`

All thrown errors are `enum` types conforming to `LocalizedError` with an `errorDescription`:

```swift
enum PythonBridgeError: Error, LocalizedError {
    case notStarted
    case startupTimeout
    case bridgeDied
    case socketError(String)
    case inferenceTimeout(TimeInterval)

    var errorDescription: String? {
        switch self {
        case .notStarted:          return "PythonBridge not started — call start() first"
        case .startupTimeout:      return "Python bridge timed out (180s)"
        case .bridgeDied:          return "Python bridge process died unexpectedly"
        case .socketError(let m):  return "Unix socket error: \(m)"
        case .inferenceTimeout(let t): return "VLM inference timed out after \(Int(t))s"
        }
    }
}
```

Never use `NSError` or string literals as thrown values.

---

### 4. `ResumeFlag` pattern for `CheckedContinuation` safety

When bridging callback-based APIs (like `FileHandle.readabilityHandler` and `DispatchSourceTimer`) into `async`/`await`, a continuation must be resumed **exactly once**. Use the `ResumeFlag` helper to prevent double-resume crashes:

```swift
try await withCheckedThrowingContinuation { continuation in
    let resumed = ResumeFlag()

    // Timer fires if the operation takes too long
    let timer = DispatchSource.makeTimerSource(queue: .global())
    timer.schedule(deadline: .now() + timeout)
    timer.setEventHandler {
        guard resumed.trySet() else { return }  // only one winner
        handle.readabilityHandler = nil
        timer.cancel()
        continuation.resume(throwing: MyError.timeout)
    }
    timer.resume()

    // Handler fires when data arrives
    handle.readabilityHandler = { h in
        // ... read data ...
        if done {
            guard resumed.trySet() else { return }  // only one winner
            handle.readabilityHandler = nil
            timer.cancel()
            continuation.resume(returning: result)
        }
    }
}
```

`ResumeFlag` uses `NSLock` to make the `false → true` transition atomic across dispatch queues.

---

### 5. Always check `sqlite3_step()` return codes

Every SQLite call must be checked. The pattern for prepared statements:

```swift
var stmt: OpaquePointer?
guard sqlite3_prepare_v2(handle, sql, -1, &stmt, nil) == SQLITE_OK else {
    let msg = String(cString: sqlite3_errmsg(handle))
    throw FrameStoreError.insertFailed(msg)
}
defer { sqlite3_finalize(stmt) }  // always finalize

// Bind parameters (1-indexed)
sqlite3_bind_text(stmt, 1, value, -1, SQLITE_TRANSIENT)

// Execute and check result
let rc = sqlite3_step(stmt)
guard rc == SQLITE_DONE else {  // SQLITE_DONE for INSERT/UPDATE, SQLITE_ROW for SELECT
    let msg = String(cString: sqlite3_errmsg(handle))
    throw FrameStoreError.insertFailed(msg)
}
```

Use `defer { sqlite3_finalize(stmt) }` immediately after `prepare` so the statement is always finalised, even on thrown errors.

---

## Cross-Language Patterns

### 1. NDJSON over Unix domain sockets

Communication between Node.js (TypeScript) and Python (mlx_bridge.py), and between Swift (recorder) and Python, uses **NDJSON** — one JSON object per line, terminated by `\n`.

Protocol:
- **Request** (sender → Python): `{"id": 1, "method": "vlm_infer", "params": {...}}\n`
- **Response** (Python → sender): `{"id": 1, "text": "...", "stats": {...}, "done": true}\n`

Parsing rule: accumulate bytes into a buffer, split on `\n`, parse each non-empty line as JSON. Never assume a single `read()` contains exactly one message.

```ts
// TypeScript side (intelligence.mlx.adapter.ts)
let buffer = '';
socket.on('data', (chunk: Buffer) => {
  buffer += chunk.toString();
  while (buffer.includes('\n')) {
    const newlineIndex = buffer.indexOf('\n');
    const line = buffer.slice(0, newlineIndex);
    buffer = buffer.slice(newlineIndex + 1);
    if (!line.trim()) continue;
    const response = JSON.parse(line);
    if (response.done) { /* resolve */ }
  }
});
const requestJson = `${JSON.stringify(request)}\n`;
socket.write(requestJson);
```

---

### 2. Bridge lifecycle: lazy start, stays loaded, killed on exit

The Python bridge process is:
1. **Spawned lazily** — only when the first inference request arrives, not at startup
2. **Kept alive** — the same process handles all subsequent requests in that session
3. **Terminated on exit** — via `process.once('SIGTERM', cleanup)` / `SIGINT` / `beforeExit` (Node.js) or `nonisolated func terminateSync()` (Swift)

Readiness is signalled by the Python process printing `{"status": "ready"}` to stdout after the model is loaded. The caller waits for this line before connecting the socket.

Stale socket files (`.sock`) from a previous crashed run are removed before spawning a new bridge.

---

### 3. SQLite WAL mode for concurrent access

The SQLite database is shared between Node.js (reader/writer) and the Swift recorder (writer). WAL (Write-Ahead Logging) mode allows concurrent readers while writes are in progress.

Both sides must set the same pragmas on every connection:

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

In Swift (`SQLiteFrameStore`):
```swift
try exec("PRAGMA journal_mode = WAL")
try exec("PRAGMA synchronous = NORMAL")
try exec("PRAGMA foreign_keys = ON")
try exec("PRAGMA busy_timeout = 5000")
```

In Node.js (`src/db/index.ts`), `better-sqlite3` sets the same pragmas with the same values.

---

### 4. `PRAGMA user_version` for schema versioning

Migrations are run by the Node.js CLI (`src/db/migrate.ts`). After each migration, `user_version` is incremented. Swift components check this on startup and refuse to run if the schema is older than expected:

```swift
// In SQLiteFrameStore.init()
static let expectedSchemaVersion: Int32 = 15

let version = try getUserVersion()
guard version >= Self.expectedSchemaVersion else {
    throw FrameStoreError.schemaMismatch(current: version, expected: Self.expectedSchemaVersion)
}
```

The Swift recorder **never runs migrations** — it only reads `user_version` to validate. The Node.js CLI is the single source of truth for schema evolution.

When adding a new migration:
1. Add `NNN_description.sql` to `migrations/`
2. Increment `expectedSchemaVersion` in `SQLiteFrameStore.swift`
3. Run `npx escribano recorder install` to rebuild the Swift binary against the new schema

---

### 5. Signal-based timeouts in Python

The Python bridge (`scripts/mlx_bridge.py`) uses `signal.alarm` for hard timeouts around inference calls. This is needed because MLX inference can hang silently on OOM:

```python
import signal

def _timeout_handler(signum, frame):
    raise TimeoutError("Inference timed out")

signal.signal(signal.SIGALRM, _timeout_handler)
signal.alarm(timeout_seconds)   # arm the alarm
try:
    result = model.generate(...)
finally:
    signal.alarm(0)             # disarm — always, even on exception
```

This approach works only on Unix (macOS, Linux). On Windows it would need `threading.Timer` instead.
