# TDD-005: Runtime Model Download Strategy

## 1. Overview
To ensure the `.dmg` download remains small, AI models (e.g., `mlx-community/Qwen3-VL-2B-Instruct-4bit`) are fetched asynchronously at runtime when Escribano starts.

## 2. Architecture
1. **Startup Check**: On launch, the Swift agent checks the local model directory (e.g., `~/.escribano/models/` or `Application Support`).
2. **Async Downloader**: If the model is missing, a background `Task` invokes `huggingface_hub` via the embedded Python interpreter to download the model weights. This reuses the same Python environment already shipped for MLX and handles large file resumption, LFS pointers, and progress reporting natively. Command: `python_env/bin/python3 -m huggingface_hub download <repo-id> --local-dir ~/.escribano/models/<model-name>`.
3. **Recorder Backpressure**: During the download, the VLM Analyzer is paused. The Recorder continues to capture screens based on `SCStream` intervals and deduplication (pHash), buffering them into the SQLite database.
4. **Resumption**: Once the download completes and validates, the VLM Analyzer task wakes up and begins working through the buffered `frames` table.

## 3. User Experience
- The user is completely isolated from the terminal download process.
- (Future UI) The menu bar icon can display a distinct state: `Downloading AI Models...` alongside a progress indicator.
