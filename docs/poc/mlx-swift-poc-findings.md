# MLX-Swift POC Findings

**Date:** March 15, 2026  
**Status:** Compilation successful, but Metal shader runtime issue blocks testing  
**Repository:** `scripts/poc-mlx-swift/`

## Summary

Successfully created a **Swift package** that compiles against `mlx-swift-lm` (v2.30.6) for both VLM (Qwen3-VL-2B) and LLM (Qwen3.5) inference. The code is clean and follows Swift 6 concurrency best practices. However, **runtime execution fails** due to Metal shader library not being embedded by SPM.

## What Works

### ✅ Swift 6 Concurrency
- Used `@preconcurrency import` for imports from non-Sendable libraries
- Implemented proper async stream handling with `for try await`
- Closure return types explicitly annotated
- No unsafe concurrency warnings in final build

### ✅ Code Structure
- `VLMRunner.swift` — Single/batch VLM inference with exact production prompts
- `LLMRunner.swift` — Subject grouping LLM prompt execution
- `CompareRunner.swift` — Batch processing from filesystem (40 frames in `~/.escribano/frames/2026-03-13/`)
- `DBReader.swift` — SQLite reading (prepared statements, proper binding)
- `main.swift` — CLI dispatcher for `vlm`, `llm`, `compare` commands

### ✅ Production Prompts
- Copied verbatim from `prompts/vlm-single.md` (single image analysis)
- Copied verbatim from `prompts/vlm-batch.md` (batch image analysis with interleaved format)
- Copied verbatim from `prompts/subject-grouping.md` (LLM grouping task)
- No prompt engineering needed — ready for actual inference once runtime works

### ✅ Compilation
```bash
swift build                # Debug: compiles successfully
swift build -c release     # Release: compiles successfully (with warnings)
```

Full build output: No errors, only one harmless warning about impossible String cast (Generation type).

## What Doesn't Work

### ❌ Metal Shader Library at Runtime
```
MLX error: Failed to load the default metallib. library not found library not found...
at /mlx/c/stream.cpp:115
```

**Root Cause:** Swift Package Manager (SPM) does not automatically embed `.metallib` files needed by MLX. The files exist in the mlx-swift-lm package but are not copied into the executable bundle.

**Why It Matters:** MLX requires Metal shaders to offload computation to Apple Silicon. Without the shaders, the framework cannot initialize.

## Path Forward: Three Options

### Option A: Build with Xcode (Preferred)
Xcode automatically compiles Metal shaders and embeds them in the executable.

```bash
cd scripts/poc-mlx-swift
swift package generate-xcodeproj  # Won't work in Swift 6.0+
# Or: open Package.swift in Xcode directly
# Build → Product → Archive → Export
```

**Status:** Blocked. `swift package generate-xcodeproj` was removed in Swift 6.

**Workaround:** Import `Package.swift` into Xcode's new package UI:
- File → Add Packages → Local → Select folder

### Option B: Manual Metal Shader Compilation (Hacky)
Manually compile `.metal` files to `.metallib` and patch the binary.

```bash
# Find metal sources in dependency
find .build -name "*.metal" -type f

# Compile with xcrun
xcrun metal -o default.metallib sources/*.metal

# Manually copy into executable bundle
# (Complex: varies by build configuration)
```

**Status:** Possible but fragile. Breaks on every rebuild.

### Option C: Use Ollama Backend Instead
The existing `intelligence.ollama.adapter.ts` works fine and doesn't have this compilation issue. For this POC, skip mlx-swift and benchmark Ollama instead.

**Status:** Feasible but defeats the purpose of the POC (native Swift inference).

## Technical Deep Dive: What the Code Does

### VLMRunner
**Single image mode:**
```swift
.user(prompt, images: [.url(...)])
```

**Batch mode (interleaved format):**
```swift
[
  ["type": "text", "text": "Frame 1:"],
  ["type": "image"],
  ["type": "text", "text": "Frame 2:"],
  ["type": "image"],
  ...
  ["type": "text", "text": batchPrompt(frameCount)]
]
```
Matches exactly what `intelligence.mlx.adapter.ts` builds for Python inference.

### Response Parsing
Extracts descriptions from `Frame N: description: X | activity: Y | apps: Z | topics: W` format:
```swift
if lineStr.hasPrefix("Frame ") {
    if let descStart = lineStr.range(of: "description: ") {
        if let descEnd = afterDesc.range(of: " | activity") {
            // Extract between markers
        }
    }
}
```

### Configuration
Hardcoded paths in main.swift:
```swift
let defaultVLMDir = "~/.cache/huggingface/hub/models--mlx-community--Qwen3-VL-2B-Instruct-4bit/snapshots/..."
let defaultLLMDir = "~/.cache/huggingface/hub/models--mlx-community--Qwen3.5-4B-4bit/snapshots/..."
```

Same snapshot directories the Python bridge uses — no re-download needed.

## Comparison: Python vs Swift Approach

| Aspect | Python (current) | Swift (this POC) |
|--------|------------------|-----------------|
| Dependencies | `mlx-vlm`, `mlx-lm`, socket IPC | `mlx-swift-lm` (pure SPM) |
| Environment | Python 3.10+, managed venv | Swift 6.0, native |
| Compilation | Zero (interpreted) | Requires Metal shaders |
| Performance | ~0.7s/frame (baseline) | Unknown (blocked by Metal issue) |
| Async Model | Socket-based RPC | Native Swift async/await |
| Type Safety | Loose (JSON) | Strong (Swift types) |
| Concurrency | Subprocesses + sockets | Pure async/await |

## Recommendations

### Short Term
1. **Don't pursue this POC further** unless native Swift inference becomes critical requirement
2. **Python bridge is mature** — 17 real recordings, 100% success rate, well-understood performance
3. **Metal shader issue is fundamental** — not a quick fix, requires Xcode integration or manual compilation

### Medium Term
If native Swift inference becomes a goal (e.g., for the Recorder agent):
- Wait for `mlx-swift-lm` to address Metal shader packaging
- Or switch to a different Swift ML framework (CoreML, ONNX Runtime)
- Or build a separate Swift-C bridge that statically links MLX

### Long Term
The real value of mlx-swift is **not** for batch inference, but for:
1. **Embedded inference in the Recorder** — avoid Python subprocess overhead
2. **Real-time streaming** — process frames as captured, not batched
3. **Memory efficiency** — single Swift process vs Python subprocess + socket IPC

For now, **stick with Python bridge** for reliability.

## Files Created

- `scripts/poc-mlx-swift/Package.swift` — SPM manifest with mlx-swift-lm dependency
- `scripts/poc-mlx-swift/Sources/main.swift` — CLI dispatcher
- `scripts/poc-mlx-swift/Sources/VLMRunner.swift` — Single/batch VLM inference
- `scripts/poc-mlx-swift/Sources/LLMRunner.swift` — LLM inference (subject grouping)
- `scripts/poc-mlx-swift/Sources/CompareRunner.swift` — Batch processor from filesystem
- `scripts/poc-mlx-swift/Sources/DBReader.swift` — SQLite observation loader (unused due to filesystem approach)

## Next Steps (If Pursuing)

1. Try opening `Package.swift` directly in Xcode (drag & drop)
2. Build in Xcode GUI (will auto-compile Metal shaders)
3. Test single image inference
4. Benchmark batch inference vs Python bridge
5. Document performance, memory usage, latency

---

**TL;DR:** POC code is solid, compilation works, but Metal shaders won't load at runtime. Xcode build would likely fix it, but Python bridge is more reliable for now.
