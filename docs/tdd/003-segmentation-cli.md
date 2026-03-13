# TDD-003: Segmentation & CLI

## 1. Overview

This document specifies the design for the Segmentation pipeline and CLI interactions (Phase 3). It introduces
`segments` as an immutable, append-only record of work sessions, generates "synthetic recordings" for
continuous capture, and adds the `escribano cut` command to generate session summaries from arbitrary time
ranges.

_review_note: we should add a diagram here showing the flow of data from observations being captured, to
segments being generated, to synthetic recordings being created, and finally to artifacts being produced. This
would help clarify the architecture and data flow for readers who are more visually oriented. The diagram
should use a timeline or sequence flow to illustrate how segments are created from observations and how they
relate to recordings and artifacts._

## 2. Architecture & File Structure

- **Database Interfaces**: `src/db/repositories/segment.sqlite.ts`
- **Migration**: `src/db/migrations/016_segments.sql`
- **Capture Adapter**: `src/adapters/capture.recorder.adapter.ts`
- **Action**: `src/actions/cut-session.ts`
- **CLI**: `src/index.ts` -> `escribano cut`

## 3. Core Components

### 3.1 Database Migration (016)

_review_note: please just a summary of what is this table for and how it relates to the existing tables, such
as recordings and artifacts_

```sql
CREATE TABLE segments (
  id              TEXT PRIMARY KEY,
  recording_id    TEXT REFERENCES recordings(id),
  start_time      REAL NOT NULL,
  end_time        REAL NOT NULL,
  activity_type   TEXT NOT NULL,
  apps            TEXT,                -- JSON array
  topics          TEXT,                -- JSON array
  classification  TEXT,                -- JSON context payload
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_segments_recording ON segments(recording_id);
CREATE INDEX idx_segments_time_range ON segments(start_time, end_time);

CREATE TABLE artifact_segments (
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  segment_id  TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  PRIMARY KEY (artifact_id, segment_id)
);
CREATE INDEX idx_artifact_segments_segment ON artifact_segments(segment_id);
```

### 3.2 Segment Repository (`SegmentRepository`)

Defined in `src/db/repositories/segment.sqlite.ts`.

- `saveBatch(segments: DbSegment[])`
- `findByRecording(recordingId: string): DbSegment[]`

### 3.3 Synthetic Recordings

Continuous capture doesn't have discrete video files, so we generate a "synthetic recording" to satisfy
existing artifact pipelines.

- When `escribano cut` is run, we insert a synthetic recording into the DB:
  ```typescript
  const synthRecording = {
    id: generateId(),
    sourceType: "recorder", // Discriminator
    videoPath: null,
    capturedAt: formatISO(fromTimestamp),
    duration: toTimestamp - fromTimestamp,
    status: "processed",
  };
  ```
- `generate-summary-v3.ts` remains unaware of the difference; it just expects a recording row and its related
  block groupings.

### 3.4 The Cut Command (`escribano cut`)

_review_note: we should add a diagram here showing the flow of the cut command, from parsing the time
arguments, to fetching observations, to creating segments, to generating artifacts, and finally to linking
everything together. This would help clarify the architecture and data flow for readers who are more visually
oriented. The diagram should use a sequence flow to illustrate how each step leads to the next._ _review_note:
we should also add pseudocode for the main steps in the flow, especially for how we resolve time arguments,
how we query observations, and how we generate segments and artifacts. This would provide more clarity on the
implementation details and help guide developers who will be working on this feature._

- **Trigger**: `escribano cut --from <time> --to <time> [--format <format>]`
  - `<time>` can be relative (e.g., `2h`, `30m` = ago) or exact ISO timestamps.
  - Default bounds if omitted: `from: 4h` (4 hours ago), `to: now`.
- **Flow (Automatic)**:
  1. Resolve `--from` and `--to` into Unix epoch timestamps (`REAL`).
  2. Fetch all `observations` where `frame_id IS NOT NULL` and `timestamp BETWEEN from AND to`.
  3. If 0 observations found, exit with warning.
  4. Generate and save synthetic `recording`.
  5. Call existing `segmentByActivity(observations)` to get `Segment[]`.
  6. Save `Segment[]` linked to `recording.id`.
  7. Call `generateSummaryV3(recording)` (which handles LLM subject grouping and Markdown generation).
  8. Link the generated artifact ID to the segment IDs via `artifact_segments`.
  9. Print the result file path / print to stdout.

### 3.5 Recorder Capture Adapter (`capture.recorder.adapter.ts`)

_review_note: the naming is a bit meh_

- Implements `CaptureSource` interface.
- `getLatestRecording()`: Fetches the most recently generated synthetic recording (where
  `sourceType = 'recorder'`).
- `listRecordings()`: Returns all synthetic recordings.

## 4. Artifact Compatibility Bridging

Currently, `generate-summary-v3.ts` queries `DbTopicBlock`.

- **Refactor Plan**: `DbSegment` is semantically equivalent to `DbTopicBlock`. To avoid duplicating artifact
  generation logic, we will modify `subject.sqlite.ts` and `generate-summary-v3.ts` to query `segments`
  directly (instead of `topic_blocks`) for recordings where `source_type == 'recorder'`, or alias them
  entirely. The MVP will simply adapt `generateSummaryV3` to load segments for recorder runs. _review_note: we
  should also put pseudo code and list that consider the risks_

## 5. Test Specs

- **Cut Time Parsing**: Test `parseTimeArg('2h')` computes correctly against the current date.
- **End-to-End Pipeline**: Insert mock visual observations with `frame_id`s. Call `cut --from 1h --to now`.
  Verify:
  1. A synthetic recording is created.
  2. Segments are accurately bounded.
  3. The generated artifact is linked in `artifact_segments`.
- **Immutability**: Calling `cut` twice over overlapping time ranges should create _two independent_ synthetic
  recordings, with _duplicated_ segments. This enforces the append-only rule.
