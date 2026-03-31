# Implementation Plan: Code Quality & Consistency Improvements

**Date**: 2026-03-21  **Status**: COMPLETED

## Overview

Comprehensive code quality improvement for the Escribano codebase: add missing test coverage first (safety net), then remove dead code, create logging abstraction, centralize configuration, fix architecture violations, split the monolithic types file, improve error handling, and harden multi-language boundaries.

## Scope

- Work units: 25
- Execution phases: 8
- Files affected:
  - `src/tests/services/temporal-alignment.test.ts` (create)
  - `src/tests/services/app-normalization.test.ts` (create)
  - `src/tests/domain/recording.test.ts` (create)
  - `src/tests/domain/time-range.test.ts` (create)
  - `src/tests/config.test.ts` (create)
  - `src/services/debug.ts` (delete)
  - `src/utils/index.ts` (modify)
  - `src/index.ts` (modify)
  - `src/actions/generate-artifact-v3.ts` (modify)
  - `src/adapters/intelligence.ollama.adapter.ts` (modify)
  - `src/0_types.ts` (modify)
  - `src/utils/logger.ts` (create)
  - `src/adapters/intelligence.mlx.adapter.ts` (modify)
  - `src/adapters/video.ffmpeg.adapter.ts` (modify)
  - `src/config.ts` (modify)
  - `src/services/subject-grouping.ts` (modify)
  - `src/pipeline/context.ts` (modify)
  - `src/types/schemas.ts` (create)
  - `src/types/ports.ts` (create)
  - `src/types/repositories.ts` (create)
  - `src/types/index.ts` (create)
  - `src/domain/errors.ts` (create)
  - `src/utils/vlm-parser.ts` (create)
  - `src/actions/sync-to-outline.ts` (modify)
  - `src/actions/analyze-frames.ts` (modify)
  - `src/actions/recorder-commands.ts` (modify)
  - `scripts/mlx_bridge.py` (modify)
  - `apps/recorder/Sources/ObservationStore.sqlite.adapter.swift` (modify)
  - `apps/recorder/Sources/PythonBridge.vlm.adapter.swift` (modify)
  - `src/db/migrate.ts` (modify)
  - `docs/coding-standards.md` (create)

---

## Work Units

### WU-1: Test temporal-alignment service

**Dependencies**: none

**Context**: `src/services/temporal-alignment.ts` is a pure service (178 lines) that aligns audio observations to visual segments by timestamp overlap. It has zero test coverage. It exports two functions: `alignAudioToSegments()` which takes segments and audio observations and returns enriched segments with attached transcripts, and `getAlignmentStats()` which returns coverage statistics. We need tests before refactoring.

**Files**:
- `src/tests/services/temporal-alignment.test.ts` — create

**Steps**:
1. Create test file importing `alignAudioToSegments` and `getAlignmentStats` from `../../services/temporal-alignment.js`
2. Create a `createObservation()` factory helper that returns a `DbObservation` object (see pattern from `src/services/activity-segmentation.test.ts` — the factory creates objects with fields: `id`, `recording_id`, `type`, `timestamp`, `end_timestamp`, `image_path`, `ocr_text`, `vlm_description`, `vlm_raw_response`, `activity_type`, `apps`, `topics`, `text`, `audio_source`, `audio_type`, `embedding`, `created_at`). For audio observations, set `type: 'audio'`, `text: <transcript>`, `audio_source: 'mic'` or `'system'`.
3. Create a `createSegment()` factory for segment objects with `startTime`, `endTime`, `activity`, `observations` fields.
4. Write tests for `alignAudioToSegments`:
   - Empty segments → returns empty array
   - Empty audio observations → returns segments with empty transcripts
   - Audio observation overlapping one segment → transcript attached
   - Audio observation overlapping two segments → attached to both
   - Audio observation with overlap < 1s (default `minOverlapSeconds`) → filtered out
   - Custom `minOverlapSeconds` config → respects threshold
   - Multiple audio sources (mic + system) → both attached, ordered chronologically
   - `combinedTranscript` field correctly combines with `[MIC]`/`[SYSTEM]` prefixes
5. Write tests for `getAlignmentStats`:
   - Returns correct `totalSegments`, `segmentsWithAudio`, `totalTranscriptSegments`
   - Correctly counts mic vs system transcripts

**Verification**: `pnpm vitest run src/tests/services/temporal-alignment.test.ts`

**Rollback**:
- Created files: `rm -f src/tests/services/temporal-alignment.test.ts`

---

### WU-2: Test app-normalization service

**Dependencies**: none

**Context**: `src/services/app-normalization.ts` (248 lines) normalizes VLM-extracted app names using a 57-entry alias map and Levenshtein fuzzy matching at 0.85 similarity threshold. It exports `normalizeAppNames()`, `normalizeAppNamesInRecord()`, `normalizeAppNamesInRecords()`, and `isPersonalApp()`. Zero test coverage.

**Files**:
- `src/tests/services/app-normalization.test.ts` — create

**Steps**:
1. Create test file importing all four exported functions from `../../services/app-normalization.js`
2. Write tests for `normalizeAppNames`:
   - Empty array → empty array
   - Known aliases: `['vscode']` → `['VSCode']`, `['ghosty']` → `['Ghostty']`
   - Case normalization: `['SLACK']` → `['Slack']`
   - Deduplication: `['VSCode', 'vscode']` → `['VSCode']`
   - Fuzzy matching: similar names (within 0.85 threshold) collapse to canonical form
   - Noisy names filtered: single letters, generic words removed
   - Results sorted alphabetically
3. Write tests for `isPersonalApp`:
   - Personal apps return true: `'WhatsApp'`, `'Instagram'`, `'Telegram'`, `'Discord'`, `'FaceTime'`
   - Work apps return false: `'VSCode'`, `'Slack'`, `'Terminal'`
4. Write tests for `normalizeAppNamesInRecord`:
   - Takes object with `apps` field, normalizes in-place
5. Write tests for `normalizeAppNamesInRecords`:
   - Processes array of records

**Verification**: `pnpm vitest run src/tests/services/app-normalization.test.ts`

**Rollback**:
- Created files: `rm -f src/tests/services/app-normalization.test.ts`

---

### WU-3: Test domain recording state machine

**Dependencies**: none

**Context**: `src/domain/recording.ts` defines a pure functional state machine for recording processing. It exports four functions: `startProcessing()` (raw → processing, step='vad'), `advanceStep()` (sets processingStep), `completeProcessing()` (→ processed), `failProcessing()` (→ error). All functions are pure — they take a Recording and return a new Recording.

**Files**:
- `src/tests/domain/recording.test.ts` — create

**Steps**:
1. Create test file importing `startProcessing`, `advanceStep`, `completeProcessing`, `failProcessing` from `../../domain/recording.js`
2. Create factory: `createRecording(overrides)` returning a Recording with defaults `{ id: 'test', status: 'raw', processingStep: null, errorMessage: null, videoPath: '/test.mov', audioMicPath: null, audioSystemPath: null, capturedAt: '2024-01-01', duration: 3600 }`
3. Write tests:
   - `startProcessing`: sets status='processing', processingStep='vad', clears errorMessage
   - `advanceStep`: updates processingStep to given step, preserves other fields
   - `completeProcessing`: sets status='processed', clears processingStep
   - `failProcessing`: sets status='error', preserves processingStep for resume, sets errorMessage
   - Immutability: original recording object unchanged after each call
   - Full lifecycle: raw → startProcessing → advanceStep('transcription') → advanceStep('vlm_enrichment') → completeProcessing

**Verification**: `pnpm vitest run src/tests/domain/recording.test.ts`

**Rollback**:
- Created files: `rm -f src/tests/domain/recording.test.ts`

---

### WU-4: Test domain time-range value object

**Dependencies**: none

**Context**: `src/domain/time-range.ts` defines a `TimeRange` value object (tuple `[start, end]`) with static methods: `create()`, `duration()`, `overlaps()`, `overlapDuration()`, `format()`, `contains()`. The `create()` method validates non-negative values and `end >= start`.

**Files**:
- `src/tests/domain/time-range.test.ts` — create

**Steps**:
1. Create test file importing `TimeRange` from `../../domain/time-range.js`
2. Write tests for each method:
   - `create(0, 10)` → `[0, 10]`
   - `create(-1, 10)` → throws "Values must be non-negative"
   - `create(10, 5)` → throws "End must be greater than or equal to start"
   - `create(5, 5)` → `[5, 5]` (zero-length range is valid)
   - `duration([0, 10])` → `10`
   - `overlaps([0, 10], [5, 15])` → `true`
   - `overlaps([0, 10], [10, 20])` → `false` (touching but not overlapping)
   - `overlaps([0, 10], [11, 20])` → `false`
   - `overlapDuration([0, 10], [5, 15])` → `5`
   - `overlapDuration([0, 10], [20, 30])` → `0`
   - `format([65, 130])` → `'1:05 → 2:10'`
   - `contains([0, 10], 5)` → `true`
   - `contains([0, 10], 0)` → `true` (inclusive start)
   - `contains([0, 10], 10)` → `true` (inclusive end)
   - `contains([0, 10], 11)` → `false`

**Verification**: `pnpm vitest run src/tests/domain/time-range.test.ts`

**Rollback**:
- Created files: `rm -f src/tests/domain/time-range.test.ts`

---

### WU-5: Test config loading

**Dependencies**: none

**Context**: `src/config.ts` loads configuration from environment variables, `~/.escribano/.env` file, and defaults via a Zod schema with 25+ fields. The `loadConfig()` function returns a merged `Config` object. Key behaviors: RAM-aware defaults (adjusts model selection based on `os.totalmem()`), Zod validation with proper defaults, priority chain (env > file > defaults).

**Files**:
- `src/tests/config.test.ts` — create

**Steps**:
1. Create test file importing `loadConfig` from `../config.js`
2. Use `vi.stubEnv()` to mock environment variables and `vi.restoreAllMocks()` in afterEach
3. Write tests:
   - Default values: calling with no env vars returns Zod defaults (e.g., `frameWidth: 1024`, `vlmBatchSize: 2`, `sceneThreshold: 0.4`, `verbose: false`)
   - Env override: setting `ESCRIBANO_FRAME_WIDTH=1280` → `config.frameWidth === 1280`
   - Boolean parsing: `ESCRIBANO_VERBOSE=true` → `config.verbose === true`
   - Backend selection: `ESCRIBANO_LLM_BACKEND=ollama` → `config.llmBackend === 'ollama'`
   - Invalid values: `ESCRIBANO_FRAME_WIDTH=abc` → falls back to default (not NaN)

**Verification**: `pnpm vitest run src/tests/config.test.ts`

**Rollback**:
- Created files: `rm -f src/tests/config.test.ts`

---

### WU-6: Delete dead code (debug service + utils)

**Dependencies**: none

**Context**: The audit found several dead code items: `src/services/debug.ts` is marked `@deprecated` (91 lines, all I/O); `src/utils/index.ts` exports `bufferToEmbedding()` which is never imported anywhere (V2 embedding code, disabled in V3); `src/index.ts` has an unused `_MODEL_PATH` variable.

**Files**:
- `src/services/debug.ts` — delete
- `src/utils/index.ts` — modify
- `src/index.ts` — modify

**Steps**:
1. Delete `src/services/debug.ts` entirely
2. In `src/utils/index.ts`, remove the `bufferToEmbedding` function. Keep only `export * from './parallel.js';`
3. In `src/index.ts`, find and remove the `_MODEL_PATH` variable declaration (unused variable, approximately line 35-37). Search for `_MODEL_PATH` to find exact location.
4. Verify no other files import from `src/services/debug.ts` or reference `bufferToEmbedding` — search for both before deleting.

**Verification**: `pnpm tsc --noEmit && pnpm vitest run`

**Rollback**:
- Modified or deleted files: `git checkout -- src/services/debug.ts src/utils/index.ts src/index.ts`

---

### WU-7: Delete dead code (adapter + action + types)

**Dependencies**: none

**Context**: More dead code found in the audit: `src/adapters/intelligence.ollama.adapter.ts` has an unused `embedTextWithOllama()` function (V2 embedding, disabled); `src/actions/generate-artifact-v3.ts` has an unused `_filteredSubjects` variable; `src/0_types.ts` has deprecated `EmbeddingService` and `EmbeddingConfig` types.

**Files**:
- `src/adapters/intelligence.ollama.adapter.ts` — modify
- `src/actions/generate-artifact-v3.ts` — modify

**Steps**:
1. In `src/adapters/intelligence.ollama.adapter.ts`, find and remove the `embedTextWithOllama()` function. It is a standalone function that calls the Ollama embedding API — not used in V3 pipeline. Search for `embedTextWithOllama` to find exact location.
2. In `src/actions/generate-artifact-v3.ts`, find and remove the `_filteredSubjects` variable (approximately line 115). It has an underscore prefix indicating it was intentionally unused. Search for `_filteredSubjects` to find the exact line.
3. Verify no imports reference removed functions: `grep -r "embedTextWithOllama" src/` and `grep -r "_filteredSubjects" src/` should return zero matches after removal.
4. For `EmbeddingService` and `EmbeddingConfig` in `src/0_types.ts`: first verify no files import them (`grep -r "EmbeddingService\|EmbeddingConfig" src/`). Only remove if zero matches found. If they are imported, add `@deprecated` JSDoc comment instead.

**Verification**: `pnpm tsc --noEmit && pnpm vitest run`

**Rollback**:
- Modified files: `git checkout -- src/adapters/intelligence.ollama.adapter.ts src/actions/generate-artifact-v3.ts`

---

### WU-8: Create centralized logger utility

**Dependencies**: none

**Context**: The codebase has duplicated `debugLog()` functions in `intelligence.mlx.adapter.ts` (line 48-53) and `intelligence.ollama.adapter.ts` (line 33-37), both gated by config flags. Additionally, `video.ffmpeg.adapter.ts` imports `debugLog` from the ollama adapter (line 17), creating a cross-adapter dependency. We need a centralized logger factory.

**Files**:
- `src/utils/logger.ts` — create

**Steps**:
1. Create `src/utils/logger.ts` with a `createLogger(prefix: string)` factory function
2. The factory should return an object with `{ debug, info, warn, error }` methods
3. All methods prepend `[PREFIX]` to output: e.g., `createLogger('MLX').info('hello')` → `console.log('[MLX]', 'hello')`
4. The `debug()` method should be gated by configuration. Import `loadConfig` from `../config.js`. Call it lazily (cache result). Check `config.verbose` for general debug, plus specific prefix overrides:
   - Prefix 'MLX' or 'VLM': also enabled by `config.debugVlm`
   - Prefix 'Ollama': also enabled by `config.debugOllama`
   - Prefix 'LLM': also enabled by `config.debugLlm`
   - All other prefixes: only `config.verbose`
5. `info()` → `console.log`, `warn()` → `console.warn`, `error()` → `console.error` — always emit, no gating
6. Export `createLogger` as named export

**Verification**: `pnpm tsc --noEmit`

**Rollback**:
- Created files: `rm -f src/utils/logger.ts`

---

### WU-9: Replace debugLog in MLX adapter with centralized logger

**Dependencies**: WU-8

**Context**: `src/adapters/intelligence.mlx.adapter.ts` has a local `debugLog()` function (lines 48-53) that calls `loadConfig()` on every invocation and checks `config.verbose`. It also imports `loadConfig` from `../config.js` (line 37) — an architecture violation since adapters shouldn't import the config module. After WU-8 creates the centralized logger, we replace the local function.

**Files**:
- `src/adapters/intelligence.mlx.adapter.ts` — modify

**Steps**:
1. Add import: `import { createLogger } from '../utils/logger.js';`
2. Replace the local `debugLog` function (lines 48-53) with: `const log = createLogger('MLX');` and then replace all calls to `debugLog(...)` with `log.debug(...)`
3. Remove the `import { loadConfig } from '../config.js';` line (line 37) — this was only used by the local `debugLog` function. IMPORTANT: Before removing, verify `loadConfig` is not used elsewhere in the file (search for `loadConfig` — it may be used in the `createMlxIntelligenceService` factory). Only remove the import if no other usage exists.
4. Also replace the 7 silent `catch {}` blocks in the cleanup function (lines ~290-323) with `catch (e) { log.debug('cleanup failed:', e); }` — this makes cleanup failures observable without breaking execution.

**Verification**: `pnpm tsc --noEmit && pnpm vitest run src/tests/intelligence.mlx.adapter.test.ts`

**Rollback**:
- Modified files: `git checkout -- src/adapters/intelligence.mlx.adapter.ts`

---

### WU-10: Replace debugLog in Ollama adapter and fix FFmpeg cross-adapter dependency

**Dependencies**: WU-8

**Context**: `src/adapters/intelligence.ollama.adapter.ts` exports a `debugLog()` function (lines 33-37) gated by `process.env.ESCRIBANO_DEBUG_OLLAMA`. `src/adapters/video.ffmpeg.adapter.ts` imports this function (line 17: `import { debugLog } from './intelligence.ollama.adapter.js'`), creating a cross-adapter dependency that violates the Ports & Adapters architecture. After WU-8, both adapters should use their own logger instances.

**Files**:
- `src/adapters/intelligence.ollama.adapter.ts` — modify
- `src/adapters/video.ffmpeg.adapter.ts` — modify

**Steps**:
1. In `src/adapters/intelligence.ollama.adapter.ts`:
   - Add import: `import { createLogger } from '../utils/logger.js';`
   - Replace the exported `debugLog` function with: `const log = createLogger('Ollama');`
   - Replace all internal calls to `debugLog(...)` with `log.debug(...)`
   - Keep the `debugLog` export temporarily as `export const debugLog = createLogger('Ollama').debug;` for backward compatibility, OR remove the export entirely if Step 2 removes the only consumer
2. In `src/adapters/video.ffmpeg.adapter.ts`:
   - Remove the import: `import { debugLog } from './intelligence.ollama.adapter.js';` (line 17)
   - Add import: `import { createLogger } from '../utils/logger.js';`
   - Add: `const log = createLogger('FFmpeg');`
   - Replace all calls to `debugLog(...)` with `log.debug(...)`
3. Verify no other files import `debugLog` from `intelligence.ollama.adapter.ts`: `grep -r "debugLog.*intelligence.ollama" src/`

**Verification**: `pnpm tsc --noEmit && pnpm vitest run`

**Rollback**:
- Modified files: `git checkout -- src/adapters/intelligence.ollama.adapter.ts src/adapters/video.ffmpeg.adapter.ts`

---

### WU-11: Centralize env var access in video.ffmpeg adapter

**Dependencies**: WU-10

**Context**: `src/adapters/video.ffmpeg.adapter.ts` reads environment variables directly: `ESCRIBANO_SCENE_THRESHOLD` (line 25), `ESCRIBANO_SCENE_MIN_INTERVAL` (line 29), and `ESCRIBANO_FRAME_INTERVAL` (approximately line 82). These should come from the config module. The config schema in `src/config.ts` already has `sceneThreshold` and `sceneMinInterval` fields.

**Files**:
- `src/adapters/video.ffmpeg.adapter.ts` — modify

**Steps**:
1. Add import: `import { loadConfig } from '../config.js';`
2. Inside the `createFfmpegVideoService()` factory function (not at module top level), call `const config = loadConfig();`
3. Replace `const SCENE_THRESHOLD = Number(process.env.ESCRIBANO_SCENE_THRESHOLD) || 0.4;` with `const SCENE_THRESHOLD = config.sceneThreshold;`
4. Replace `const SCENE_MIN_INTERVAL = Number(process.env.ESCRIBANO_SCENE_MIN_INTERVAL) || 2;` with `const SCENE_MIN_INTERVAL = config.sceneMinInterval;`
5. Find `ESCRIBANO_FRAME_INTERVAL` usage and replace with `config.sampleInterval` or appropriate config field. If no matching config field exists, add it to the config schema in `src/config.ts` (see WU-12).
6. Remove the module-level `const` declarations that read from `process.env`

**Verification**: `pnpm tsc --noEmit && pnpm vitest run`

**Rollback**:
- Modified files: `git checkout -- src/adapters/video.ffmpeg.adapter.ts`

---

### WU-12: Centralize remaining env var access in services and pipeline

**Dependencies**: none

**Context**: `src/services/subject-grouping.ts` reads `process.env.ESCRIBANO_SUBJECT_GROUPING_MODEL` directly (line 79). `src/pipeline/context.ts` reads `ESCRIBANO_VERBOSE` directly. Both should use `loadConfig()`. The config schema already has `subjectGroupingModel` and `verbose` fields.

**Files**:
- `src/services/subject-grouping.ts` — modify
- `src/pipeline/context.ts` — modify

**Steps**:
1. In `src/services/subject-grouping.ts`:
   - Find the line reading `process.env.ESCRIBANO_SUBJECT_GROUPING_MODEL` (approximately line 79)
   - Add `import { loadConfig } from '../config.js';` if not already imported
   - Replace the env read with `loadConfig().subjectGroupingModel`
2. In `src/pipeline/context.ts`:
   - Find the line reading `ESCRIBANO_VERBOSE` from `process.env` (approximately line 40)
   - Replace with `loadConfig().verbose`
   - Add the config import if needed: `import { loadConfig } from '../config.js';`

**Verification**: `pnpm tsc --noEmit && pnpm vitest run`

**Rollback**:
- Modified files: `git checkout -- src/services/subject-grouping.ts src/pipeline/context.ts`

---

### WU-13: Split 0_types.ts into focused modules (schemas)

**Dependencies**: none

**Context**: `src/0_types.ts` is a 712-line monolith containing ALL Zod schemas, port interfaces, and repository interfaces. There's a TODO in the file to split it. We'll create focused modules under `src/types/` and keep `0_types.ts` as a re-export for backward compatibility.

**Files**:
- `src/types/schemas.ts` — create
- `src/0_types.ts` — modify

**Steps**:
1. Create directory `src/types/` if it doesn't exist
2. Create `src/types/schemas.ts` containing ALL Zod schema definitions and their inferred types from `0_types.ts`:
   - `recordingSchema` + `Recording`
   - `transcriptSegmentSchema` + `TranscriptSegment`
   - `transcriptSchema` + `Transcript`
   - `sessionTypeSchema` + `SessionType` (if still used)
   - `classificationSchema` + `Classification`
   - `observationSchema` + `Observation` (if exists)
   - Any other `z.object()` definitions with their exported types
3. In `src/0_types.ts`, replace the schema definitions with: `export * from './types/schemas.js';`
4. Verify all existing imports of these types from `'../0_types.js'` still work through the re-export

**Verification**: `pnpm tsc --noEmit`

**Rollback**:
- Created files: `rm -rf src/types/`
- Modified files: `git checkout -- src/0_types.ts`

---

### WU-14: Split 0_types.ts into focused modules (ports + repositories)

**Dependencies**: WU-13

**Context**: After WU-13 extracted schemas, we now extract port interfaces and repository interfaces into their own files. The remaining `0_types.ts` becomes a thin re-export barrel.

**Files**:
- `src/types/ports.ts` — create
- `src/types/repositories.ts` — create
- `src/types/index.ts` — create
- `src/0_types.ts` — modify

**Steps**:
1. Create `src/types/ports.ts` containing ALL port/service interfaces from `0_types.ts`:
   - `TranscriptionService`, `EmbeddingService`, `CaptureSource`, `IntelligenceService`, `VideoService`, `StorageService`, `PublishingService`, `AudioPreprocessor`
   - Include supporting types they reference (e.g., `GenerateTextResult`, `EmbeddingBatchOptions`, `FrameDescription`)
   - Import schema types from `./schemas.js` as needed
2. Create `src/types/repositories.ts` containing ALL repository interfaces:
   - `RecordingRepository`, `ObservationRepository`, `ContextRepository`, `TopicBlockRepository`, `ArtifactRepository`, `SubjectRepository`, `FrameRepository`
   - Import types from `./schemas.js` as needed
3. Create `src/types/index.ts` as barrel export:
   ```typescript
   export * from './schemas.js';
   export * from './ports.js';
   export * from './repositories.js';
   ```
4. In `src/0_types.ts`, replace ALL remaining content with:
   ```typescript
   // Re-export from new module structure for backward compatibility
   export * from './types/index.js';
   ```

**Verification**: `pnpm tsc --noEmit && pnpm vitest run`

**Rollback**:
- Created files: `rm -f src/types/ports.ts src/types/repositories.ts src/types/index.ts`
- Modified files: `git checkout -- src/0_types.ts`

---

### WU-15: Create error type hierarchy

**Dependencies**: none

**Context**: The codebase uses only generic `Error("message")` with no custom error types. Cleanup code has 7 silent `catch {}` blocks. Error handling is inconsistent: some throw, some log, some return empty arrays. A domain error hierarchy enables better error handling patterns.

**Files**:
- `src/domain/errors.ts` — create

**Steps**:
1. Create `src/domain/errors.ts` with:
   ```typescript
   export class EscribanoError extends Error {
     constructor(message: string, public readonly code: string) {
       super(message);
       this.name = 'EscribanoError';
     }
   }

   export class PipelineError extends EscribanoError {
     constructor(message: string, public readonly step: string) {
       super(message, 'PIPELINE_ERROR');
       this.name = 'PipelineError';
     }
   }

   export class AdapterError extends EscribanoError {
     constructor(message: string, public readonly adapter: string) {
       super(message, 'ADAPTER_ERROR');
       this.name = 'AdapterError';
     }
   }

   export class ModelError extends AdapterError {
     constructor(message: string, adapter: string, public readonly model: string) {
       super(message, adapter);
       this.name = 'ModelError';
       this.code = 'MODEL_ERROR';
     }
   }

   export class ConfigError extends EscribanoError {
     constructor(message: string) {
       super(message, 'CONFIG_ERROR');
       this.name = 'ConfigError';
     }
   }
   ```

**Verification**: `pnpm tsc --noEmit`

**Rollback**:
- Created files: `rm -f src/domain/errors.ts`

---

### WU-16: Fix error handling in sync-to-outline

**Dependencies**: none

**Context**: `src/actions/sync-to-outline.ts` (283 lines) publishes artifacts to Outline wiki. The current implementation stops on the first publishing error, meaning if recording #3 of 10 fails, recordings #4-10 are never published. The fix is to collect errors and continue.

**Files**:
- `src/actions/sync-to-outline.ts` — modify

**Steps**:
1. Find the main publishing loop (approximately lines 89-150 where it iterates over recordings)
2. Add an errors array before the loop: `const errors: Array<{ recordingId: string; error: Error }> = [];`
3. Wrap the loop body in try-catch: catch errors, push to array, and `continue` to next recording
4. After the loop, if errors.length > 0, log a summary: `console.error(\`Failed to publish ${errors.length} recordings:\`, errors.map(e => \`${e.recordingId}: ${e.error.message}\`).join(', '))`
5. Return or throw an aggregate error only if ALL recordings failed

**Verification**: `pnpm tsc --noEmit`

**Rollback**:
- Modified files: `git checkout -- src/actions/sync-to-outline.ts`

---

### WU-17: Fix error handling in analyze-frames

**Dependencies**: none

**Context**: `src/actions/analyze-frames.ts` (117 lines) runs VLM inference on frames but has no error handling around the inference calls (approximately lines 51-65). If one frame fails, the entire batch fails. The fix is try-catch per frame/batch with continuation.

**Files**:
- `src/actions/analyze-frames.ts` — modify

**Steps**:
1. Find the VLM inference call(s) in the main processing loop
2. Wrap individual inference calls in try-catch blocks
3. On error: log the error with frame context (frame index, timestamp, file path), and continue to next frame
4. Track failed frames count and report at the end: `console.warn(\`${failedCount} of ${totalCount} frames failed VLM inference\`)`
5. Only throw/fail if ALL frames fail (no results at all)

**Verification**: `pnpm tsc --noEmit`

**Rollback**:
- Modified files: `git checkout -- src/actions/analyze-frames.ts`

---

### WU-18: Extract shared VLM output parser

**Dependencies**: none

**Context**: Both `src/adapters/intelligence.mlx.adapter.ts` and `src/adapters/intelligence.ollama.adapter.ts` contain similar `parseInterleavedOutput` logic that uses regex to parse VLM frame descriptions from interleaved batch output. The format is: `Frame N: description | activity: X | apps: [a, b] | topics: [x, y]`. This parsing logic should be shared.

**Files**:
- `src/utils/vlm-parser.ts` — create

**Steps**:
1. Read `src/adapters/intelligence.mlx.adapter.ts` lines 102-170 to find the exact `parseInterleavedOutput` function
2. Create `src/utils/vlm-parser.ts` with the extracted parsing logic
3. Export: `parseInterleavedOutput(rawText: string, expectedFrameCount: number): ParsedFrame[]`
4. Export the `ParsedFrame` type: `{ index: number; description: string; activity: string; apps: string[]; topics: string[]; raw_response?: string }`
5. Include the "Frame N:" regex pattern, pipe-delimiter splitting, apps/topics bracket parsing
6. Include the thinking tag stripping logic (`<think>...</think>` removal)
7. Do NOT modify the adapter files yet — that happens in a follow-up WU to avoid file overlap

**Verification**: `pnpm tsc --noEmit`

**Rollback**:
- Created files: `rm -f src/utils/vlm-parser.ts`

---

### WU-19: Fix XML injection in plist generation

**Dependencies**: none

**Context**: `src/actions/recorder-commands.ts` generates a LaunchAgent plist file (lines 114-161) by injecting environment variable values directly into XML. If any env var value contains XML special characters (`&`, `<`, `>`, `"`, `'`), the plist becomes invalid XML. For example, `ESCRIBANO_VLM_MODEL=model&version` would break the XML.

**Files**:
- `src/actions/recorder-commands.ts` — modify

**Steps**:
1. Add an XML escaping helper function at the top of the file:
   ```typescript
   function escapeXml(str: string): string {
     return str
       .replace(/&/g, '&amp;')
       .replace(/</g, '&lt;')
       .replace(/>/g, '&gt;')
       .replace(/"/g, '&quot;')
       .replace(/'/g, '&apos;');
   }
   ```
2. Find the plist generation section (approximately lines 127-132) where env var values are interpolated into the XML string
3. Wrap all value interpolations with `escapeXml()`: e.g., `<string>${value}</string>` → `<string>${escapeXml(value)}</string>`
4. Also apply to the program arguments path and log file paths in the plist

**Verification**: `pnpm tsc --noEmit`

**Rollback**:
- Modified files: `git checkout -- src/actions/recorder-commands.ts`

---

### WU-20: Fix Swift ObservationStore unchecked sqlite3_step

**Dependencies**: none

**Context**: In `apps/recorder/Sources/ObservationStore.sqlite.adapter.swift`, the `markFrameFailed` method (line 154) calls `sqlite3_step(stmt)` without checking the return code. If the UPDATE fails silently, the frame stays in "pending" state and gets retried forever. Additionally, lines 149-150 print errors instead of throwing, preventing callers from handling failures.

**Files**:
- `apps/recorder/Sources/ObservationStore.sqlite.adapter.swift` — modify

**Steps**:
1. Find the `markFrameFailed` method (approximately line 140-160)
2. After the `sqlite3_step(stmt)` call, add return code validation:
   ```swift
   let rc = sqlite3_step(stmt)
   guard rc == SQLITE_DONE else {
       throw ObservationStoreError.insertFailed(
           "Failed to mark frame \(id) as failed: \(String(cString: sqlite3_errmsg(handle)))"
       )
   }
   ```
3. Find lines 149-150 where errors are logged via `print()` instead of thrown. Change to throw the appropriate error type.
4. In the `saveObservations` method, wrap the insert loop in `BEGIN TRANSACTION` / `COMMIT`:
   ```swift
   sqlite3_exec(handle, "BEGIN TRANSACTION", nil, nil, nil)
   // ... existing insert loop ...
   sqlite3_exec(handle, "COMMIT", nil, nil, nil)
   ```

**Verification**: `cd apps/recorder && swift build -c release`

**Rollback**:
- Modified files: `git checkout -- apps/recorder/Sources/ObservationStore.sqlite.adapter.swift`

---

### WU-21: Add request ID validation in Swift PythonBridge

**Dependencies**: none

**Context**: In `apps/recorder/Sources/PythonBridge.vlm.adapter.swift`, the `sendAndReceive` method sends requests with incrementing `requestId` but doesn't validate that the response's `id` field matches. A malformed Python response could return the wrong `id` and Swift wouldn't detect the mismatch.

**Files**:
- `apps/recorder/Sources/PythonBridge.vlm.adapter.swift` — modify

**Steps**:
1. Find the `sendAndReceive` method (approximately lines 282-352)
2. Find where the response JSON is parsed (approximately lines 328-348 where it checks for `done: true`)
3. Before processing the response, add ID validation:
   ```swift
   if let responseId = json["id"] as? Int, responseId != requestId {
       log("Warning: response id \(responseId) does not match request id \(requestId)")
   }
   ```
4. This is a warning-only check (not an error), since the Python bridge currently has a single-connection model where responses always correspond to the latest request

**Verification**: `cd apps/recorder && swift build -c release`

**Rollback**:
- Modified files: `git checkout -- apps/recorder/Sources/PythonBridge.vlm.adapter.swift`

---

### WU-22: Add Python request-level timeout to mlx_bridge

**Dependencies**: none

**Context**: `scripts/mlx_bridge.py` (687 lines) is the Python MLX bridge that handles VLM and LLM inference. While TS (120s) and Swift (180s) have client-side timeouts, Python has no timeout on individual inference calls. If a model hangs mid-generation, the socket blocks forever and the Python process must be force-killed.

**Files**:
- `scripts/mlx_bridge.py` — modify

**Steps**:
1. Find the VLM inference function (approximately line 411-414 where `vlm_infer` is handled)
2. Find the LLM inference function (approximately lines 441-561)
3. Add a timeout mechanism using Python's `signal` module:
   ```python
   import signal

   class InferenceTimeout(Exception):
       pass

   def timeout_handler(signum, frame):
       raise InferenceTimeout("Inference timed out")
   ```
4. Before each inference call, set an alarm: `signal.signal(signal.SIGALRM, timeout_handler)` and `signal.alarm(300)` (5 minutes — generous, since client-side is 120s/180s)
5. After inference completes (or in a finally block), clear the alarm: `signal.alarm(0)`
6. Catch `InferenceTimeout` and send an error response: `{"id": request_id, "error": "Inference timed out after 300s", "done": true}`
7. Note: `signal.alarm()` only works on Unix (macOS/Linux), which is the target platform

**Verification**: `python3 -c "import signal; signal.alarm(1); signal.alarm(0); print('OK')"` (verify signal.alarm works)

**Rollback**:
- Modified files: `git checkout -- scripts/mlx_bridge.py`

---

### WU-23: Fix migration transaction safety

**Dependencies**: none

**Context**: `src/db/migrate.ts` runs SQL migrations without wrapping each one in a transaction. If a migration has 3 SQL statements and statement 2 fails, statement 1 is already committed — leaving the DB in an inconsistent state. Additionally, migration file sorting uses string sort (`.sort()`) which would break at version 100+ (e.g., "9_" sorts after "10_").

**Files**:
- `src/db/migrate.ts` — modify

**Steps**:
1. Find the migration execution loop (approximately lines 74-118)
2. Find where `db.exec(migration.sql)` is called (approximately line 98)
3. Wrap in a transaction using better-sqlite3's API:
   ```typescript
   const runMigration = db.transaction(() => {
     db.exec(migration.sql);
     // Update version tracking
   });
   runMigration();
   ```
4. Find the file sorting logic (approximately lines 43-68) where `.sort()` is called on migration filenames
5. Replace with numeric sort: extract the version number prefix and sort numerically:
   ```typescript
   .sort((a, b) => {
     const numA = parseInt(a.split('_')[0] || a.split('-')[0], 10);
     const numB = parseInt(b.split('_')[0] || b.split('-')[0], 10);
     return numA - numB;
   })
   ```

**Verification**: `pnpm tsc --noEmit && pnpm vitest run`

**Rollback**:
- Modified files: `git checkout -- src/db/migrate.ts`

---

### WU-24: Fix MLX cleanup safety (process.once + double-cleanup guard)

**Dependencies**: WU-9

**Context**: `src/adapters/intelligence.mlx.adapter.ts` registers cleanup handlers on `process.on('exit')`, `process.on('SIGINT')`, etc. (lines ~329-333). Using `process.on()` means handlers accumulate if the service is re-initialized. Also, a global `globalCleanup` variable is shared without protection against double-invocation.

**Files**:
- `src/adapters/intelligence.mlx.adapter.ts` — modify

**Steps**:
1. Find the cleanup handler registration (approximately lines 329-333)
2. Replace `process.on('exit', ...)` with `process.once('exit', ...)`
3. Replace `process.on('SIGINT', ...)` with `process.once('SIGINT', ...)`
4. Replace `process.on('SIGTERM', ...)` with `process.once('SIGTERM', ...)`
5. Add a cleanup guard at the top of the cleanup function:
   ```typescript
   let cleanupDone = false;
   const cleanup = (): void => {
     if (cleanupDone) return;
     cleanupDone = true;
     // ... existing cleanup logic
   };
   ```
6. Also add stale socket check before spawning: if socket file exists and no process is running, remove it before attempting to spawn a new bridge

**Verification**: `pnpm tsc --noEmit && pnpm vitest run src/tests/intelligence.mlx.adapter.test.ts`

**Rollback**:
- Modified files: `git checkout -- src/adapters/intelligence.mlx.adapter.ts`

---

### WU-25: Create coding standards documentation

**Dependencies**: WU-8, WU-15

**Context**: The codebase has strong established patterns but they're not documented. New contributors (or AI agents) need a reference for conventions covering TypeScript, Swift, and cross-language integration.

**Files**:
- `docs/coding-standards.md` — create

**Steps**:
1. Create `docs/coding-standards.md` with sections for TypeScript, Swift, and Cross-Language patterns
2. TypeScript patterns:
   - Port/Adapter naming: `[port].[implementation].adapter.ts`
   - Factory functions over classes: `createXxxService()` returning typed interfaces
   - Service purity: `src/services/` = no I/O, no `process.env`. Orchestration in `src/actions/`
   - Pipeline observability: `withPipeline()` + `step()` from `pipeline/context.ts`
   - Config access: Always `loadConfig()`, never `process.env.ESCRIBANO_*` directly
   - Logger: `createLogger(prefix)` from `utils/logger.ts`
   - Error types: Domain errors from `domain/errors.ts`
   - Resume safety: Checkpoint to DB; `INSERT OR IGNORE` for idempotency
3. Swift patterns:
   - Actor model: FrameAnalyzer, PythonBridge, ObservationStore
   - Port/Adapter: `FrameStore.port.swift` / `FrameStore.sqlite.adapter.swift`
   - Error enums with `LocalizedError`
   - ResumeFlag pattern for CheckedContinuation safety
   - Independent timer for timeouts (not date-check in handler)
4. Cross-Language patterns:
   - NDJSON over Unix domain sockets
   - Bridge lifecycle: lazy start, stays loaded, killed on exit
   - SQLite WAL mode for concurrent access
   - `PRAGMA user_version` for schema versioning

**Verification**: `test -f docs/coding-standards.md && echo "OK"`

**Rollback**:
- Created files: `rm -f docs/coding-standards.md`

---

## Execution Plan

### Phase 1 — Tests (parallel, no dependencies)
- WU-1: Test temporal-alignment service
- WU-2: Test app-normalization service
- WU-3: Test domain recording state machine
- WU-4: Test domain time-range value object
- WU-5: Test config loading

### Phase 2 — Dead code + Logger + Errors (parallel, no dependencies)
- WU-6: Delete dead code (debug service + utils)
- WU-7: Delete dead code (adapter + action + types)
- WU-8: Create centralized logger utility
- WU-15: Create error type hierarchy

### Phase 3 — Logger adoption + standalone fixes (parallel, requires Phase 2)
- WU-9: Replace debugLog in MLX adapter (depends: WU-8)
- WU-10: Replace debugLog in Ollama + FFmpeg adapters (depends: WU-8)
- WU-12: Centralize env vars in services/pipeline
- WU-16: Fix error handling in sync-to-outline
- WU-17: Fix error handling in analyze-frames
- WU-18: Extract shared VLM output parser

### Phase 4 — Config centralization + Types split part 1 (parallel, requires Phase 3)
- WU-11: Centralize env vars in FFmpeg adapter (depends: WU-10)
- WU-13: Split 0_types.ts — schemas

### Phase 5 — Types split part 2 (sequential, requires Phase 4)
- WU-14: Split 0_types.ts — ports + repositories + barrel (depends: WU-13)

### Phase 6 — Multi-language fixes (parallel, no file overlap)
- WU-19: Fix XML injection in plist generation
- WU-20: Fix Swift ObservationStore unchecked sqlite3_step
- WU-21: Add request ID validation in Swift PythonBridge
- WU-22: Add Python request-level timeout

### Phase 7 — Resource management (parallel, requires Phase 3)
- WU-23: Fix migration transaction safety
- WU-24: Fix MLX cleanup safety (depends: WU-9)

### Phase 8 — Documentation (requires all previous phases)
- WU-25: Create coding standards documentation

## Recovery Strategy

- **Automatic**: Each implementor rolls back and retries once on failure.
- **Dependency failure**: If a work unit fails and later units depend on it, those later units will not run. The orchestrator will report which units were skipped.
- **Global rollback**: `git reset HEAD~N --hard` where N is the number of committed work units, or use `git revert` to undo individual WU commits non-destructively.
- **Independent failures**: Work units with no dependency on a failed unit will still execute.
- **Test safety**: Phase 1 tests provide regression detection for all subsequent phases. If Phase 2+ changes break behavior, tests will fail.
