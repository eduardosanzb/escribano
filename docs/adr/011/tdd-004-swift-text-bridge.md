# TDD-004: Swift Text Bridge for Session Aggregation

## 1. Goal

Enable Swift to request text-only generation from the already-loaded VLM bridge so the future SessionAggregator can share the same Python process as frame analysis.

## 2. Why this shape

- One bridge process is cheaper than separate VLM + LLM processes.
- The recorder already owns a long-lived Python bridge lifecycle.
- `text_infer` keeps prompt generation in the same runtime and avoids a second model load.

## 3. Protocol

```swift
protocol TextGenerationService: AnyObject, Sendable {
    func start() async throws
    func generate(prompt: String, maxTokens: Int) async throws -> TextGenerationResult
    func stop() async
    nonisolated func terminateSync()
}
```

This is separate from `VLMInferenceService` because the consumer needs a smaller contract.

## 4. Python contract

`mlx_bridge.py` in `--mode vlm` should accept:

```json
{"id":1,"method":"text_infer","params":{"prompt":"...","maxTokens":800}}
```

Response:

```json
{"id":1,"text":"...","stats":{"prompt_tokens":0,"generation_tokens":0,"total_tokens":0,"generate_time_s":1.2},"done":true}
```

This is a dedicated `text_infer` request on the VLM bridge, not a reused `llm_infer` path.

## 5. Findings from the POC

- Swift can already speak to the bridge over the same socket the recorder uses.
- `--mode vlm` does not need a second daemon; it can expose a text-only request alongside `vlm_infer`.
- The naive `mlx_vlm.generate(..., image=None)` path is not enough for Qwen3-VL: the VLM processor still initializes the vision stack, which pulls in PyTorch/Torchvision requirements.
- The bridge-side fix is to dispatch `text_infer` to the loaded model's text backbone and tokenizer, while keeping the same long-lived process and socket.
- That preserves the recorder's single-bridge design and avoids loading a second model just to generate artifacts.

## 6. POC layout

Standalone package:

```text
scripts/poc-swift-text-bridge/
```

Contains a small Swift actor adapter that copies the existing socket/NDJSON pattern from the recorder.

## 7. Key architecture decision

The current Python bridge is single-connection and long-lived. That means the recorder must share one adapter instance across frame analysis and future text generation.

Recommended Phase 3a shape:

```swift
let bridge = PythonBridgeVLMAdapter()
let analyzer = FrameAnalyzer(obsStore: obsStore, vlmService: bridge)
let aggregator = SessionAggregator(store: obsStore, textService: bridge)
```

## 8. Implementation contract

- `text_infer` lives in the VLM bridge contract.
- `vlm_infer` remains unchanged for frame analysis.
- Swift can call either request type over the existing socket protocol.
- No separate LLM bridge is required for the recorder path.
- Existing VLM frame analysis stays unchanged.

## 9. Follow-up

If the POC is good, extend the recorder adapter with a text-generation method and wire `SessionAggregator` to the same bridge instance.
