"""Benchmarking utilities for parallel VLM inference."""

import asyncio
import base64
import time
from pathlib import Path
from typing import List, Dict, Any
from openai import AsyncOpenAI

from config import VLM_PROMPT, TEMPERATURE, MAX_TOKENS


async def describe_frame(
    client: AsyncOpenAI, 
    frame_path: str, 
    frame_id: str
) -> Dict[str, Any]:
    """
    Send single frame to vLLM-MLX for description.
    
    Returns dict with:
    - frame_id
    - frame_path
    - description (parsed from VLM output)
    - activity_type (parsed)
    - apps (parsed)
    - topics (parsed)
    - tokens
    - duration_ms
    """
    # Read and encode image
    with open(frame_path, "rb") as f:
        image_b64 = base64.b64encode(f.read()).decode()
    
    start = time.perf_counter()
    
    response = await client.chat.completions.create(
        model="default",
        messages=[{
            "role": "user",
            "content": [
                {"type": "text", "text": VLM_PROMPT},
                {
                    "type": "image_url", 
                    "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}
                }
            ]
        }],
        temperature=TEMPERATURE,
        max_tokens=MAX_TOKENS
    )
    
    duration_ms = (time.perf_counter() - start) * 1000
    content = response.choices[0].message.content
    
    # Parse the pipe-delimited format
    parsed = parse_vlm_output(content)
    
    return {
        "frame_id": frame_id,
        "frame_path": frame_path,
        "description": content,  # Raw output
        **parsed,  # description, activity_type, apps, topics
        "tokens": response.usage.total_tokens if response.usage else 0,
        "duration_ms": duration_ms
    }


def parse_vlm_output(content: str) -> Dict[str, Any]:
    """
    Parse VLM output in pipe-delimited format.
    
    Expected format:
    description: ... | activity: ... | apps: [...] | topics: [...]
    """
    result = {
        "description": "",
        "activity_type": "",
        "apps": [],
        "topics": []
    }
    
    if not content or content.strip().startswith("Parse error"):
        return result
    
    try:
        # Split by pipe delimiter
        parts = [p.strip() for p in content.split("|")]
        
        for part in parts:
            if part.startswith("description:"):
                result["description"] = part.replace("description:", "").strip()
            elif part.startswith("activity:"):
                result["activity_type"] = part.replace("activity:", "").strip()
            elif part.startswith("apps:"):
                apps_str = part.replace("apps:", "").strip()
                # Parse array notation [...]
                if apps_str.startswith("[") and apps_str.endswith("]"):
                    apps_content = apps_str[1:-1]
                    if apps_content:
                        result["apps"] = [a.strip().strip("'\"") for a in apps_content.split(",")]
            elif part.startswith("topics:"):
                topics_str = part.replace("topics:", "").strip()
                # Parse array notation [...]
                if topics_str.startswith("[") and topics_str.endswith("]"):
                    topics_content = topics_str[1:-1]
                    if topics_content:
                        result["topics"] = [t.strip().strip("'\"") for t in topics_content.split(",")]
    except Exception:
        # If parsing fails, just use the raw content as description
        result["description"] = content
    
    return result


async def run_parallel_benchmark(
    client: AsyncOpenAI, 
    frames: List[Dict[str, Any]], 
    concurrency: int
) -> Dict[str, Any]:
    """
    Process frames with controlled parallelism.
    
    Returns:
    - concurrency: concurrency level
    - total_ms: total time in milliseconds
    - frames: number of frames processed
    - results: list of individual frame results
    """
    semaphore = asyncio.Semaphore(concurrency)
    
    async def limited_call(frame: Dict[str, Any]) -> Dict[str, Any]:
        async with semaphore:
            return await describe_frame(
                client, 
                frame["frame_path"], 
                frame["id"]
            )
    
    start = time.perf_counter()
    
    tasks = [limited_call(f) for f in frames]
    results = await asyncio.gather(*tasks)
    
    total_ms = (time.perf_counter() - start) * 1000
    
    return {
        "concurrency": concurrency,
        "total_ms": total_ms,
        "frames": len(frames),
        "results": results
    }
