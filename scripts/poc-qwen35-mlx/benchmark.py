"""
Core benchmarking logic for Qwen3.5 models.

Tests text-only loading with mlx-lm (not mlx-vlm).
"""

import time
from typing import Dict, Any, Optional, List
from dataclasses import dataclass

import mlx.core as mx
from mlx_lm import load, generate

from models import ModelConfig
from prompts import (
    fetch_sample_topic_blocks,
    build_subject_grouping_prompt,
    build_card_prompt,
    validate_subject_grouping_output,
    validate_card_output,
)


@dataclass
class BenchmarkResult:
    model_name: str
    model_id: str
    size_gb: float
    tier: str

    load_time_s: float
    generation_speed_tps: float
    peak_memory_gb: float

    prompt_a_parsed: bool
    prompt_b_parsed: bool
    thinking_works: Optional[bool]

    error: Optional[str] = None


def benchmark_model(model: ModelConfig, test_thinking: bool = False) -> BenchmarkResult:
    """
    Load model, run 2 prompts, collect metrics.

    Args:
        model: Model configuration
        test_thinking: If True, run a third prompt with enable_thinking=True

    Returns:
        BenchmarkResult with metrics and validation results
    """
    print(f"\n{'='*80}")
    print(f"Testing: {model.name} ({model.size_gb} GB, {model.tier})")
    print(f"Model ID: {model.model_id}")
    print(f"{'='*80}")

    try:
        # Load model
        print("Loading model...")
        load_start = time.time()
        model_obj, tokenizer = load(model.model_id)
        load_time = time.time() - load_start
        print(f"✓ Loaded in {load_time:.1f}s")

        # Get initial memory
        mem_info = mx.device_info()
        peak_memory_gb = mem_info.get('peak_memory', 0) / (1024**3)

        # Test Prompt A: Subject grouping (with real data)
        print("\n[Prompt A] Subject grouping (real TopicBlocks)...")
        blocks = fetch_sample_topic_blocks(limit=5)
        if not blocks:
            print("  Warning: No TopicBlocks found, using fallback prompt")
            prompt_a_raw = "Group these work segments into subjects:\n- Coding in VS Code\n- Research on MLX\n- Debugging terminal errors"
            block_ids = []
        else:
            prompt_a_raw = build_subject_grouping_prompt(blocks)
            block_ids = [b['id'] for b in blocks]
        
        print(f"  Prompt length: {len(prompt_a_raw)} chars")
        print(f"  Using RAW prompt (no chat template)")

        gen_start = time.time()
        output_a = generate(
            model_obj,
            tokenizer,
            prompt=prompt_a_raw,  # RAW PROMPT - no chat template
            max_tokens=2000,  # Match production (subject-grouping.ts:108)
            verbose=True,  # Show output
        )
        gen_time_a = time.time() - gen_start
        
        print("\n[LLM Output A]:")
        print(output_a[:500] + "..." if len(output_a) > 500 else output_a)

        tokens_a = len(tokenizer.encode(output_a))
        speed_a = tokens_a / gen_time_a if gen_time_a > 0 else 0

        prompt_a_parsed = validate_subject_grouping_output(output_a, block_ids)
        print(f"\n  Generated {tokens_a} tokens in {gen_time_a:.1f}s ({speed_a:.1f} tok/s)")
        print(f"  Parse: {'✓ PASS' if prompt_a_parsed else '✗ FAIL'}")

        # Update peak memory
        mem_info = mx.device_info()
        peak_memory_gb = max(peak_memory_gb, mem_info.get('peak_memory', 0) / (1024**3))

        # Test Prompt B: Card generation (with real data)
        print("\n[Prompt B] Card generation (real TopicBlocks)...")
        if blocks:
            prompt_b_raw = build_card_prompt(blocks)
        else:
            prompt_b_raw = "Generate a summary card for this work session:\n- 30m coding\n- 20m debugging\n- 10m research"
        
        print(f"  Prompt length: {len(prompt_b_raw)} chars")
        print(f"  Using RAW prompt (no chat template)")

        gen_start = time.time()
        output_b = generate(
            model_obj,
            tokenizer,
            prompt=prompt_b_raw,  # RAW PROMPT - no chat template
            max_tokens=4000,  # Match production (generate-artifact-v3.ts default)
            verbose=True,  # Show output
        )
        gen_time_b = time.time() - gen_start
        
        print("\n[LLM Output B]:")
        print(output_b[:500] + "..." if len(output_b) > 500 else output_b)

        tokens_b = len(tokenizer.encode(output_b))
        speed_b = tokens_b / gen_time_b if gen_time_b > 0 else 0

        prompt_b_parsed = validate_card_output(output_b)
        print(f"\n  Generated {tokens_b} tokens in {gen_time_b:.1f}s ({speed_b:.1f} tok/s)")
        print(f"  Parse: {'✓ PASS' if prompt_b_parsed else '✗ FAIL'}")

        # Update peak memory
        mem_info = mx.device_info()
        peak_memory_gb = max(peak_memory_gb, mem_info.get('peak_memory', 0) / (1024**3))

        # Test thinking mode (optional)
        thinking_works = None
        if test_thinking:
            print("\n[Optional] Testing thinking mode...")
            try:
                # Re-run Prompt A with thinking ENABLED via chat template
                messages_thinking = [{"role": "user", "content": prompt_a_raw}]
                prompt_thinking_formatted = tokenizer.apply_chat_template(
                    messages_thinking,
                    tokenize=False,
                    add_generation_prompt=True,
                    chat_template_kwargs={"enable_thinking": True}
                )
                
                output_thinking = generate(
                    model_obj,
                    tokenizer,
                    prompt=prompt_thinking_formatted,
                    max_tokens=2000,
                    verbose=True,  # Show output
                )
                thinking_works = True
                print("  ✓ Thinking mode works")
            except Exception as e:
                thinking_works = False
                print(f"  ✗ Thinking mode failed: {e}")

        # Unload model (delete references)
        print("\nUnloading model...")
        del model_obj
        del tokenizer
        mx.clear_cache()

        # Average generation speed
        avg_speed = (speed_a + speed_b) / 2 if (speed_a + speed_b) > 0 else 0

        print(f"\n✓ Complete: {load_time:.1f}s load, {avg_speed:.1f} tok/s avg, {peak_memory_gb:.1f} GB peak")

        return BenchmarkResult(
            model_name=model.name,
            model_id=model.model_id,
            size_gb=model.size_gb,
            tier=model.tier,
            load_time_s=load_time,
            generation_speed_tps=avg_speed,
            peak_memory_gb=peak_memory_gb,
            prompt_a_parsed=prompt_a_parsed,
            prompt_b_parsed=prompt_b_parsed,
            thinking_works=thinking_works,
        )

    except Exception as e:
        print(f"\n✗ ERROR: {e}")
        import traceback
        traceback.print_exc()

        return BenchmarkResult(
            model_name=model.name,
            model_id=model.model_id,
            size_gb=model.size_gb,
            tier=model.tier,
            load_time_s=0,
            generation_speed_tps=0,
            peak_memory_gb=0,
            prompt_a_parsed=False,
            prompt_b_parsed=False,
            thinking_works=None,
            error=str(e),
        )
