#!/usr/bin/env python3
"""
vLLM-MLX POC - Main entry point

Tests parallel VLM inference against Ollama baseline.

Usage:
    python scripts/poc-vllm-mlx/run.py
    
Prerequisites:
    1. Install dependencies: pip install -r scripts/poc-vllm-mlx/requirements.txt
    2. Start vLLM-MLX server: vllm-mlx serve mlx-community/Qwen3-VL-4B-Instruct-3bit --port 8000 --continuous-batching
"""

import asyncio
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from openai import AsyncOpenAI

from config import (
    DB_PATH, TEST_FRAMES, CONCURRENCY_LEVELS, VLLM_SERVER,
    DUPLICATE_FRAMES, BASELINE_SECONDS_PER_FRAME
)
from db import get_frames
from benchmark import run_parallel_benchmark
from report import generate_html_report


async def main():
    print("=" * 70)
    print("🚀 vLLM-MLX POC - Parallel VLM Inference Test")
    print("=" * 70)
    
    # 1. Fetch frames from DB
    print("\n[1/4] Fetching frames from database...")
    print(f"      Database: {DB_PATH}")
    frames = get_frames(DB_PATH, TEST_FRAMES)
    print(f"      ✓ Loaded {len(frames)} frames")
    
    if not frames:
        print("\n❌ ERROR: No frames found in database!")
        print("   Make sure you have processed recordings with VLM descriptions.")
        sys.exit(1)
    
    # Add duplicate frames for caching test
    if DUPLICATE_FRAMES > 0 and len(frames) >= DUPLICATE_FRAMES:
        duplicates = frames[:DUPLICATE_FRAMES]
        frames = frames + duplicates
        print(f"      ✓ Added {DUPLICATE_FRAMES} duplicates for caching test (total: {len(frames)})")
    
    # 2. Run benchmarks
    print("\n[2/4] Running benchmarks...")
    print(f"      Server: {VLLM_SERVER}")
    print(f"      Concurrency levels: {CONCURRENCY_LEVELS}")
    
    client = AsyncOpenAI(base_url=VLLM_SERVER, api_key="not-needed")
    
    results = []
    for concurrency in CONCURRENCY_LEVELS:
        print(f"\n      Testing concurrency={concurrency}...")
        result = await run_parallel_benchmark(client, frames, concurrency)
        results.append(result)
        
        total_s = result["total_ms"] / 1000
        fps = result["frames"] / total_s
        tok_per_sec = sum(r["tokens"] for r in result["results"]) / total_s
        
        print(f"      ✓ Done: {total_s:.1f}s total, {fps:.2f} fps, {tok_per_sec:.0f} tok/s")
    
    # 3. Generate report
    print("\n[3/4] Generating HTML report...")
    output_path = "docs/vllm-mlx-poc-report.html"
    generate_html_report(results, frames, output_path)
    print(f"      ✓ Report saved: {output_path}")
    
    # 4. Summary
    print("\n[4/4] Summary")
    print("=" * 70)
    
    print(f"\n{'Concurrency':<15} {'Total Time':<15} {'Frames/sec':<15} {'Speedup':<15}")
    print("-" * 70)
    
    baseline_fps = 1 / BASELINE_SECONDS_PER_FRAME
    
    best_result = None
    best_speedup = 0
    
    for r in results:
        total_s = r["total_ms"] / 1000
        fps = r["frames"] / total_s
        speedup = fps / baseline_fps
        
        if speedup > best_speedup:
            best_speedup = speedup
            best_result = r
        
        print(f"{r['concurrency']:<15} {total_s:.1f}s{'':<11} {fps:.2f}{'':<11} {speedup:.1f}x")
    
    print("-" * 70)
    
    # Final verdict
    print(f"\n📊 Best Configuration: Concurrency = {best_result['concurrency']}")
    print(f"📈 Speedup: {best_speedup:.1f}x vs Ollama baseline ({BASELINE_SECONDS_PER_FRAME}s/frame)")
    
    estimated_time_full = (182 / (best_result["frames"] / (best_result["total_ms"] / 1000))) / 60
    print(f"⏱️  Est. time for 182 frames: {estimated_time_full:.1f} minutes")
    
    # Verdict
    print("\n" + "=" * 70)
    if best_speedup >= 3.0:
        print("✅ VERDICT: STRONG SUCCESS - Major performance improvement achieved!")
    elif best_speedup >= 2.0:
        print("✅ VERDICT: SUCCESS - Meaningful performance improvement achieved")
    elif best_speedup >= 1.5:
        print("⚠️  VERDICT: MARGINAL - Modest improvement, evaluate if worth migration")
    else:
        print("❌ VERDICT: NO IMPROVEMENT - vLLM-MLX does not improve performance for your workload")
    print("=" * 70)
    
    print(f"\n📝 Open report to review accuracy:")
    print(f"   open {output_path}")
    
    return best_speedup >= 1.5  # Return True if successful


if __name__ == "__main__":
    try:
        success = asyncio.run(main())
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        print("\n\n⚠️  Interrupted by user")
        sys.exit(130)
    except Exception as e:
        print(f"\n\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
