# TDD Review Issues — All 3 Documents

Generated from session: TDD review notes compilation and improvement plan.

---

## TDD-001: Fotógrafo Capture Agent (✅ COMPLETE)

All 8 issues resolved and applied to `/docs/tdd/001-swift-capture-agent.md`.

### [TDD-001-A] ✅ Downgrade macOS minimum target to 14.0
**Section**: §2  
**Status**: DONE

Updated from macOS 15.0 → 14.0 with research-backed rationale:
- macOS 14 (Sonoma) covers ~80% of Mac users (Statcounter, early 2024)
- `SCStream` available since macOS 12.3 (no blockers)
- macOS 15-only features (SCContentSharingPicker, HDR, monthly privacy prompts) can be adopted via `@available` checks later

---

### [TDD-001-B] ✅ Change default frame interval to 1s with adaptive backpressure
**Section**: §3.1  
**Status**: DONE

- Changed `CMTime(value: 5, timescale: 1)` → `CMTime(value: 1, timescale: 1)`
- Explained that **pHash dedup is the real throttle**: frames within hamming distance ≤8 are automatically skipped
- Backpressure pauses/resumes the stream based on unanalyzed queue depth, not a fixed interval

---

### [TDD-001-C] ✅ Add explanation of kCVPixelFormatType_32BGRA
**Section**: §3.1  
**Status**: DONE

Added inline explanation:
- 32-bit pixel format: Blue, Green, Red, Alpha (4 bytes)
- ScreenCaptureKit delivers natively in this format on Apple Silicon
- Used directly without conversion to feed into pHash DCT pipeline
- Minimizes CPU overhead before deduplication

---

### [TDD-001-DE] ✅ Strengthen pHash rationale; document library alternatives
**Section**: §3.2  
**Status**: DONE

- Quoted ADR-009 Phase C findings (pHash threshold ≤8 separates noise from content, hamming distances 0–4 for noise, 10+ for real activity)
- Evaluated and rejected alternatives:
  - **dHash**: Blind to clock ticks / localized digit changes
  - **VN FeaturePrint**: 4.5–6.5ms overhead per frame (too heavy)
  - **SCFrameStatus**: Only ~1% frame firing rate (unreliable)
- Documented libraries explored:
  - ImageHash (Swift, requires dependency)
  - Python imagehash (requires Python bridge)
- Explained why DIY via vDSP: zero extra deps, ~50 lines Swift, self-contained

---

### [TDD-001-FH] ✅ Document origin of WAL pragma values + backpressure thresholds
**Section**: §3.3 + §3.5  
**Status**: DONE

**WAL Mode Configuration**:
- `PRAGMA journal_mode = WAL` — Allows concurrent reads while writes progress
- `PRAGMA busy_timeout = 5000` — 5s timeout for lock contention (vs default 0)
- `PRAGMA wal_autocheckpoint = 1000` — Checkpoint after 1000 frames (~17 min at 1fps)

**Backpressure Thresholds**:
- **High-water: 500 frames** (~25–50 MB unanalyzed at typical JPEG compression)
- **Low-water: 100 frames** (~5–10 MB, comfortable operating point, hysteresis prevents thrashing)
- Trade-off: Conservative values, analyzer should rarely trigger backpressure if working normally

---

### [TDD-001-G] ✅ Define migration bootstrap strategy
**Section**: §3.4  
**Status**: DONE

Added **Migration Bootstrap Strategy** subsection:
1. Swift agent queries `PRAGMA user_version` on startup
2. If version < expected: logs error, exits with code 1
3. LaunchAgent plist `KeepAlive=true` retries, but fails until user runs `escribano recorder install`
4. Makes dependency explicit and observable; prevents silent schema corruption

---

### [TDD-001-I] ✅ Design production installer strategy
**Section**: §4.1  
**Status**: DONE

- **MVP Scope**: Dev-mode, compiles from source via `swift build -c release`, requires Xcode
- **Production Path (Deferred)**: Pre-compiled universal binary via:
  - Signed `.pkg` installer with auto-updates
  - npm `postinstall` script downloading binary from GitHub Releases
- Noted: Code signing, binary hosting, update mechanics deferred to later phase

---

### [TDD-001-K] ✅ Rename Swift binary to "Fotógrafo"
**Section**: §2 + §6 (new)  
**Status**: DONE

- Updated title: "TDD-001: **Fotógrafo** Capture Agent"
- Added naming section (§6) explaining Spanish theme consistency
- Updated all references: `ProgramArguments=[<path_to_fotografo_binary>]`, test specs, overview
- **Fotógrafo** (The Photographer) parallels **Escribano** (The Scribe)

---

## TDD-002: Node Batch Analyzer (⏳ PENDING)

### [TDD-002-A] Add sequence diagram for analyzer data flow
**Section**: §1  
**Priority**: High  
**Scope**: Add mermaid sequence diagram showing:
- frames table → claimFrames lock
- VLM batch inference
- observations insert (with frame_id FK)
- markAnalyzed / markFailed result

**Suggested flow**:
```
Analyzer -->> FrameRepository: claimFrames(20)
FrameRepository -->> DB: SELECT id FROM frames WHERE analyzed=0 LIMIT 20
DB -->> Analyzer: [frame records]
Analyzer -->> VLM: describeFrames([...])
VLM -->> Analyzer: [FrameDescription[...]]
Analyzer -->> DB: INSERT INTO observations (type='visual', frame_id, vlm_description, ...)
DB -->> Analyzer: OK
Analyzer -->> FrameRepository: markAnalyzed(ids)
FrameRepository -->> DB: UPDATE frames SET analyzed=1 WHERE id IN (...)
```

---

### [TDD-002-B] Add rationale for frame_id FK and indexing strategy
**Section**: §3.1  
**Priority**: Medium  
**Scope**: Add 2–3 paragraphs before SQL block explaining:
- Why FK to frames table (maintains referential integrity, prevents orphaned observations)
- Query patterns enabled: "find all observations for a frame", "find frames for an observation"
- Indexing strategy: `idx_observations_frame_id` enables O(log N) lookups on frame_id (currently observations queried only by recording_id, but frame_id FK opens new analysis paths)

---

### [TDD-002-C] Add error handling pseudocode to analyze-frames action
**Section**: §3.3  
**Priority**: High  
**Scope**: Add pseudocode block showing try/catch/finally placement:

```typescript
// Pseudocode structure for analyze-frames.ts
try {
  releaseStale Locks(10 min)
  lockId = generateUUIDv7()
  claimedFrames = claimFrames(20, lockId)
  if (claimedFrames.length === 0) exit(0)
  
  try {
    observations = await describeFrames(claimedFrames)
    for each (obs, frame) {
      insert into observations table
      delete jpeg from disk
    }
    markAnalyzed(claimedFrames.map(f => f.id))
  } catch (vlmError) {
    // VLM failure: increment retry_count for all claimed frames
    for each frame in claimedFrames {
      if (frame.retry_count >= 3) {
        markFailed(frame.id)  // Set analyzed=2, failed_at=now
      } else {
        increment retry_count, release lock
      }
    }
  }
  
  // Filesystem error during observation write:
  // Caught at outer try, all claimed frames remain locked
  // Next run's releaseStaleLocks(10) will free them to retry
  
} finally {
  unloadVlm()
}
```

---

### [TDD-002-D] Clarify process model: ephemeral runs, no tick/worker split
**Section**: §3.3 + §3.4  
**Priority**: High  
**Scope**: Add explicit note clarifying:
- Each launchd invocation is a single ephemeral process: **claim → process → unload model → exit**
- Concurrency handled by launchd `StartInterval` (not internal scheduling)
- If a run is in progress when launchd fires again, `processing_lock_id` prevents double-claiming
- Stale lock cleanup is automatic on the next run (via `releaseStaleLocks`)
- **Why no tick/worker split**: MVP does not need this; launchd provides the tick, single ephemeral process provides the worker

---

## TDD-003: Segmentation & CLI (⏳ PENDING)

### [TDD-003-A] Add data-flow diagram for observations → segments → artifacts
**Section**: §1  
**Priority**: High  
**Scope**: Add mermaid timeline or sequence diagram showing:
- Visual/audio observations collected over time
- Segmentation groups by activity continuity
- Synthetic recording created
- Artifact generation
- artifact_segments join table linking summary back to segments

---

### [TDD-003-B] Add plain-English description of segments table
**Section**: §3.1  
**Priority**: Medium  
**Scope**: Add 2–3 sentence summary before SQL block:

> `segments` stores discrete work periods identified by activity type and extracted from VLM-analyzed frames. Each segment represents a contiguous span of related activity (e.g., "coding in VS Code for 23 minutes"). For always-on recorder runs, `segments` replaces `topic_blocks` as the primary unit of work state. `artifact_segments` is a join table that links generated artifacts (summaries) back to the segments they were derived from, enabling auditability and cross-session analysis.

---

### [TDD-003-C] Add sequence diagram + pseudocode for `escribano cut`
**Section**: §3.4  
**Priority**: High  
**Scope**: Add both mermaid diagram and pseudocode:

**Diagram**: Show flow from `--from` + `--to` args → parse time → fetch observations → create synthetic recording → segment → generate artifact → link artifact_segments

**Pseudocode**:
```typescript
// escribano cut --from 2h --to now --format standup

// Step 1: Resolve time arguments
fromEpoch = parseTimeArg("2h")    // now - 2h
toEpoch = now()

// Step 2: Fetch observations for time range
obsFrames = db.query(
  "SELECT * FROM observations WHERE frame_id IS NOT NULL 
   AND timestamp BETWEEN ? AND ? ORDER BY timestamp ASC",
  [fromEpoch, toEpoch]
)
if (obsFrames.length === 0) {
  console.warn("No observations found for time range")
  exit(1)
}

// Step 3: Create synthetic recording
synthRecording = {
  id: generateId(),
  sourceType: "recorder",
  videoPath: null,
  capturedAt: ISO(fromEpoch),
  duration: toEpoch - fromEpoch,
  status: "processed"
}
db.insert("recordings", synthRecording)

// Step 4: Segment observations
segments = segmentByActivity(obsFrames)

// Step 5: Save segments to DB
db.saveBatch(
  "segments",
  segments.map(seg => ({
    id: generateId(),
    recording_id: synthRecording.id,
    start_time: seg.startTime,
    end_time: seg.endTime,
    activity_type: seg.activity,
    apps: JSON.stringify(seg.apps),
    topics: JSON.stringify(seg.topics),
    classification: JSON.stringify(seg.fullContext)
  }))
)

// Step 6: Generate artifact via existing pipeline
artifact = await generateSummaryV3(synthRecording, format="standup")

// Step 7: Link artifact to segments
for each segment {
  db.insert("artifact_segments", {
    artifact_id: artifact.id,
    segment_id: segment.id
  })
}

// Step 8: Output
console.log(`Artifact: ${artifact.filePath}`)
if (--stdout) console.log(artifact.markdown)
if (--copy) clipboard.copy(artifact.markdown)
```

---

### [TDD-003-D] Rename capture.recorder.adapter.ts
**Section**: §3.5  
**Priority**: Low  
**Scope**: Decide and document a better name

**Candidates**:
- `capture.always-on.adapter.ts` — describes the always-on nature (but not unique to recorder)
- `capture.fotografo.adapter.ts` — names it after the capture source (thematic)
- `capture.continuous.adapter.ts` — descriptive of the capture mode
- `capture.synthetic.adapter.ts` — emphasizes that recordings are synthetic (no video file)

**Recommendation**: `capture.fotografo.adapter.ts` (consistent with "Fotógrafo" capture agent naming)

---

### [TDD-003-E] Add pseudocode + risk list for artifact compatibility bridging
**Section**: §4  
**Priority**: Medium  
**Scope**: 

**Rationale**: Currently, `generate-summary-v3.ts` queries `DbTopicBlock` to build artifacts. For recorder runs (which produce `segments` instead of `topic_blocks`), we need a dispatch strategy.

**Option A: Alias at query time** (chosen for MVP)
```typescript
// In generate-summary-v3.ts

async function generateSummaryV3(recording: DbRecording, format: string) {
  let blocks: ITopicBlock[]
  
  if (recording.sourceType === "recorder") {
    // Fetch segments instead of topic_blocks
    blocks = db.segments
      .findByRecording(recording.id)
      .map(seg => ({  // Adapt segment to topic block interface
        id: seg.id,
        topicLabel: `${seg.activity_type}: ${seg.topics.join(", ")}`,
        startTime: seg.start_time,
        endTime: seg.end_time,
        // ... other fields adapted
      }))
  } else {
    blocks = db.topicBlocks.findByRecording(recording.id)
  }
  
  // Generate artifact from blocks (same code path)
  return generateArtifact(blocks, recording, format)
}
```

**Risks**:
| Risk | Mitigation | Priority |
|------|-----------|----------|
| **Schema drift**: `DbSegment` and `DbTopicBlock` diverge | Keep interface adapter lightweight, add comprehensive tests for both paths | High |
| **Dual-path maintenance**: Two ways to populate artifacts, testing burden | Write schema-agnostic tests (prefer interface tests, avoid DB schema tests) | High |
| **Query performance**: Segment queries may not have same indexes as topic_blocks | Ensure `idx_segments_recording` and `idx_segments_time_range` are applied; monitor query plans | Medium |
| **Future refactor**: Eventually merge segments and topic_blocks into one table? | Defer to Phase 4; add TODO comment in code | Low |

---

## Summary

| TDD | Tasks | Status |
|-----|-------|--------|
| **TDD-001** | 8/8 | ✅ COMPLETE |
| **TDD-002** | 0/4 | ⏳ PENDING |
| **TDD-003** | 0/5 | ⏳ PENDING |

**Next Session**: Review and apply TDD-002 and TDD-003 issues.

