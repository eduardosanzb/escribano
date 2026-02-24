# Screen Capture Pipeline — Project Context

## Goal
Build a real-time screen capture pipeline that:
- Captures screen frames and audio (system + mic) continuously
- Filters out duplicate/similar frames to avoid redundant processing
- Pushes unique frames and audio chunks to a queue
- Processes them asynchronously on a CPU-only cluster using VLM (vision) and Whisper (audio)

---

## Architecture Overview

```
LOCAL MACHINE
─────────────────────────────────────────────
User triggers UI
    │
    ▼
Rust Capture Process
  ┌──────────────┐    ┌─────────────┐
  │ Screen       │───▶│ Filter/Diff │
  │ Capture      │    │ (pHash)     │
  │ Thread       │    └──────┬──────┘
  └──────────────┘           │
                              ▼
                     ┌──────────────┐
                     │JPEG Compress │
                     └──────┬───────┘
                             │
  ┌──────────────┐           │
  │ Audio        │           │
  │ (System+Mic) │───────────┤
  └──────────────┘           │
                              ▼
                     MESSAGE QUEUE (Redis / RabbitMQ)
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
    VLM Worker 1        VLM Worker 2        VLM Worker 3   ...
    (CPU)               (CPU)               (CPU)
    Whisper Worker      Whisper Worker      Whisper Worker
          │                   │                   │
          └───────────────────┴───────────────────┘
                              │
                              ▼
                      Results Store (DB / S3)
                      frames + transcripts + VLM output
```

---

## Language & Why Rust

- Chosen for tight capture loop, zero GC pauses, true threading
- Go considered but GC micro-stutters undesirable for frame capture
- Rust gives full control over memory and native API bindings

---

## Screen Capture

**Crate:** `scap` (open-sourced by Cap.so / CapSoftware)
- Cross-platform, wraps native APIs per OS:
  - macOS → ScreenCaptureKit
  - Windows → Windows.Graphics.Capture
  - Linux → PipeWire (X11 fallback)

**Starting platform:** macOS, then Windows and Linux.

**Retina note:** macOS captures at 2x resolution. Scale down before diff, keep original for sending.

```rust
// Scale down for diff only
let small = imageops::resize(&frame, 320, 200, imageops::FilterType::Nearest);
```

---

## Frame Filtering / Deduplication

Current workflow (batch): grab full video → ffmpeg scene detection → extract different frames.

Real-time equivalent: compare each captured frame against the last kept frame using pHash.

**Approach:** perceptual hash (pHash) via `img_hash` crate
- Compute 64-bit hash per frame
- Compare via Hamming distance
- Threshold: Hamming distance > 5–10 = meaningfully different
- Calibrate against ffmpeg's `scene > 0.3` threshold you already use

```rust
fn is_different_enough(prev: &[u8], current: &[u8], threshold: f32) -> bool {
    let diff: u64 = prev.iter()
        .zip(current.iter())
        .map(|(a, b)| (*a as i16 - *b as i16).unsigned_abs() as u64)
        .sum();
    let mean_diff = diff as f32 / prev.len() as f32;
    mean_diff > threshold
}
```

---

## Audio Capture

Two separate streams captured in parallel:

**System Audio:**
- macOS → `screencapturekit` crate, `.captures_audio(true)` on `SCStreamConfiguration`. No BlackHole or virtual driver needed. Requires macOS 13.0+.
- Windows → WASAPI loopback via `cpal`
- Linux → PulseAudio/PipeWire monitor source via `cpal`

**Microphone:**
- All platforms → `cpal` crate

Both streams timestamped with the same clock as frames for later correlation.

---

## Audio Transcription — Real-time Whisper

Whisper can process audio in real-time using **sliding window chunks**:
- Send overlapping chunks of 5–10 seconds continuously
- Overlap handles words on chunk boundaries

**Options for CPU cluster:**
- `whisper.cpp` — C++ port, HTTP server mode, runs well on CPU
- `faster-whisper` — Python, CTranslate2 backend, fastest on CPU
- `WhisperLive` — purpose-built for real-time streaming transcription

**Model recommendation for real-time on CPU:** `tiny` or `base` models run faster than real-time even on CPU. Re-transcribe offline with larger model for accuracy if needed.

---

## VLM Analysis (CPU Cluster)

**Recommended models for CPU inference:**
- `LLaVA` — general purpose, good quality
- `Moondream` — tiny, designed for efficiency, great for CPU
- `Qwen-VL` — strong performance

**Runtime:** `llama.cpp` — heavily optimized for CPU (AVX2/AVX512), runs quantized models efficiently.

**Cluster distribution:** each worker pulls frames from the shared queue independently. Scale horizontally by adding machines.

VLM prompt = frame image + Whisper transcript for that time window → richer analysis.

---

## Internal Thread Pipeline (Rust)

```
Capture Thread → crossbeam channel → Filter Thread → crossbeam channel → API/Queue Send Thread
```

- `crossbeam-channel` preferred over `std::mpsc` for performance
- Queue acts as buffer: if VLM workers are slower than capture rate, frames accumulate and process eventually without blocking capture

---

## Key Dependencies

```toml
[dependencies]
scap = "*"                                        # screen capture, cross-platform
screencapturekit = "*"                            # macOS system audio
cpal = "*"                                        # mic (all OS), system audio (Win/Linux)
img_hash = "3.2"                                  # perceptual hashing
image = "0.25"                                    # image processing
turbojpeg = "1.1"                                 # fast JPEG compression (needs libjpeg-turbo)
crossbeam-channel = "0.5"                         # fast inter-thread channels
tokio = { version = "1", features = ["full"] }    # async runtime
redis = { version = "0.25", features = ["tokio-comp"] }  # queue push
```

---

## OS Considerations

| Feature | macOS | Windows | Linux |
|---|---|---|---|
| Screen capture | ScreenCaptureKit (needs permission) | DXGI — works out of box | X11 fine, Wayland limited |
| System audio | ScreenCaptureKit native (macOS 13+) | WASAPI loopback | PulseAudio/PipeWire monitor |
| Mic | cpal | cpal | cpal |
| Retina/scaling | 2x resolution, scale down for diff | DPI scaling varies | varies |

---

## Open Questions / Next Steps

- [ ] Scaffold Rust project with `scap` capture loop
- [ ] Implement pHash filter and calibrate threshold
- [ ] Add audio capture threads (system + mic)
- [ ] Set up Redis queue and push logic
- [ ] Set up CPU cluster workers with llama.cpp + VLM model
- [ ] Set up Whisper workers (whisper.cpp or faster-whisper)
- [ ] Sync frame + transcript timestamps in results store
- [ ] Handle macOS screen recording permission on startup
- [ ] Handle Wayland on Linux if needed
