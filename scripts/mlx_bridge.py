#!/usr/bin/env python3
"""
MLX Bridge for Escribano

A Unix domain socket server that provides VLM and/or LLM inference.
Communicates with TypeScript via NDJSON (newline-delimited JSON).

Usage:
    python3 scripts/mlx_bridge.py --mode vlm   # VLM-only (frame analysis)
    python3 scripts/mlx_bridge.py --mode llm   # LLM-only (text generation)

Environment Variables:
    ESCRIBANO_VLM_MODEL       - MLX VLM model name (default: auto-detected by caller, safety net: Qwen3.5-0.8B-8bit)
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
from datetime import datetime
from pathlib import Path
from typing import Any, Literal, TextIO

try:
    import setproctitle  # type: ignore
except ImportError:  # pragma: no cover - optional dependency
    setproctitle = None


class InferenceTimeout(Exception):
    pass


def timeout_handler(signum, frame):
    raise InferenceTimeout("Inference timed out")


# Configuration from environment (all defaults come from TypeScript config.ts)
MODEL_NAME = os.environ.get(
    "ESCRIBANO_VLM_MODEL", "mlx-community/Qwen3.5-0.8B-8bit"
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
server_socket: socket.socket | None = None
LOG_DEST: TextIO | None = None


def rotate_log(path: Path) -> None:
    """Rotate log file when it exceeds max size (default 10MB)."""
    max_bytes = int(os.environ.get("ESCRIBANO_LOG_MAX_BYTES", "10485760"))
    if not path.exists():
        return
    if path.stat().st_size < max_bytes:
        return

    rotated = path.with_suffix(path.suffix + ".1") if path.suffix else Path(f"{path}.1")
    if rotated.exists():
        rotated.unlink()
    path.rename(rotated)


def ensure_log_destination() -> None:
    """Set up log destination: file (if ESCRIBANO_MLX_LOG_FILE set) or stderr."""
    global LOG_DEST
    log_path = os.environ.get("ESCRIBANO_MLX_LOG_FILE")
    if not log_path:
        LOG_DEST = sys.stderr
        return

    log_file = Path(log_path)
    log_file.parent.mkdir(parents=True, exist_ok=True)
    rotate_log(log_file)
    if not log_file.exists():
        log_file.touch()
    LOG_DEST = log_file.open("a", encoding="utf-8")


ensure_log_destination()


def log(message: str, level: str = "info") -> None:
    """Log message with [MLX] prefix and timestamp."""
    if level == "debug" and not VERBOSE:
        return
    prefix = {"info": "[MLX]", "error": "[MLX] ERROR:", "debug": "[MLX] DEBUG:"}.get(
        level, "[MLX]"
    )
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    dest = LOG_DEST or sys.stderr
    print(f"{timestamp} {prefix} {message}", file=dest, flush=True)




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
    if server_socket is not None:
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


def resolve_model_path(model_name: str) -> tuple[str, str]:
    """
    Classify model_name as local path or remote repo ID.
    Returns (resolved_path, source_kind) where source_kind is 'local path' or 'HuggingFace repo'.
    For local paths: expand ~, verify directory exists, verify config.json exists.
    Logs diagnostics and exits if the local path is invalid.
    """
    # Absolute paths (after ~ expansion) are treated as local
    expanded = os.path.expanduser(model_name)
    is_local = os.path.isabs(expanded)

    if is_local:
        log(f"Model appears to be a local path: {expanded}")
        if not os.path.isdir(expanded):
            log(f"Local model directory does not exist: {expanded}", "error")
            sys.exit(1)
        config_path = os.path.join(expanded, "config.json")
        if not os.path.isfile(config_path):
            log(f"Local model directory missing config.json: {config_path}", "error")
            sys.exit(1)
        log(f"Local model directory exists: {expanded}")
        log(f"config.json exists: {config_path}")
        return expanded, "local path"

    return model_name, "HuggingFace repo"


def load_model() -> tuple[Any, Any, Any]:
    """Load MLX-VLM model."""
    resolved_name, source_kind = resolve_model_path(MODEL_NAME)
    log(f"Loading model: {resolved_name}")
    log(f"Model source: {source_kind}")
    log(f"HF_HUB_OFFLINE: {os.environ.get('HF_HUB_OFFLINE', 'not set')}")
    log("This may take 30-120 seconds on first run or after memory clear...")
    start = time.time()

    try:
        log("Importing mlx_vlm...", "debug")
        from mlx_vlm import load
        from mlx_vlm.utils import load_config

        log("Loading model weights into memory (this takes the longest)...", "debug")
        model_obj, processor_obj = load(resolved_name)

        log("Loading model config...", "debug")
        config_obj = load_config(resolved_name)

        duration = time.time() - start
        log(f"Model loaded in {duration:.1f}s ({source_kind})")

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


def build_vlm_prompt(processor_obj: Any, prompt_params: dict) -> str | None:
    """Build a VLM prompt using the same template path as text_infer/vlm_infer."""
    from mlx_vlm.prompt_utils import get_chat_template

    messages = prompt_params.get("messages", [])
    raw_prompt = prompt_params.get("rawPrompt")

    if raw_prompt:
        messages = [{"role": "user", "content": raw_prompt}]

    if not messages:
        return None

    return get_chat_template(processor_obj, messages, add_generation_prompt=True)


def count_prompt_tokens(tokenizer_obj: Any, prompt_text: str) -> int:
    """Count prompt tokens across tokenizer return shapes."""
    tokenized = tokenizer_obj.encode(prompt_text)
    input_ids = getattr(tokenized, "input_ids", tokenized)
    if isinstance(input_ids, dict):
        input_ids = input_ids.get("input_ids", [])
    if isinstance(input_ids, list) and input_ids and isinstance(input_ids[0], list):
        return len(input_ids[0])
    return len(input_ids)


def resolve_context_limit(*candidates: Any, fallback_context_limit: int, request_id: int) -> int:
    """Resolve model context limit from known config/tokenizer fields."""
    field_names = (
        "max_position_embeddings",
        "max_seq_len",
        "model_max_length",
        "max_length",
        "context_length",
        "n_ctx",
    )

    for candidate in candidates:
        if candidate is None:
            continue
        for field_name in field_names:
            value = getattr(candidate, field_name, None)
            if isinstance(value, int) and value > 0 and value < 10_000_000:
                return value

    log(
        f"Context limit metadata unavailable for request {request_id}; using fallback {fallback_context_limit}",
        "error",
    )
    return fallback_context_limit


def handle_text_prompt_fit(
    conn: socket.socket,
    model_obj: Any,
    processor_obj: Any,
    config_obj: Any,
    params: dict,
    request_id: int,
) -> None:
    """Check prompt fit for VLM-mode text generation using the text_infer prompt path."""
    requested_output_tokens = int(params.get("maxTokens", 8000))
    reserved_tokens = 24000
    fallback_context_limit = 262144

    try:
        prompt = build_vlm_prompt(processor_obj, params)

        if prompt is None:
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

        tokenizer = getattr(processor_obj, "tokenizer", None)
        if tokenizer is None:
            raise ValueError("VLM tokenizer unavailable")

        prompt_tokens = count_prompt_tokens(tokenizer, prompt)
        context_limit = resolve_context_limit(
            config_obj,
            getattr(config_obj, "text_config", None),
            getattr(model_obj, "config", None),
            tokenizer,
            getattr(tokenizer, "tokenizer", None),
            fallback_context_limit=fallback_context_limit,
            request_id=request_id,
        )
        safe_input_budget = context_limit - requested_output_tokens - reserved_tokens
        fits = prompt_tokens <= safe_input_budget

        send_response(
            conn,
            {
                "id": request_id,
                "fits": fits,
                "prompt_tokens": prompt_tokens,
                "context_limit": context_limit,
                "requested_output_tokens": requested_output_tokens,
                "reserved_tokens": reserved_tokens,
                "safe_input_budget": safe_input_budget,
                "done": True,
            },
        )
    except Exception as e:
        log(f"Prompt fit check failed: {e}", "error")
        send_response(conn, {"id": request_id, "error": str(e), "done": True})




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
        prompt = build_vlm_prompt(processor_obj, {"messages": messages})

        t_start = time.time()

        # Generate - extract image paths from messages
        image_paths = []
        for msg in messages:
            if isinstance(msg.get("content"), list):
                for item in msg["content"]:
                    if item.get("type") == "image" and "imagePath" in item:
                        image_paths.append(item["imagePath"])

        signal.signal(signal.SIGALRM, timeout_handler)
        signal.alarm(300)  # 5 minutes
        try:
            output = generate(
                model_obj,
                processor_obj,
                prompt,
                image=image_paths if image_paths else None,
                temperature=TEMPERATURE,
                max_tokens=max_tokens,
                verbose=VERBOSE,
            )
        except InferenceTimeout:
            log("VLM inference timed out after 300s", "error")
            send_response(
                conn, {"id": request_id, "error": "VLM inference timed out after 300s", "done": True}
            )
            return
        finally:
            signal.alarm(0)

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
        if BRIDGE_MODE == "llm" and method in ("vlm_infer", "text_infer"):
            send_response(
                conn,
                {
                    "id": request_id,
                    "error": f"{method} not available in LLM-only mode",
                    "done": True,
                },
            )
            return

        if BRIDGE_MODE == "vlm" and method in ("llm_infer", "llm_prompt_fit"):
            send_response(
                conn,
                {
                    "id": request_id,
                    "error": f"{method} not available in VLM-only mode",
                    "done": True,
                },
            )
            return

        if method == "ping":
            send_response(conn, {"id": request_id, "pong": True, "text": "", "done": True})
            return

        if method == "vlm_infer":
            handle_vlm_infer(
                conn, model_obj, processor_obj, config_obj, params, request_id
            )
        elif method == "text_infer":
            # text_infer reuses the loaded model for text-only generation.
            # Qwen3.5 is multimodal and handles text-only prompts natively.
            # We call handle_vlm_infer directly — it already handles image=None
            # when no image paths are in the messages.
            handle_vlm_infer(
                conn, model_obj, processor_obj, config_obj, params, request_id
            )
        elif method == "text_prompt_fit":
            handle_text_prompt_fit(
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

                    max_tokens = params.get("maxTokens", 8000)
                    temperature = params.get("temperature", 0.7)
                    think = params.get("think", False)

                    def build_llm_prompt(tokenizer_obj: Any, prompt_params: dict) -> str | None:
                        messages = prompt_params.get("messages", [])
                        raw_prompt = prompt_params.get("rawPrompt")
                        think_enabled = prompt_params.get("think", False)

                        if raw_prompt:
                            chat_messages = [{"role": "user", "content": raw_prompt}]
                            built_prompt = tokenizer_obj.apply_chat_template(
                                chat_messages,
                                tokenize=False,
                                add_generation_prompt=True,
                                chat_template_kwargs={"enable_thinking": think_enabled},
                            )
                            log(
                                f"Applied chat template to raw prompt (think={think_enabled}, temp={temperature})",
                                "debug",
                            )
                            return built_prompt

                        if messages:
                            built_prompt = tokenizer_obj.apply_chat_template(
                                messages,
                                tokenize=False,
                                add_generation_prompt=True,
                                chat_template_kwargs={"enable_thinking": think_enabled},
                            )
                            log(
                                f"Applied chat template to messages (think={think_enabled}, temp={temperature})",
                                "debug",
                            )
                            return built_prompt

                        return None

                    prompt = build_llm_prompt(llm_tokenizer, params)

                    if prompt is None:
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

                    signal.signal(signal.SIGALRM, timeout_handler)
                    signal.alarm(300)  # 5 minutes
                    try:
                        output = generate(
                            llm_model,
                            llm_tokenizer,
                            prompt=prompt,
                            max_tokens=max_tokens,
                            sampler=sampler,
                            verbose=VERBOSE,
                        )
                    except InferenceTimeout:
                        log("LLM inference timed out after 300s", "error")
                        send_response(
                            conn, {"id": request_id, "error": "LLM inference timed out after 300s", "done": True}
                        )
                        return
                    finally:
                        signal.alarm(0)

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
        elif method == "llm_prompt_fit":
            if llm_model is None or llm_tokenizer is None:
                send_response(
                    conn,
                    {"id": request_id, "error": "LLM model not loaded", "done": True},
                )
            else:
                try:
                    requested_output_tokens = int(params.get("maxTokens", 8000))
                    reserved_tokens = 24000
                    fallback_context_limit = 262144

                    def build_llm_prompt(tokenizer_obj: Any, prompt_params: dict) -> str | None:
                        messages = prompt_params.get("messages", [])
                        raw_prompt = prompt_params.get("rawPrompt")
                        think_enabled = prompt_params.get("think", False)

                        if raw_prompt:
                            chat_messages = [{"role": "user", "content": raw_prompt}]
                            built_prompt = tokenizer_obj.apply_chat_template(
                                chat_messages,
                                tokenize=False,
                                add_generation_prompt=True,
                                chat_template_kwargs={"enable_thinking": think_enabled},
                            )
                            log(
                                f"Applied chat template to raw prompt for fit check (think={think_enabled})",
                                "debug",
                            )
                            return built_prompt

                        if messages:
                            built_prompt = tokenizer_obj.apply_chat_template(
                                messages,
                                tokenize=False,
                                add_generation_prompt=True,
                                chat_template_kwargs={"enable_thinking": think_enabled},
                            )
                            log(
                                f"Applied chat template to messages for fit check (think={think_enabled})",
                                "debug",
                            )
                            return built_prompt

                        return None

                    prompt = build_llm_prompt(llm_tokenizer, params)

                    if prompt is None:
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

                    prompt_tokens = count_prompt_tokens(llm_tokenizer, prompt)
                    context_limit = resolve_context_limit(
                        getattr(llm_model, "config", None),
                        getattr(llm_model, "args", None),
                        llm_tokenizer,
                        getattr(llm_tokenizer, "tokenizer", None),
                        fallback_context_limit=fallback_context_limit,
                        request_id=request_id,
                    )
                    safe_input_budget = (
                        context_limit - requested_output_tokens - reserved_tokens
                    )
                    fits = prompt_tokens <= safe_input_budget

                    send_response(
                        conn,
                        {
                            "id": request_id,
                            "fits": fits,
                            "prompt_tokens": prompt_tokens,
                            "context_limit": context_limit,
                            "requested_output_tokens": requested_output_tokens,
                            "reserved_tokens": reserved_tokens,
                            "safe_input_budget": safe_input_budget,
                            "done": True,
                        },
                    )
                except Exception as e:
                    log(f"Prompt fit check failed: {e}", "error")
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
                conn, {"id": request_id, "error": f"Unknown method: {method}", "done": True}
            )

    except json.JSONDecodeError as e:
        log(f"Invalid JSON: {e}", "error")
        send_response(conn, {"error": f"Invalid JSON: {e}", "done": True})
    except Exception as e:
        log(f"Request handling error: {e}", "error")
        send_response(conn, {"error": str(e), "done": True})


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

    if setproctitle is not None:
        try:
            setproctitle.setproctitle(f"escribano-bridge-{BRIDGE_MODE}")
            log(f"Process title set to 'escribano-bridge-{BRIDGE_MODE}'", "info")
        except Exception as err:  # pragma: no cover - best effort
            log(f"Failed to set process title: {err}", "info")
    else:
        log("[MLX] setproctitle not installed — process will appear as \"python3\" in Activity Monitor", "warning")

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
