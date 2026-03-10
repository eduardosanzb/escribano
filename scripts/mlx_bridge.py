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
    ESCRIBANO_VLM_MAX_TOKENS  - Token budget per batch (default: 2000)
    ESCRIBANO_MLX_SOCKET_PATH - Unix socket path (default: /tmp/escribano-mlx.sock)
    ESCRIBANO_VERBOSE         - Enable verbose logging (default: false)
"""

import argparse
import json
import os
import re
import signal
import socket
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any, Literal

# Configuration from environment (all defaults come from TypeScript config.ts)
MODEL_NAME = os.environ.get(
    "ESCRIBANO_VLM_MODEL", "mlx-community/Qwen3-VL-2B-Instruct-4bit"
)
BATCH_SIZE = int(os.environ.get("ESCRIBANO_VLM_BATCH_SIZE", "2"))
MAX_TOKENS = int(os.environ.get("ESCRIBANO_VLM_MAX_TOKENS", "2000"))
SOCKET_PATH = os.environ.get("ESCRIBANO_MLX_SOCKET_PATH", "/tmp/escribano-mlx.sock")
VERBOSE = os.environ.get("ESCRIBANO_VERBOSE", "false").lower() == "true"
TEMPERATURE = 0.3

# Debug logging configuration
DB_PATH = os.environ.get("ESCRIBANO_DB_PATH", "")
DEBUG_LLM = os.environ.get("ESCRIBANO_DEBUG_LLM", "false").lower() == "true"

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


def load_vlm_prompt(batch_size: int) -> str:
    """Load and template the VLM prompt from prompts/vlm-batch.md."""
    project_root = find_project_root()
    prompt_file = project_root / "prompts" / "vlm-batch.md"
    
    if not prompt_file.exists():
        log(f"Warning: prompt file not found at {prompt_file}, using inline prompt", "info")
        # Fallback inline prompt (old behavior)
        return f"""Analyze these {batch_size} screenshots from a screen recording.

For each frame above, provide:
- description: What's on screen? Be specific about content, text, and UI elements.
- activity: What is the user doing?
- apps: Which applications are visible?
- topics: What topics, projects, or technical subjects?

Output in this exact format for each frame:
Frame 1: description: ... | activity: ... | apps: [...] | topics: [...]
Frame 2: description: ... | activity: ... | apps: [...] | topics: [...]
...and so on for all {batch_size} frames."""
    
    try:
        content = prompt_file.read_text(encoding="utf-8")
        # Replace template variable
        content = content.replace("{{FRAME_COUNT}}", str(batch_size))
        return content
    except Exception as e:
        log(f"Error loading prompt file: {e}", "error")
        # Fallback to inline prompt
        return f"""Analyze these {batch_size} screenshots from a screen recording.

For each frame above, provide:
- description: What's on screen? Be specific about content, text, and UI elements.
- activity: What is the user doing?
- apps: Which applications are visible?
- topics: What topics, projects, or technical subjects?

Output in this exact format for each frame:
Frame 1: description: ... | activity: ... | apps: [...] | topics: [...]
Frame 2: description: ... | activity: ... | apps: [...] | topics: [...]
...and so on for all {batch_size} frames."""

# Global state
model = None
processor = None
config = None
llm_model = None
llm_tokenizer = None
llm_loaded_model_name = None
server_socket = None
debug_db_conn = None


def log(message: str, level: str = "info") -> None:
    """Log message with [MLX] prefix."""
    if level == "debug" and not VERBOSE:
        return
    prefix = {"info": "[MLX]", "error": "[MLX] ERROR:", "debug": "[MLX] DEBUG:"}.get(
        level, "[MLX]"
    )
    print(f"{prefix} {message}", file=sys.stderr, flush=True)


def get_debug_db() -> sqlite3.Connection | None:
    """Get or create debug database connection."""
    global debug_db_conn
    if not DEBUG_LLM or not DB_PATH:
        return None
    if debug_db_conn is None:
        try:
            debug_db_conn = sqlite3.connect(DB_PATH)
            log(f"Connected to debug database: {DB_PATH}", "debug")
        except Exception as e:
            log(f"Failed to connect to debug database: {e}", "error")
    return debug_db_conn


def log_llm_call(data: dict) -> None:
    """Log LLM call to debug table (best-effort)."""
    db = get_debug_db()
    if not db:
        return
    
    try:
        cursor = db.cursor()
        cursor.execute("""
            INSERT INTO llm_debug_log (
                id, recording_id, artifact_id, call_type, prompt, result, metadata
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            data['id'],
            data.get('recording_id'),
            data.get('artifact_id'),
            data.get('call_type', 'unknown'),
            data.get('prompt'),
            data.get('result'),
            json.dumps(data['metadata']),
        ))
        db.commit()
        log(f"Logged LLM call to debug table: {data['id']}", "debug")
    except Exception as e:
        log(f"Failed to log LLM call (non-fatal): {e}", "error")


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
    """Clean up socket file and debug database on exit."""
    global server_socket, debug_db_conn
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
    if debug_db_conn:
        try:
            debug_db_conn.close()
        except Exception:
            pass
        debug_db_conn = None


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
) -> tuple[list[dict], dict]:
    """
    Process a batch of frames using interleaved multi-image prompts.

    Returns tuple of (results, stats) where:
    - results: list of frame results with parsed descriptions
    - stats: dict with timing and token metrics
    """
    from mlx_vlm import generate
    from mlx_vlm.prompt_utils import get_chat_template

    t_batch_start = time.time()

    # Build interleaved message structure
    content = []
    for idx, frame in enumerate(batch):
        frame_num = idx + 1
        timestamp = frame.get("timestamp", "unknown")

        # Add text label
        content.append({"type": "text", "text": f"Frame {frame_num} (timestamp: {timestamp}s):"})
        # Add image placeholder
        content.append({"type": "image"})

     # Add final prompt with instructions (loaded from prompts/vlm-batch.md)
    final_prompt = load_vlm_prompt(len(batch))
    content.append({"type": "text", "text": final_prompt})

    # Build message
    messages = [{"role": "user", "content": content}]

    # Apply chat template
    prompt = get_chat_template(processor_obj, messages, add_generation_prompt=True)

    t_generate_start = time.time()
    
    # Generate with multiple images
    output = generate(
        model_obj,
        processor_obj,
        prompt,
        image=[f["imagePath"] for f in batch],
        temperature=TEMPERATURE,
        max_tokens=MAX_TOKENS,
        verbose=VERBOSE,
    )

    t_generate_end = time.time()
    generate_time = t_generate_end - t_generate_start

    # Extract text from output
    if hasattr(output, "text"):
        content_text = output.text
    elif isinstance(output, str):
        content_text = output
    else:
        content_text = str(output)

    # Parse results for each frame
    results = parse_interleaved_output(content_text, batch)
    
    t_parse_end = time.time()
    parse_time = t_parse_end - t_generate_end
    total_time = t_parse_end - t_batch_start

    # Build stats dict from GenerationResult
    stats = {
        "prompt_tokens": getattr(output, "prompt_tokens", 0),
        "generation_tokens": getattr(output, "generation_tokens", 0),
        "total_tokens": getattr(output, "total_tokens", 0),
        "prompt_tps": getattr(output, "prompt_tps", 0.0),
        "generation_tps": getattr(output, "generation_tps", 0.0),
        "peak_memory_gb": getattr(output, "peak_memory", 0.0),
        "generate_time_s": generate_time,
        "parse_time_s": parse_time,
        "total_time_s": total_time,
    }

    # Log detailed stats if verbose
    if VERBOSE:
        log(f"  Prompt: {stats['prompt_tokens']} tokens @ {stats['prompt_tps']:.1f} tok/s", "debug")
        log(f"  Gen: {stats['generation_tokens']} tokens @ {stats['generation_tps']:.1f} tok/s", "debug")
        prefill_s = stats['prompt_tokens'] / stats['prompt_tps'] if stats['prompt_tps'] > 0 else 0
        gen_s = stats['generation_tokens'] / stats['generation_tps'] if stats['generation_tps'] > 0 else 0
        log(f"  Time: {generate_time:.2f}s (prefill: {prefill_s:.2f}s, gen: {gen_s:.2f}s)", "debug")
        log(f"  Peak memory: {stats['peak_memory_gb']:.2f} GB", "debug")
        log(f"  Batch total: {total_time:.2f}s", "debug")

    return results, stats


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


def strip_thinking_tags(text: str) -> str:
    """Remove <think>...</think> tags from thinking-mode output."""
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()


def handle_describe_images(
    conn: socket.socket, model_obj: Any, processor_obj: Any, config_obj: Any, params: dict, request_id: int
) -> None:
    """Handle describe_images request with streaming batch responses."""
    global model, processor, config
    
    # Reload model if it was unloaded (lazy reload after unload_vlm)
    if model_obj is None:
        log("VLM model was unloaded, reloading...")
        model, processor, config = load_model()
        model_obj, processor_obj, config_obj = model, processor, config
    
    images = params.get("images", [])
    batch_size = params.get("batchSize", BATCH_SIZE)
    total = len(images)

    if total == 0:
        send_response(conn, {"id": request_id, "error": "No images provided", "done": True})
        return

    log(f"Processing {total} images in batches of {batch_size}")

    # Accumulate stats across all batches
    total_prompt_tokens = 0
    total_gen_tokens = 0
    total_generate_time = 0.0

    # Process in batches
    for batch_idx in range(0, total, batch_size):
        batch = images[batch_idx : batch_idx + batch_size]
        batch_num = batch_idx // batch_size + 1

        try:
            log(f"Processing batch {batch_num}: frames {batch_idx + 1}-{min(batch_idx + batch_size, total)}")

            results, stats = process_interleaved_batch(model_obj, processor_obj, config_obj, batch)

            # Accumulate stats
            total_prompt_tokens += stats.get("prompt_tokens", 0)
            total_gen_tokens += stats.get("generation_tokens", 0)
            total_generate_time += stats.get("generate_time_s", 0)

            # Stream response immediately
            is_partial = batch_idx + batch_size < total
            send_response(conn, {
                "id": request_id,
                "batch": batch_num,
                "results": results,
                "stats": stats,
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

    # Log summary stats
    if total_generate_time > 0:
        avg_prompt_tps = total_prompt_tokens / (total_prompt_tokens / 2000) if total_prompt_tokens > 0 else 0
        avg_gen_tps = total_gen_tokens / total_generate_time if total_generate_time > 0 else 0
        log(f"Total: {total_prompt_tokens} prompt tokens, {total_gen_tokens} gen tokens in {total_generate_time:.1f}s")

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

        # Validate method compatibility with bridge mode
        if BRIDGE_MODE == "llm" and method == "describe_images":
            send_response(
                conn,
                {
                    "id": request_id,
                    "error": "describe_images not available in LLM-only mode",
                    "done": True,
                },
            )
            return

        if BRIDGE_MODE == "vlm" and method == "generate_text":
            send_response(
                conn,
                {
                    "id": request_id,
                    "error": "generate_text not available in VLM-only mode",
                    "done": True,
                },
            )
            return

        if method == "describe_images":
            handle_describe_images(conn, model_obj, processor_obj, config_obj, params, request_id)
        elif method == "load_llm":
            global llm_model, llm_tokenizer, llm_loaded_model_name
            try:
                llm_model, llm_tokenizer = load_llm_model(params.get("model", ""))
                llm_loaded_model_name = params.get("model", "")
                send_response(conn, {"id": request_id, "status": "loaded", "done": True})
            except Exception as e:
                send_response(conn, {"id": request_id, "error": str(e), "done": True})
        elif method == "unload_vlm":
            try:
                unload_vlm()
                send_response(conn, {"id": request_id, "status": "unloaded", "done": True})
            except Exception as e:
                send_response(conn, {"id": request_id, "error": str(e), "done": True})
        elif method == "unload_llm":
            try:
                unload_llm()
                send_response(conn, {"id": request_id, "status": "unloaded", "done": True})
            except Exception as e:
                send_response(conn, {"id": request_id, "error": str(e), "done": True})
        elif method == "generate_text":
            if llm_model is None or llm_tokenizer is None:
                send_response(conn, {"id": request_id, "error": "LLM model not loaded", "done": True})
            else:
                try:
                    from mlx_lm import generate
                    from mlx_lm.sample_utils import make_sampler
                    
                    messages = params.get("messages", [])
                    raw_prompt = params.get("rawPrompt")
                    max_tokens = params.get("maxTokens", 4000)
                    think = params.get("think", False)
                    temperature = params.get("temperature", 0.7)

                    # Determine prompt source and apply chat template
                    if raw_prompt:
                        # Apply chat template to raw prompt
                        chat_messages = [{"role": "user", "content": raw_prompt}]
                        prompt = llm_tokenizer.apply_chat_template(
                            chat_messages,
                            tokenize=False,
                            add_generation_prompt=True,
                            chat_template_kwargs={"enable_thinking": think}
                        )
                        log(f"Applied chat template to raw prompt (think={think}, temp={temperature})", "debug")
                    elif messages:
                        # Apply chat template to messages array
                        prompt = llm_tokenizer.apply_chat_template(
                            messages,
                            tokenize=False,
                            add_generation_prompt=True,
                            chat_template_kwargs={"enable_thinking": think}
                        )
                        log(f"Applied chat template to messages (think={think}, temp={temperature})", "debug")
                    else:
                        send_response(conn, {"id": request_id, "error": "No prompt provided (need 'rawPrompt' or 'messages')", "done": True})
                        return

                    if not prompt:
                        send_response(conn, {"id": request_id, "error": "Empty prompt after template", "done": True})
                        return

                    log(f"Generating text: max_tokens={max_tokens}, think={think}, temp={temperature}", "debug")
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

                    # Store raw response for debug logging
                    raw_response_text = response_text

                    # Strip thinking tags when think=False (model may still output thinking)
                    if not think:
                        original_len = len(response_text)
                        response_text = strip_thinking_tags(response_text)
                        if original_len != len(response_text):
                            log(f"Stripped thinking: {original_len} → {len(response_text)} chars", "debug")

                    t_end = time.time()
                    generate_time = t_end - t_start

                    log(f"Generation completed in {generate_time:.2f}s", "debug")

                    # Log to debug table if enabled
                    if DEBUG_LLM:
                        debug_context = params.get("debugContext", {})
                        log_llm_call({
                            "id": str(request_id),
                            "recording_id": debug_context.get("recordingId"),
                            "artifact_id": debug_context.get("artifactId"),
                            "call_type": debug_context.get("callType", "unknown"),
                            "prompt": raw_prompt or (messages if messages else None),
                            "result": response_text,
                            "metadata": {
                                "model": llm_loaded_model_name or "unknown",
                                "think_param": 1 if think else 0,
                                "temperature": temperature,
                                "max_tokens": max_tokens,
                                "prompt_after_template": prompt[:500] + "..." if len(prompt) > 500 else prompt,
                                "chat_template_kwargs": {"enable_thinking": think},
                                "raw_response": raw_response_text,
                                "prompt_tokens": getattr(output, "prompt_tokens", 0),
                                "generation_tokens": getattr(output, "generation_tokens", 0),
                                "generation_tps": getattr(output, "generation_tps", 0.0),
                                "generate_time_s": generate_time,
                            },
                        })

                    send_response(conn, {
                        "id": request_id,
                        "text": response_text,
                        "stats": {
                            "prompt_tokens": getattr(output, "prompt_tokens", 0),
                            "generation_tokens": getattr(output, "generation_tokens", 0),
                            "total_tokens": getattr(output, "total_tokens", 0),
                            "generation_tps": getattr(output, "generation_tps", 0.0),
                            "generate_time_s": generate_time,
                        },
                        "done": True,
                    })

                except Exception as e:
                    log(f"Text generation failed: {e}", "error")
                    send_response(conn, {"id": request_id, "error": str(e), "done": True})
        elif method == "shutdown":
            global shutting_down
            log("Shutdown requested")
            send_response(conn, {"id": request_id, "status": "shutting_down"})
            shutting_down = True
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
    global model, processor, config, server_socket, BRIDGE_MODE, SOCKET_PATH, shutting_down

    # Log debug configuration at startup
    if DEBUG_LLM:
        log(f"Debug logging enabled (DB_PATH={DB_PATH})")

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
