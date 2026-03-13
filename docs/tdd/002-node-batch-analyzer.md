# TDD-002: Node Batch Analyzer

## 1. Overview

This document specifies the design for the Node Batch Analyzer (Phase 2). It periodically polls the `frames`
table, claims unanalyzed frames, passes them through the existing `vlm-service.ts`, and creates `observations`
with foreign keys to the frames.

_review_note: we should have a diagram showing the flow from frames being captured, to being claimed by the
analyzer, to being processed by the VLM, and finally resulting in observations. This would help clarify the
architecture and data flow for readers who are more visually oriented. the diagram should use a timeline or
squence flow_

## 2. Architecture & File Structure

- **Database Interfaces**: `src/db/repositories/frame.sqlite.ts`
- **Migration**: `src/db/migrations/015_observations_frame_fk.sql`
- **Action**: `src/actions/analyze-frames.ts`
- **CLI**: `src/index.ts` -> `escribano analyze`
- **Plist**: `com.escribano.analyze.plist` (managed in Phase 1's install command)

## 3. Core Components

### 3.1 Database Migration (015)

_review_note: we should add more details on the rationale behind this migration, such as why we chose to add a
foreign key to the frames table, and how this will help with data integrity and query performance when linking
observations to their corresponding frames. Additionally, we could include a brief explanation of the indexing
strategy and how it will optimize queries that join observations with frames._

```sql
ALTER TABLE observations ADD COLUMN frame_id TEXT REFERENCES frames(id);
CREATE INDEX igx_observations_frame_id ON observations(frame_id);
```

### 3.2 Frame Repository (`FrameRepository`)

Defined in `src/db/repositories/frame.sqlite.ts`.

- `claimFrames(limit: number, lockId: string): DbFrame[]`
  - Executes:
    ```sql
    UPDATE frames
    SET processing_lock_id = ?, processing_started_at = datetime('now')
    WHERE id IN (
        SELECT id FROM frames
        WHERE analyzed = 0 AND processing_lock_id IS NULL
        ORDER BY timestamp ASC LIMIT ?
    ) RETURNING *
    ```
- `markAnalyzed(ids: string[])` -> Sets `analyzed = 1`, clears locks.
- `markFailed(id: string)` -> Increments `retry_count`. If `retry_count >= 3`, sets `analyzed = 2`,
  `failed_at = datetime('now')`. Clears locks.
- `releaseStaleLocks(timeoutMinutes: number)` ->
  `UPDATE frames SET processing_lock_id = NULL, processing_started_at = NULL WHERE processing_started_at < datetime('now', '-? minutes') AND analyzed = 0 AND processing_lock_id IS NOT NULL`

### 3.3 The Analyze Action (`analyze-frames.ts`)

_review_note: here maybe we should add then the diagram; also what about the error handling? we should be
explicit; show the pseudocode for teh try/catch/finally blocks and where we call markFailed, markAnalyzed, and
releaseStaleLocks in case of different types of errors (VLM failure, file system errors, etc.)_

- **Trigger**: `escribano analyze`
- **Step 1**: Run `releaseStaleLocks(10)` (10 minute timeout).
- **Step 2**: Generate UUIDv7 for `lockId`.
- **Step 3**: `claimFrames(20, lockId)`. If 0 frames, gracefully exit `0`.
- **Step 4**: Format frames for VLM: map `image_path` and `timestamp`.
- **Step 5**: Invoke `describeFrames(frames, intelligenceService)`.
- **Step 6**: For each `FrameDescription`:
  - Insert into `observations` (`type = 'visual'`, `frame_id = frame.id`, `vlm_description`, `activity_type`,
    etc.).
  - Remove JPEG from disk (`fs.unlink`).
- **Step 7**: Call `markAnalyzed` on successful frame IDs. Catch errors and call `markFailed` for failed IDs.
- **Step 8**: Unload model (`intelligenceService.unloadVlm()`).

### 3.4 LaunchAgent Plist (`com.escribano.analyze.plist`)

- Created during `escribano recorder install` (implemented in Phase 1 but used here).
- `StartInterval=120` (runs every 2 minutes).
- `ProgramArguments`: `[node, <path_to_escribano_dist>, analyze]`.

## 4. Error Handling & Edge Cases

- **VLM Failure**: If the VLM throws (OOM, parse error), catch at the batch level. Increment `retry_count`.
  Max retries = 3.
- **Crash during VLM**: Handled by `releaseStaleLocks` on the next run.
- **Disk Full during Observation Write**: SQLite will throw. VLM work is lost. Stale lock cleanup will retry
  it later.
- **Memory Footprint**: Process is ephemeral (spawned by launchd, runs VLM, unloads, exits). It does not leak
  memory over days like a long-running Node process might.

## 5. Test Specs

- **Mock DB Claiming**: Create a test DB with 25 pending frames. Assert `claimFrames` locks exactly 20.
- **Stale locks recovery**: Set a frame's `processing_started_at` to 15 mins ago, ensure `releaseStaleLocks`
  frees it, and it gets claimed again.
- **File Deletion**: Ensure successfully analyzed frames have their `image_path` file unlinked to save disk
  space.
- **Retry limit**: Mock a VLM failure 3 times, verify frame state becomes `analyzed = 2`.

_review_note: also did we consider splitting or im still not understantin lets say im running the analyuzer
then it fills teh batcha nd starts; what with the next iteration of the analizer? does it spawas again? or did
we block aor tis the same process? what if it fails? shall we not split actually in 2 process a "tick" and
then the "worker"?_
