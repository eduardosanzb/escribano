#!/usr/bin/env python3
"""
MLX-VLM Bridge for Escribano

A Unix domain socket server that provides interleaved VLM batch processing.
Communicates with TypeScript via NDJSON (newline-delimited JSON).

Usage:
    python3 scripts/mlx_bridge.py

Environment Variables:
    ESCRIBANO_VLM_MODEL       - MLX model name (default: mlx-community/Qwen3-VL-2B-Instruct-bf16)
    ESCRIBANO_VLM_BATCH_SIZE  - Frames per batch (default: 4)
    ESCRIBANO_VLM_MAX_TOKENS  - Token budget per batch (default: 2000)
    ESCRIBANO_MLX_SOCKET_PATH - Unix socket path (default: /tmp/escribano-mlx.sock)
    ESCRIBANO_VERBOSE         - Enable verbose logging (default: false)
"""

import json
import os
import re
import signal
import socket
import sys
import time
from typing import Any

# Configuration from environment
MODEL_NAME = os.environ.get(
    "ESCRIBANO_VLM_MODEL", "mlx-community/Qwen3-VL-2B-Instruct-bf16"
)
BATCH_SIZE = int(os.environ.get("ESCRIBANO_VLM_BATCH_SIZE", "4"))
MAX_TOKENS = int(os.environ.get("ESCRIBANO_VLM_MAX_TOKENS", "2000"))
SOCKET_PATH = os.environ.get("ESCRIBANO_MLX_SOCKET_PATH", "/tmp/escribano-mlx.sock")
VERBOSE = os.environ.get("ESCRIBANO_VERBOSE", "false").lower() == "true"
TEMPERATURE = 0.3

# Global state
model = None
processor = None
config = None
server_socket = None


def log(message: str, level: str = "info") -> None:
    """Log message with [MLX] prefix."""
    if level == "debug" and not VERBOSE:
        return
    prefix = {"info": "[MLX]", "error": "[MLX] ERROR:", "debug": "[MLX] DEBUG:"}.get(
        level, "[MLX]"
    )
    print(f"{prefix} {message}", file=sys.stderr, flush=True)


def cleanup() -> None:
    """Clean up socket file on exit."""
    global server_socket
    if server_socket:
        try:
            server_socket.close()
        except Exception:
            pass
    if os.path.exists(SOCKET_PATH):
        try:
            os.unlink(SOCKET_PATH)
            log(f"Removed socket: {SOCKET_PATH}", "debug")
        except Exception as e:
            log(f"Failed to remove socket: {e}", "error")


def signal_handler(signum: int, frame: Any) -> None:
    """Handle shutdown signals."""
    log(f"Received signal {signum}, shutting down...")
    cleanup()
    sys.exit(0)


def load_model() -> tuple[Any, Any, Any]:
    """Load MLX-VLM model."""
    log(f"Loading model: {MODEL_NAME}")
    log("This may take 30-60 seconds on first run or after memory clear...")
    start = time.time()

    try:
        log("Importing mlx_vlm...", "debug")
        from mlx_vlm import load
        from mlx_vlm.utils import load_config

        log("Loading model weights into memory (this takes the longest)...", "debug")
        model_obj, processor_obj = load(MODEL_NAME)
        
        log("Loading model config...", "debug")
        config_obj = load_config(MODEL_NAME)

        duration = time.time() - start
        log(f"Model loaded in {duration:.1f}s")

        return model_obj, processor_obj, config_obj
    except ImportError as e:
        log(f"Failed to import mlx_vlm: {e}", "error")
        log("Install with: pip install mlx-vlm", "error")
        sys.exit(1)
    except Exception as e:
        log(f"Failed to load model: {e}", "error")
        sys.exit(1)


def send_response(conn: socket.socket, obj: dict) -> None:
    """Send JSON response over socket."""
    try:
        data = json.dumps(obj) + "\n"
        conn.sendall(data.encode("utf-8"))
        log(f"Sent response: {obj.get('id', '?')} batch={obj.get('batch', '?')}", "debug")
    except Exception as e:
        log(f"Failed to send response: {e}", "error")


def parse_vlm_response(content: str) -> dict:
    """
    Parse pipe-delimited VLM response.

    Format: description: ... | activity: ... | apps: [...] | topics: [...]
    """
    result = {
        "description": "",
        "activity": "unknown",
        "apps": [],
        "topics": [],
    }

    if not content or content.strip().startswith("Error:"):
        return result

    # Same regex as production TypeScript code
    pattern = r"^description:\s*(.+?)\s*\|\s*activity:\s*(.+?)\s*\|\s*apps:\s*(\[.+?\]|[^|]+)\s*\|\s*topics:\s*(.+)$"
    match = re.match(pattern, content, re.DOTALL)

    if match:
        apps_str = re.sub(r"^\[|\]$", "", match[3].strip())
        topics_str = re.sub(r"^\[|\]$", "", match[4].strip())

        result["description"] = match[1].strip()
        result["activity"] = match[2].strip()
        result["apps"] = list(set(s.strip() for s in apps_str.split(",") if s.strip()))
        result["topics"] = list(set(s.strip() for s in topics_str.split(",") if s.strip()))
    else:
        # Fallback: use content as description
        result["description"] = content.strip()

    return result


def process_interleaved_batch(
    model_obj: Any, processor_obj: Any, config_obj: Any, batch: list[dict]
) -> list[dict]:
    """
    Process a batch of frames using interleaved multi-image prompts.

    Returns list of frame results with parsed descriptions.
    """
    from mlx_vlm import generate
    from mlx_vlm.prompt_utils import get_chat_template

    # Build interleaved message structure
    content = []
    for idx, frame in enumerate(batch):
        frame_num = idx + 1
        timestamp = frame.get("timestamp", "unknown")

        # Add text label
        content.append({"type": "text", "text": f"Frame {frame_num} (timestamp: {timestamp}s):"})
        # Add image placeholder
        content.append({"type": "image"})

    # Add final prompt with instructions
    final_prompt = f"""Analyze these {len(batch)} screenshots from a screen recording.

For each frame above, provide:
- description: What's on screen? Be specific about content, text, and UI elements.
- activity: What is the user doing?
- apps: Which applications are visible?
- topics: What topics, projects, or technical subjects?

Output in this exact format for each frame:
Frame 1: description: ... | activity: ... | apps: [...] | topics: [...]
Frame 2: description: ... | activity: ... | apps: [...] | topics: [...]
...and so on for all {len(batch)} frames."""
    content.append({"type": "text", "text": final_prompt})

    # Build message
    messages = [{"role": "user", "content": content}]

    # Apply chat template
    prompt = get_chat_template(processor_obj, messages, add_generation_prompt=True)

    # Generate with multiple images
    output = generate(
        model_obj,
        processor_obj,
        prompt,
        image=[f["imagePath"] for f in batch],
        temperature=TEMPERATURE,
        max_tokens=MAX_TOKENS,
        verbose=False,
    )

    # Extract text from output
    if hasattr(output, "text"):
        content_text = output.text
    elif isinstance(output, str):
        content_text = output
    else:
        content_text = str(output)

    # Parse results for each frame
    return parse_interleaved_output(content_text, batch)


def parse_interleaved_output(text: str, batch: list[dict]) -> list[dict]:
    """Parse interleaved multi-frame output into individual results."""
    results = []

    for frame_num in range(1, len(batch) + 1):
        frame = batch[frame_num - 1]

        # Look for "Frame N: description: ..." pattern
        pattern = rf"Frame {frame_num}:\s*description:\s*(.+?)\s*\|\s*activity:\s*(.+?)\s*\|\s*apps:\s*(\[.+?\]|[^|]+)\s*\|\s*topics:\s*(.+?)(?=Frame \d+:|$)"
        match = re.search(pattern, text, re.DOTALL)

        if match:
            apps_str = re.sub(r"^\[|\]$", "", match[3].strip())
            topics_str = re.sub(r"^\[|\]$", "", match[4].strip())

            results.append({
                "index": frame.get("index", frame_num - 1),
                "timestamp": frame["timestamp"],
                "imagePath": frame["imagePath"],
                "description": match[1].strip(),
                "activity": match[2].strip(),
                "apps": [s.strip() for s in apps_str.split(",") if s.strip()],
                "topics": [s.strip() for s in topics_str.split(",") if s.strip()],
            })
        else:
            results.append({
                "index": frame.get("index", frame_num - 1),
                "timestamp": frame["timestamp"],
                "imagePath": frame["imagePath"],
                "description": f"Failed to parse Frame {frame_num}",
                "activity": "unknown",
                "apps": [],
                "topics": [],
                "raw_response": text,
            })

    return results


def handle_describe_images(
    conn: socket.socket, model_obj: Any, processor_obj: Any, config_obj: Any, params: dict, request_id: int
) -> None:
    """Handle describe_images request with streaming batch responses."""
    images = params.get("images", [])
    batch_size = params.get("batchSize", BATCH_SIZE)
    total = len(images)

    if total == 0:
        send_response(conn, {"id": request_id, "error": "No images provided", "done": True})
        return

    log(f"Processing {total} images in batches of {batch_size}")

    # Process in batches
    for batch_idx in range(0, total, batch_size):
        batch = images[batch_idx : batch_idx + batch_size]
        batch_num = batch_idx // batch_size + 1

        try:
            log(f"Processing batch {batch_num}: frames {batch_idx + 1}-{min(batch_idx + batch_size, total)}")

            results = process_interleaved_batch(model_obj, processor_obj, config_obj, batch)

            # Stream response immediately
            is_partial = batch_idx + batch_size < total
            send_response(conn, {
                "id": request_id,
                "batch": batch_num,
                "results": results,
                "partial": is_partial,
                "progress": {"current": batch_idx + len(batch), "total": total},
            })

        except Exception as e:
            log(f"Batch {batch_num} failed: {e}", "error")
            send_response(conn, {
                "id": request_id,
                "batch": batch_num,
                "error": str(e),
                "partial": batch_idx + batch_size < total,
                "progress": {"current": batch_idx + len(batch), "total": total},
            })

    # Final done signal
    send_response(conn, {"id": request_id, "done": True})


def handle_request(
    conn: socket.socket, model_obj: Any, processor_obj: Any, config_obj: Any, data: str
) -> None:
    """Parse and route incoming request."""
    try:
        request = json.loads(data)
        request_id = request.get("id", 0)
        method = request.get("method", "")
        params = request.get("params", {})

        log(f"Received request: id={request_id} method={method}", "debug")

        if method == "describe_images":
            handle_describe_images(conn, model_obj, processor_obj, config_obj, params, request_id)
        elif method == "shutdown":
            log("Shutdown requested")
            send_response(conn, {"id": request_id, "status": "shutting_down"})
            cleanup()
            sys.exit(0)
        else:
            send_response(conn, {"id": request_id, "error": f"Unknown method: {method}"})

    except json.JSONDecodeError as e:
        log(f"Invalid JSON: {e}", "error")
        send_response(conn, {"error": f"Invalid JSON: {e}"})
    except Exception as e:
        log(f"Request handling error: {e}", "error")
        send_response(conn, {"error": str(e)})


def main() -> None:
    """Main entry point."""
    global model, processor, config, server_socket

    # Set up signal handlers
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)

    # Clean up any existing socket
    cleanup()

    # Load model
    model, processor, config = load_model()

    # Create socket
    server_socket = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server_socket.bind(SOCKET_PATH)
    server_socket.listen(1)

    log(f"Listening on {SOCKET_PATH}")

    # Signal ready (for parent process to detect)
    print(json.dumps({"status": "ready", "model": MODEL_NAME}), flush=True)

    # Accept connections
    while True:
        try:
            conn, _ = server_socket.accept()
            log("Client connected", "debug")

            buffer = ""
            while True:
                try:
                    chunk = conn.recv(65536)
                    if not chunk:
                        break

                    buffer += chunk.decode("utf-8")

                    # Process complete lines
                    while "\n" in buffer:
                        line, buffer = buffer.split("\n", 1)
                        if line.strip():
                            handle_request(conn, model, processor, config, line)

                except ConnectionResetError:
                    log("Client disconnected", "debug")
                    break
                except Exception as e:
                    log(f"Connection error: {e}", "error")
                    break

            conn.close()
            log("Client disconnected", "debug")

        except Exception as e:
            log(f"Accept error: {e}", "error")
            continue


if __name__ == "__main__":
    main()
