"""Benchmark using mlx-vlm with text parsing (no Outlines)."""

import re
import time
from pathlib import Path
from typing import Dict, Any, List


class MLXVLMBenchmark:
    """Benchmark runner using mlx-vlm Python API with text parsing."""
    
    def __init__(self, model_name: str):
        """Load model."""
        print(f"Loading model: {model_name}")
        
        try:
            from mlx_vlm import load
            from mlx_vlm.prompt_utils import apply_chat_template
            from mlx_vlm.utils import load_config
            
            # Load model and processor
            self.model, self.processor = load(model_name)
            self.model_name = model_name
            self.config = load_config(model_name)
            self.apply_chat_template = apply_chat_template
            
            print("✓ Model loaded successfully")
        except ImportError as e:
            print(f"\n❌ ERROR: Failed to import required libraries: {e}")
            print("Please install: uv pip install -r requirements.txt")
            raise
        except Exception as e:
            print(f"\n❌ ERROR: Failed to load model: {e}")
            raise
    
    def describe_frame(self, frame_path: str, frame_id: str, 
                       prompt: str, temperature: float, max_tokens: int) -> Dict[str, Any]:
        """Process single frame with mlx-vlm."""
        from mlx_vlm import generate
        
        start = time.perf_counter()
        
        try:
            # Use mlx-vlm's apply_chat_template which handles model-specific formatting
            # This properly formats prompts for pixtral, InternVL, gemma, etc.
            input_prompt = self.apply_chat_template(
                self.processor,
                self.config,
                prompt,
                num_images=1,
                add_generation_prompt=True
            )
            
            # Generate without logits_processors - use text parsing instead
            output = generate(
                self.model,
                self.processor,
                prompt=input_prompt,
                image=[frame_path],
                temperature=temperature,
                max_tokens=max_tokens,
                verbose=False
            )
            
            duration_ms = (time.perf_counter() - start) * 1000
            
            # Extract text from GenerationResult object
            if hasattr(output, 'text'):
                content = output.text
            elif isinstance(output, str):
                content = output
            else:
                content = str(output)
            
            # Parse using same regex as production code
            parsed = parse_vlm_response(content)
            
            # Get actual token count from GenerationResult if available
            tokens = getattr(output, 'token', len(content.split()))
            
            return {
                "frame_id": frame_id,
                "frame_path": frame_path,
                "description": content,
                **parsed,
                "tokens": tokens,
                "duration_ms": duration_ms,
                "error": None
            }
            
        except Exception as e:
            duration_ms = (time.perf_counter() - start) * 1000
            return {
                "frame_id": frame_id,
                "frame_path": frame_path,
                "description": f"Error: {str(e)}",
                "activity_type": "",
                "apps": [],
                "topics": [],
                "tokens": 0,
                "duration_ms": duration_ms,
                "error": str(e)
            }
    
    def run_benchmark(self, frames: List[Dict[str, Any]], 
                      prompt: str, temperature: float, max_tokens: int) -> Dict[str, Any]:
        """Process all frames sequentially."""
        print(f"\nProcessing {len(frames)} frames sequentially...")
        
        start = time.perf_counter()
        
        results = []
        for i, frame in enumerate(frames):
            print(f"  Frame {i+1}/{len(frames)}: {Path(frame['frame_path']).name}")
            
            result = self.describe_frame(
                frame["frame_path"],
                frame["id"],
                prompt,
                temperature,
                max_tokens
            )
            
            if result["error"]:
                print(f"    ⚠️  Error: {result['error']}")
            else:
                print(f"    ✓ {result['duration_ms']:.0f}ms, {result['tokens']} tokens")
                if result["activity_type"]:
                    print(f"      Activity: {result['activity_type'][:60]}...")
            
            results.append(result)
        
        total_ms = (time.perf_counter() - start) * 1000
        
        # Calculate stats
        successful = [r for r in results if not r["error"]]
        failed = [r for r in results if r["error"]]
        
        return {
            "concurrency": 1,
            "total_ms": total_ms,
            "frames": len(frames),
            "successful": len(successful),
            "failed": len(failed),
            "results": results
        }
    
    def run_benchmark_batched(self, frames: List[Dict[str, Any]], 
                              prompt: str, batch_size: int, 
                              temperature: float, max_tokens: int) -> Dict[str, Any]:
        """Process frames in batches using mlx-vlm's batch_generate()."""
        from mlx_vlm import batch_generate
        
        print(f"\nProcessing {len(frames)} frames in batches of {batch_size}...")
        
        start = time.perf_counter()
        all_results = []
        batch_count = 0
        
        for i in range(0, len(frames), batch_size):
            batch = frames[i:i+batch_size]
            batch_count += 1
            batch_start = time.perf_counter()
            
            print(f"  Batch {batch_count}: frames {i+1}-{min(i+batch_size, len(frames))}")
            
            try:
                # Run batch_generate - order preserved by design
                # Pass RAW prompts - batch_generate() handles formatting internally
                # Use make_sampler for temperature control (BatchGenerator doesn't accept temperature directly)
                from mlx_lm.sample_utils import make_sampler
                
                response = batch_generate(
                    self.model,
                    self.processor,
                    images=[f["frame_path"] for f in batch],
                    prompts=[prompt] * len(batch),  # Raw prompts, not pre-formatted
                    max_tokens=max_tokens,
                    sampler=make_sampler(temp=temperature, top_p=0.95),
                    track_image_sizes=True,
                    verbose=False
                )
                
                batch_ms = (time.perf_counter() - batch_start) * 1000
                
                # Process results (already in correct order)
                for j, (text, frame) in enumerate(zip(response.texts, batch)):
                    parsed = parse_vlm_response(text)
                    all_results.append({
                        "frame_id": frame["id"],
                        "frame_path": frame["frame_path"],
                        "description": text,
                        **parsed,
                        "tokens": len(text.split()) if text else 0,
                        "duration_ms": batch_ms / len(batch),  # Average per frame
                        "error": None
                    })
                
                print(f"    ✓ {batch_ms:.0f}ms for {len(batch)} frames ({batch_ms/len(batch):.0f}ms/frame)")
                
            except Exception as e:
                batch_ms = (time.perf_counter() - batch_start) * 1000
                print(f"    ❌ Batch failed: {e}")
                # Add error results for all frames in batch
                for frame in batch:
                    all_results.append({
                        "frame_id": frame["id"],
                        "frame_path": frame["frame_path"],
                        "description": f"Error: {str(e)}",
                        "activity_type": "",
                        "apps": [],
                        "topics": [],
                        "tokens": 0,
                        "duration_ms": batch_ms / len(batch),
                        "error": str(e)
                    })
        
        total_ms = (time.perf_counter() - start) * 1000
        
        # Calculate stats
        successful = [r for r in all_results if not r["error"]]
        failed = [r for r in all_results if r["error"]]
        
        return {
            "concurrency": batch_size,
            "total_ms": total_ms,
            "frames": len(frames),
            "successful": len(successful),
            "failed": len(failed),
            "results": all_results
        }
    
    def run_benchmark_concurrent(self, frames: List[Dict[str, Any]], 
                                prompt: str, concurrency: int, 
                                temperature: float, max_tokens: int) -> Dict[str, Any]:
        """Process frames concurrently using asyncio with semaphore-limited parallelism."""
        import asyncio
        from mlx_vlm import generate
        
        print(f"\nProcessing {len(frames)} frames with concurrency={concurrency}...")
        
        start = time.perf_counter()
        semaphore = asyncio.Semaphore(concurrency)
        
        def process_frame_sync(frame, idx):
            """Synchronous frame processing (run in executor)."""
            frame_start = time.perf_counter()
            try:
                formatted_prompt = self.apply_chat_template(
                    self.processor, self.config, prompt, num_images=1
                )
                output = generate(
                    self.model, self.processor,
                    prompt=formatted_prompt,
                    image=[frame["frame_path"]],
                    temperature=temperature,
                    max_tokens=max_tokens,
                    verbose=False
                )
                
                content = output.text if hasattr(output, 'text') else str(output)
                parsed = parse_vlm_response(content)
                tokens = getattr(output, 'token', len(content.split()))
                
                return {
                    "index": idx,
                    "frame_id": frame["id"],
                    "frame_path": frame["frame_path"],
                    "description": content,
                    **parsed,
                    "tokens": tokens,
                    "duration_ms": (time.perf_counter() - frame_start) * 1000,
                    "error": None
                }
            except Exception as e:
                return {
                    "index": idx,
                    "frame_id": frame["id"],
                    "frame_path": frame["frame_path"],
                    "description": f"Error: {str(e)}",
                    "activity_type": "",
                    "apps": [],
                    "topics": [],
                    "tokens": 0,
                    "duration_ms": (time.perf_counter() - frame_start) * 1000,
                    "error": str(e)
                }
        
        async def process_with_semaphore(frame, idx):
            """Process one frame with semaphore limiting."""
            async with semaphore:
                loop = asyncio.get_event_loop()
                return await loop.run_in_executor(None, lambda: process_frame_sync(frame, idx))
        
        async def process_all():
            tasks = [process_with_semaphore(f, i) for i, f in enumerate(frames)]
            return await asyncio.gather(*tasks)
        
        # Run async event loop
        results = asyncio.run(process_all())
        
        # Sort by original index to preserve order
        results.sort(key=lambda x: x["index"])
        
        total_ms = (time.perf_counter() - start) * 1000
        
        # Print progress
        for r in results:
            if r["error"]:
                print(f"  Frame {r['index']+1}: ⚠️ Error: {r['error']}")
            else:
                print(f"  Frame {r['index']+1}: ✓ {r['duration_ms']:.0f}ms")
        
        successful = [r for r in results if not r["error"]]
        failed = [r for r in results if r["error"]]
        
        return {
            "concurrency": concurrency,
            "total_ms": total_ms,
            "frames": len(frames),
            "successful": len(successful),
            "failed": len(failed),
            "results": results
        }
    
    def run_benchmark_interleaved(self, frames: List[Dict[str, Any]], 
                                  prompt_template: str, batch_size: int, 
                                  temperature: float, max_tokens: int) -> Dict[str, Any]:
        """Process frames in interleaved multi-image prompts."""
        from mlx_vlm import generate
        from mlx_vlm.prompt_utils import get_chat_template
        
        print(f"\nProcessing {len(frames)} frames in interleaved batches of {batch_size}...")
        
        start = time.perf_counter()
        all_results = []
        batch_count = 0
        
        for i in range(0, len(frames), batch_size):
            batch = frames[i:i+batch_size]
            batch_count += 1
            batch_start = time.perf_counter()
            
            print(f"  Batch {batch_count}: frames {i+1}-{min(i+batch_size, len(frames))}")
            
            try:
                # Build interleaved message structure
                content = []
                frames_section_parts = []
                
                for idx, frame in enumerate(batch):
                    frame_num = idx + 1
                    timestamp = frame.get("timestamp", "unknown")
                    
                    # Add text label
                    content.append({
                        "type": "text",
                        "text": f"Frame {frame_num} (timestamp: {timestamp}s):"
                    })
                    # Add image placeholder
                    content.append({"type": "image"})
                    
                    # Track for frames section
                    frames_section_parts.append(f"Frame {frame_num} @ {timestamp}s")
                
                # Add final prompt with instructions
                frames_section = "\n".join(frames_section_parts)
                final_prompt = prompt_template.format(
                    num_frames=len(batch),
                    frames_section=frames_section
                )
                content.append({"type": "text", "text": final_prompt})
                
                # Build message
                messages = [{"role": "user", "content": content}]
                
                # Apply chat template
                prompt = get_chat_template(
                    self.processor,
                    messages,
                    add_generation_prompt=True
                )
                
                # Generate with multiple images
                # Note: parameter is 'image' (singular), not 'images'
                output = generate(
                    self.model,
                    self.processor,
                    prompt,
                    image=[f["frame_path"] for f in batch],
                    temperature=temperature,
                    max_tokens=max_tokens,
                    verbose=False
                )
                
                batch_ms = (time.perf_counter() - batch_start) * 1000
                
                # Extract text from GenerationResult
                if hasattr(output, 'text'):
                    content_text = output.text
                elif isinstance(output, str):
                    content_text = output
                else:
                    content_text = str(output)
                
                # Parse results for each frame
                # Expected format: "Frame N: description: ... | activity: ... | apps: [...] | topics: [...]"
                frame_results = self._parse_interleaved_output(content_text, len(batch))
                
                for j, (frame, frame_data) in enumerate(zip(batch, frame_results)):
                    all_results.append({
                        "batch": batch_count,
                        "frame_index": i + j,
                        "frame_id": frame["id"],
                        "frame_path": frame["frame_path"],
                        "description": frame_data.get("description", ""),
                        "activity_type": frame_data.get("activity_type", ""),
                        "apps": frame_data.get("apps", []),
                        "topics": frame_data.get("topics", []),
                        "raw_output": content_text,  # Store full raw output for each frame (for debugging)
                        "tokens": len(content_text.split()) // len(batch),  # Approximate per frame
                        "duration_ms": batch_ms / len(batch),
                        "error": None
                    })
                
                print(f"    ✓ {batch_ms:.0f}ms for {len(batch)} frames ({batch_ms/len(batch):.0f}ms/frame)")
                
            except Exception as e:
                batch_ms = (time.perf_counter() - batch_start) * 1000
                print(f"    ❌ Batch failed: {e}")
                import traceback
                traceback.print_exc()
                
                for j, frame in enumerate(batch):
                    all_results.append({
                        "batch": batch_count,
                        "frame_index": i + j,
                        "frame_id": frame["id"],
                        "frame_path": frame["frame_path"],
                        "description": f"Error: {str(e)}",
                        "activity_type": "",
                        "apps": [],
                        "topics": [],
                        "raw_output": "",
                        "tokens": 0,
                        "duration_ms": batch_ms / len(batch),
                        "error": str(e)
                    })
        
        total_ms = (time.perf_counter() - start) * 1000
        
        successful = [r for r in all_results if not r["error"]]
        failed = [r for r in all_results if r["error"]]
        
        return {
            "concurrency": batch_size,
            "total_ms": total_ms,
            "frames": len(frames),
            "successful": len(successful),
            "failed": len(failed),
            "results": all_results
        }
    
    def _parse_interleaved_output(self, text: str, num_frames: int) -> List[Dict[str, Any]]:
        """Parse interleaved multi-frame output."""
        results = []
        
        # Try to find Frame N: patterns
        import re
        
        for frame_num in range(1, num_frames + 1):
            # Look for "Frame N: description: ..." pattern
            pattern = rf"Frame {frame_num}:\s*description:\s*(.+?)\s*\|\s*activity:\s*(.+?)\s*\|\s*apps:\s*(\[.+?\]|[^|]+)\s*\|\s*topics:\s*(.+?)(?=Frame \d+:|$)"
            match = re.search(pattern, text, re.DOTALL)
            
            if match:
                apps_str = re.sub(r"^\[|\]$", "", match[3].strip())
                topics_str = re.sub(r"^\[|\]$", "", match[4].strip())
                
                results.append({
                    "description": match[1].strip(),
                    "activity_type": match[2].strip(),
                    "apps": parse_array(apps_str),
                    "topics": parse_array(topics_str)
                })
            else:
                # Fallback: use generic parsing
                results.append({
                    "description": f"Failed to parse Frame {frame_num}",
                    "activity_type": "unknown",
                    "apps": [],
                    "topics": []
                })
        
        return results


def parse_vlm_response(content: str) -> Dict[str, Any]:
    """
    Parse pipe-delimited VLM response - same as production code.
    
    Format: description: ... | activity: ... | apps: [...] | topics: [...]
    
    Returns dict with:
    - description
    - activity_type
    - apps
    - topics
    """
    result = {
        "description": "",
        "activity_type": "",
        "apps": [],
        "topics": []
    }
    
    if not content or content.strip().startswith("Error:"):
        return result
    
    # Same regex as production: src/adapters/intelligence.ollama.adapter.ts line 373
    regex = r"^description:\s*(.+?)\s*\|\s*activity:\s*(.+?)\s*\|\s*apps:\s*(\[.+?\]|[^|]+)\s*\|\s*topics:\s*(.+)$"
    match = re.match(regex, content, re.DOTALL)
    
    if match:
        apps_str = re.sub(r"^\[|\]$", "", match[3].strip())
        topics_str = re.sub(r"^\[|\]$", "", match[4].strip())
        
        result["description"] = match[1].strip()
        result["activity_type"] = match[2].strip()
        result["apps"] = parse_array(apps_str)
        result["topics"] = parse_array(topics_str)
    else:
        # Fallback: use content as description
        result["description"] = content.strip()
        result["activity_type"] = "unknown"
    
    return result


def parse_array(array_str: str) -> List[str]:
    """Parse comma-separated list like 'Chrome, VS Code, Terminal'."""
    if not array_str:
        return []
    return [item.strip() for item in array_str.split(",") if item.strip()]


def format_as_pipe_delimited(data: Dict[str, Any]) -> str:
    """
    Convert parsed data to pipe-delimited format.
    
    Format: description: ... | activity: ... | apps: [...] | topics: [...]
    """
    description = data.get("description", "")
    activity = data.get("activity_type", "")
    apps = data.get("apps", [])
    topics = data.get("topics", [])
    
    # Format arrays
    apps_str = str(apps) if apps else "[]"
    topics_str = str(topics) if topics else "[]"
    
    return f"description: {description} | activity: {activity} | apps: {apps_str} | topics: {topics_str}"
