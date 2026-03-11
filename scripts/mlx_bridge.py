#!/usr/bin/env python3
"""
MLX Bridge for Escribano

A Unix domain socket server that provides VLM and/or LLM inference.
Communicates with TypeScript via NDJSON (newline-delimited JSON).

Usage:
    python3 scripts/mlx_bridge.py --mode vlm   # VLM-only (frame analysis)
    python3 scripts/mlx_bridge.py --mode llm   # LLM-only (text generation)

Environment Variables:
    ESCRIBANO_VLM_MODEL       - MLX VLM model name (default: mlx-community/Qwen3-VL-2B-Instruct-4bit)
    ESCRIBANO_VLM_BATCH_SIZE  - Frames per batch (default: 2)
    ESCRIBANO_VLM_MAX_TOKENS  - Token budget per batch (default: 4000)
    ESCRIBANO_MLX_SOCKET_PATH - Unix socket path (default: /tmp/escribano-mlx.sock)
    ESCRIBANO_VERBOSE         - Enable verbose logging (default: false)
"""

import argparse
import json
import os
import re
import signal
import socket
import sys
import time
from pathlib import Path
from typing import Any, Literal

# Configuration from environment (all defaults come from TypeScript config.ts)
MODEL_NAME = os.environ.get(
    "ESCRIBANO_VLM_MODEL", "mlx-community/Qwen3-VL-2B-Instruct-4bit"
)
BATCH_SIZE = int(os.environ.get("ESCRIBANO_VLM_BATCH_SIZE", "2"))
MAX_TOKENS_VLM = int(os.environ.get("ESCRIBANO_VLM_MAX_TOKENS", "4000"))

SOCKET_PATH = os.environ.get("ESCRIBANO_MLX_SOCKET_PATH", "/tmp/escribano-mlx.sock")
VERBOSE = os.environ.get("ESCRIBANO_VERBOSE", "false").lower() == "true"
TEMPERATURE = 0.3

# Bridge mode (set via --mode flag)
BridgeMode = Literal["vlm", "llm"]
BRIDGE_MODE: BridgeMode = "vlm"

# Shutdown flag for graceful exit
shutting_down = False


def find_project_root() -> Path:
    """Find the project root by walking up from the script location."""
    current = Path(__file__).resolve().parent
    for _ in range(5):  # Walk up max 5 levels
        if (current / "package.json").exists():
            return current
        current = current.parent
    # Fallback: assume current working directory
    return Path.cwd()




# Global state
model = None
processor = None
config = None
llm_model = None
llm_tokenizer = None
llm_loaded_model_name = None
server_socket = None


def log(message: str, level: str = "info") -> None:
    """Log message with [MLX] prefix."""
    if level == "debug" and not VERBOSE:
        return
    prefix = {"info": "[MLX]", "error": "[MLX] ERROR:", "debug": "[MLX] DEBUG:"}.get(
        level, "[MLX]"
    )
    print(f"{prefix} {message}", file=sys.stderr, flush=True)




def load_llm_model(model_name: str) -> tuple[Any, Any]:
    """Load an MLX text-only LLM model via mlx_lm."""
    log(f"Loading LLM model: {model_name}")
    log("This may take 30-120 seconds on first run or after memory clear...")
    start = time.time()

    try:
        import gc
        import mlx.core as mx

        log("Importing mlx_lm...", "debug")
        from mlx_lm import load
        import mlx_lm

        log("Loading model weights into memory (this takes the longest)...", "debug")
        model_obj, tokenizer_obj = load(model_name)

        duration = time.time() - start
        log(f"LLM model loaded in {duration:.1f}s")
        log(f"mlx_lm version: {mlx_lm.__version__}")

        return model_obj, tokenizer_obj
    except ImportError as e:
        log(f"Failed to import mlx_lm: {e}", "error")
        log(f"Python used: {sys.executable}", "error")
        custom_python = os.environ.get("ESCRIBANO_PYTHON_PATH")
        if custom_python:
            log(
                "ESCRIBANO_PYTHON_PATH is set, so Escribano does not auto-install mlx-lm "
                "into this Python environment.",
                "error",
            )
            log(
                f"Make sure mlx-lm is installed for that Python "
                f"(e.g. `{custom_python} -m pip install mlx-lm`), "
                "or unset ESCRIBANO_PYTHON_PATH to let Escribano manage its own Python.",
                "error",
            )
        raise
    except Exception as e:
        log(f"Failed to load LLM model: {e}", "error")
        raise


def unload_vlm() -> None:
    """Free VLM memory before loading LLM."""
    global model, processor, config
    log("Unloading VLM model to free memory", "debug")
    try:
        import gc
        import mlx.core as mx

        model = None
        processor = None
        config = None
        gc.collect()
        mx.metal.clear_cache()  # Apple Silicon memory cleanup
        log("VLM unloaded successfully", "debug")
    except Exception as e:
        log(f"Error unloading VLM: {e}", "error")


def unload_llm() -> None:
    """Free LLM memory after generation."""
    global llm_model, llm_tokenizer, llm_loaded_model_name
    log("Unloading LLM model to free memory", "debug")
    try:
        import gc
        import mlx.core as mx

        llm_model = None
        llm_tokenizer = None
        llm_loaded_model_name = None
        gc.collect()
        mx.metal.clear_cache()  # Apple Silicon memory cleanup
        log("LLM unloaded successfully", "debug")
    except Exception as e:
        log(f"Error unloading LLM: {e}", "error")


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
    global shutting_down
    log(f"Received signal {signum}, shutting down...")
    shutting_down = True
    cleanup()
    sys.exit(0)


def load_model() -> tuple[Any, Any, Any]:
    """Load MLX-VLM model."""
    log(f"Loading model: {MODEL_NAME}")
    log("This may take 30-120 seconds on first run or after memory clear...")
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
        log(f"Python used: {sys.executable}", "error")
        custom_python = os.environ.get("ESCRIBANO_PYTHON_PATH")
        if custom_python:
            log(
                "ESCRIBANO_PYTHON_PATH is set, so Escribano does not auto-install mlx-vlm "
                "into this Python environment.",
                "error",
            )
            log(
                f"Make sure mlx-vlm is installed for that Python "
                f"(e.g. `{custom_python} -m pip install mlx-vlm`), "
                "or unset ESCRIBANO_PYTHON_PATH to let Escribano manage its own Python.",
                "error",
            )
        else:
            log(
                "mlx-vlm is missing from Escribano's managed Python environment. "
                "It is normally installed automatically.",
                "error",
            )
            log(
                "Try restarting Escribano so it can recreate or repair its Python environment. "
                "If the problem persists, install `mlx-vlm` into this Python or report an issue.",
                "error",
            )
        sys.exit(1)
    except Exception as e:
        log(f"Failed to load model: {e}", "error")
        sys.exit(1)


def send_response(conn: socket.socket, obj: dict) -> None:
    """Send JSON response over socket."""
    try:
        data = json.dumps(obj) + "\n"
        conn.sendall(data.encode("utf-8"))
        log(
            f"Sent response: {obj.get('id', '?')} batch={obj.get('batch', '?')}",
            "debug",
        )
    except Exception as e:
        log(f"Failed to send response: {e}", "error")




def handle_vlm_infer(
    conn: socket.socket,
    model_obj: Any,
    processor_obj: Any,
    config_obj: Any,
    params: dict,
    request_id: int,
) -> None:
    """
    Handle vlm_infer request - process a single batch of images.
    
    Input: params["messages"] - standard chat array with images
    Output: raw text string + stats
    """
    from mlx_vlm import generate
    from mlx_vlm.prompt_utils import get_chat_template

    global model, processor, config

    # Reload model if it was unloaded (lazy reload after unload_vlm)
    if model_obj is None:
        log("VLM model was unloaded, reloading...")
        model, processor, config = load_model()
        model_obj, processor_obj, config_obj = model, processor, config

    try:
        messages = params.get("messages", [])
        max_tokens = params.get("maxTokens", MAX_TOKENS_VLM)

        if not messages:
            send_response(
                conn, {"id": request_id, "error": "No messages provided", "done": True}
            )
            return

        log(f"Processing VLM inference request", "debug")

        # Apply chat template
        prompt = get_chat_template(processor_obj, messages, add_generation_prompt=True)

        t_start = time.time()

        # Generate - extract image paths from messages
        image_paths = []
        for msg in messages:
            if isinstance(msg.get("content"), list):
                for item in msg["content"]:
                    if item.get("type") == "image" and "imagePath" in item:
                        image_paths.append(item["imagePath"])

        output = generate(
            model_obj,
            processor_obj,
            prompt,
            image=image_paths if image_paths else None,
            temperature=TEMPERATURE,
            max_tokens=max_tokens,
            verbose=VERBOSE,
        )

        t_end = time.time()
        generate_time = t_end - t_start

        # Extract text from output
        if hasattr(output, "text"):
            response_text = output.text
        elif isinstance(output, str):
            response_text = output
        else:
            response_text = str(output)

        # Build stats dict from GenerationResult
        stats = {
            "prompt_tokens": getattr(output, "prompt_tokens", 0),
            "generation_tokens": getattr(output, "generation_tokens", 0),
            "total_tokens": getattr(output, "total_tokens", 0),
            "prompt_tps": getattr(output, "prompt_tps", 0.0),
            "generation_tps": getattr(output, "generation_tps", 0.0),
            "peak_memory_gb": getattr(output, "peak_memory", 0.0),
            "generate_time_s": generate_time,
        }

        if VERBOSE:
            log(
                f"  Prompt: {stats['prompt_tokens']} tokens @ {stats['prompt_tps']:.1f} tok/s",
                "debug",
            )
            log(
                f"  Gen: {stats['generation_tokens']} tokens @ {stats['generation_tps']:.1f} tok/s",
                "debug",
            )
            log(f"  Time: {generate_time:.2f}s", "debug")
            log(f"  Peak memory: {stats['peak_memory_gb']:.2f} GB", "debug")

        send_response(
            conn,
            {
                "id": request_id,
                "text": response_text,
                "stats": stats,
                "done": True,
            },
        )

    except Exception as e:
        log(f"VLM inference failed: {e}", "error")
        send_response(
            conn, {"id": request_id, "error": str(e), "done": True}
        )



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

        # Validate method compatibility with bridge mode
        if BRIDGE_MODE == "llm" and method == "vlm_infer":
            send_response(
                conn,
                {
                    "id": request_id,
                    "error": "vlm_infer not available in LLM-only mode",
                    "done": True,
                },
            )
            return

        if BRIDGE_MODE == "vlm" and method == "llm_infer":
            send_response(
                conn,
                {
                    "id": request_id,
                    "error": "llm_infer not available in VLM-only mode",
                    "done": True,
                },
            )
            return

        if method == "vlm_infer":
            handle_vlm_infer(
                conn, model_obj, processor_obj, config_obj, params, request_id
            )
        elif method == "load_llm":
            global llm_model, llm_tokenizer, llm_loaded_model_name
            try:
                llm_model, llm_tokenizer = load_llm_model(params.get("model", ""))
                llm_loaded_model_name = params.get("model", "")
                send_response(
                    conn, {"id": request_id, "status": "loaded", "done": True}
                )
            except Exception as e:
                send_response(conn, {"id": request_id, "error": str(e), "done": True})
        elif method == "unload_vlm":
            try:
                unload_vlm()
                send_response(
                    conn, {"id": request_id, "status": "unloaded", "done": True}
                )
            except Exception as e:
                send_response(conn, {"id": request_id, "error": str(e), "done": True})
        elif method == "unload_llm":
            try:
                unload_llm()
                send_response(
                    conn, {"id": request_id, "status": "unloaded", "done": True}
                )
            except Exception as e:
                send_response(conn, {"id": request_id, "error": str(e), "done": True})
        elif method == "llm_infer":
            if llm_model is None or llm_tokenizer is None:
                send_response(
                    conn,
                    {"id": request_id, "error": "LLM model not loaded", "done": True},
                )
            else:
                try:
                    from mlx_lm import generate
                    from mlx_lm.sample_utils import make_sampler

                    messages = params.get("messages", [])
                    raw_prompt = params.get("rawPrompt")
                    max_tokens = params.get("maxTokens", 8000)
                    temperature = params.get("temperature", 0.7)
                    think = params.get("think", False)

                    # Determine prompt source and apply chat template
                    if raw_prompt:
                        # Apply chat template to raw prompt
                        chat_messages = [{"role": "user", "content": raw_prompt}]
                        prompt = llm_tokenizer.apply_chat_template(
                            chat_messages,
                            tokenize=False,
                            add_generation_prompt=True,
                            chat_template_kwargs={"enable_thinking": think},
                        )
                        log(
                            f"Applied chat template to raw prompt (think={think}, temp={temperature})",
                            "debug",
                        )
                    elif messages:
                        # Apply chat template to messages array
                        prompt = llm_tokenizer.apply_chat_template(
                            messages,
                            tokenize=False,
                            add_generation_prompt=True,
                            chat_template_kwargs={"enable_thinking": think},
                        )
                        log(
                            f"Applied chat template to messages (think={think}, temp={temperature})",
                            "debug",
                        )
                    else:
                        send_response(
                            conn,
                            {
                                "id": request_id,
                                "error": "No prompt provided (need 'rawPrompt' or 'messages')",
                                "done": True,
                            },
                        )
                        return

                    if not prompt:
                        send_response(
                            conn,
                            {
                                "id": request_id,
                                "error": "Empty prompt after template",
                                "done": True,
                            },
                        )
                        return

                    log(
                        f"Generating text: max_tokens={max_tokens}, think={think}, temp={temperature}",
                        "debug",
                    )
                    log(f"Prompt length: {len(prompt)} chars", "debug")
                    t_start = time.time()

                    # Create sampler with temperature (mlx_lm 0.30.7+ API)
                    sampler = make_sampler(temp=temperature)

                    output = generate(
                        llm_model,
                        llm_tokenizer,
                        prompt=prompt,
                        max_tokens=max_tokens,
                        sampler=sampler,
                        verbose=VERBOSE,
                    )

                    if hasattr(output, "text"):
                        response_text = output.text
                    elif isinstance(output, str):
                        response_text = output
                    else:
                        response_text = str(output)

                    t_end = time.time()
                    generate_time = t_end - t_start

                    log(f"Generation completed in {generate_time:.2f}s", "debug")

                    send_response(
                        conn,
                        {
                            "id": request_id,
                            "text": response_text,
                            "stats": {
                                "prompt_tokens": getattr(output, "prompt_tokens", 0),
                                "generation_tokens": getattr(
                                    output, "generation_tokens", 0
                                ),
                                "total_tokens": getattr(output, "total_tokens", 0),
                                "generation_tps": getattr(
                                    output, "generation_tps", 0.0
                                ),
                                "generate_time_s": generate_time,
                            },
                            "done": True,
                        },
                    )

                except Exception as e:
                    log(f"Text generation failed: {e}", "error")
                    send_response(
                        conn, {"id": request_id, "error": str(e), "done": True}
                    )
        elif method == "shutdown":
            global shutting_down
            log("Shutdown requested")
            send_response(conn, {"id": request_id, "status": "shutting_down"})
            shutting_down = True
            cleanup()
            sys.exit(0)
        else:
            send_response(
                conn, {"id": request_id, "error": f"Unknown method: {method}"}
            )

    except json.JSONDecodeError as e:
        log(f"Invalid JSON: {e}", "error")
        send_response(conn, {"error": f"Invalid JSON: {e}"})
    except Exception as e:
        log(f"Request handling error: {e}", "error")
        send_response(conn, {"error": str(e)})


def main() -> None:
    """Main entry point."""
    global \
        model, \
        processor, \
        config, \
        server_socket, \
        BRIDGE_MODE, \
        SOCKET_PATH, \
        shutting_down

    # Parse command-line arguments
    parser = argparse.ArgumentParser(description="MLX Bridge for Escribano")
    parser.add_argument(
        "--mode",
        type=str,
        choices=["vlm", "llm"],
        default="vlm",
        help="Bridge mode: 'vlm' for frame analysis, 'llm' for text generation",
    )
    args = parser.parse_args()
    BRIDGE_MODE = args.mode

    # Adjust socket path based on mode (VLM and LLM use separate sockets)
    base_socket = SOCKET_PATH.replace(".sock", "")
    if BRIDGE_MODE == "llm":
        SOCKET_PATH = f"{base_socket}-llm.sock"
    else:
        SOCKET_PATH = f"{base_socket}-vlm.sock"

    # Set up signal handlers
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)

    # Clean up any existing socket
    cleanup()

    # Load model based on mode
    if BRIDGE_MODE == "vlm":
        model, processor, config = load_model()
    else:
        # LLM mode: load model lazily on first request
        log("LLM-only mode: model will be loaded on first request")

    # Create socket
    server_socket = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server_socket.bind(SOCKET_PATH)
    server_socket.listen(1)

    log(f"Listening on {SOCKET_PATH} (mode: {BRIDGE_MODE})")

    # Signal ready (for parent process to detect)
    ready_msg = {
        "status": "ready",
        "model": MODEL_NAME if BRIDGE_MODE == "vlm" else "llm-lazy",
        "mode": BRIDGE_MODE,
    }
    print(json.dumps(ready_msg), flush=True)

    # Accept connections
    while not shutting_down:
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
            if shutting_down:
                break
            log(f"Accept error: {e}", "error")
            continue


if __name__ == "__main__":
    main()
