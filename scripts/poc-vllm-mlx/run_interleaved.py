#!/usr/bin/env python3
"""
mlx-vlm Interleaved POC - Test interleaved multi-image prompts

Tests interleaved processing for bf16 models:
1. Qwen3-VL-2B-Instruct-bf16
2. gemma-3n-E4B-it-bf16

Uses interleaved text+image prompts to process multiple frames in single call.

Usage:
    uv run python run_interleaved.py
"""

import sys
from pathlib import Path
from datetime import datetime

sys.path.insert(0, str(Path(__file__).parent))

from config import (
    DB_PATH, TEST_FRAMES, TEMPERATURE, MAX_TOKENS, 
    INTERLEAVED_PROMPT_TEMPLATE, INTERLEAVED_BATCH_SIZE, 
    MODELS_TO_TEST, BASELINE_SECONDS_PER_FRAME
)
from db import get_frames
from benchmark import MLXVLMBenchmark, format_as_pipe_delimited
from report import generate_html_report


def test_model_interleaved(model_info: dict, frames: list, model_index: int, total_models: int) -> dict:
    """Test a single model with interleaved multi-image processing."""
    model_name = model_info["name"]
    
    print("\n" + "=" * 70)
    print(f"🧪 MODEL {model_index}/{total_models}: {model_name}")
    print("=" * 70)
    print(f"   Size: {model_info['size']}")
    print(f"   Interleaved batch size: {INTERLEAVED_BATCH_SIZE}")
    print("=" * 70)
    
    try:
        print(f"\n[1/3] Loading model...")
        benchmark = MLXVLMBenchmark(model_name)
        
        print(f"\n[2/3] Running interleaved benchmark...")
        result = benchmark.run_benchmark_interleaved(
            frames, INTERLEAVED_PROMPT_TEMPLATE, INTERLEAVED_BATCH_SIZE, 
            TEMPERATURE, MAX_TOKENS
        )
        
        print(f"\n[3/3] Formatting outputs...")
        for r in result["results"]:
            if not r["error"]:
                r["formatted_output"] = format_as_pipe_delimited(r)
        
        model_slug = model_name.split("/")[-1].replace("-", "_")
        timestamp = datetime.now().strftime("%Y%m%d_%H%M")
        output_path = f"docs/mlx-vlm-poc-interleaved-{model_slug}-{timestamp}.html"
        generate_html_report([result], frames, output_path)
        print(f"   ✓ Report: {output_path}")
        
        total_s = result["total_ms"] / 1000
        fps = result["frames"] / total_s if result["frames"] > 0 else 0
        ms_per_frame = result["total_ms"] / result["frames"]
        baseline_fps = 1 / BASELINE_SECONDS_PER_FRAME
        speedup = fps / baseline_fps if baseline_fps > 0 else 0
        
        return {
            "model_name": model_name,
            "model_info": model_info,
            "success": True,
            "result": result,
            "metrics": {
                "total_s": total_s,
                "fps": fps,
                "ms_per_frame": ms_per_frame,
                "speedup": speedup,
                "successful": result["successful"],
                "failed": result["failed"]
            },
            "report_path": output_path
        }
        
    except Exception as e:
        print(f"\n❌ ERROR testing {model_name}: {e}")
        import traceback
        traceback.print_exc()
        return {
            "model_name": model_name,
            "model_info": model_info,
            "success": False,
            "error": str(e)
        }


def main():
    print("=" * 70)
    print("🚀 mlx-vlm Interleaved POC")
    print("=" * 70)
    print(f"\nTesting {len(MODELS_TO_TEST)} models with interleaved prompts")
    print(f"Each model will process {TEST_FRAMES} frames")
    print(f"Interleaved batch size: {INTERLEAVED_BATCH_SIZE}")
    print()
    
    print("[PREP] Fetching frames from database...")
    print(f"       Database: {DB_PATH}")
    frames = get_frames(DB_PATH, TEST_FRAMES)
    print(f"       ✓ Loaded {len(frames)} frames")
    
    if not frames:
        print("\n❌ ERROR: No frames found in database!")
        sys.exit(1)
    
    results = []
    for i, model_info in enumerate(MODELS_TO_TEST, 1):
        result = test_model_interleaved(model_info, frames, i, len(MODELS_TO_TEST))
        results.append(result)
        
        if i < len(MODELS_TO_TEST):
            print("\n   [Pausing 2s to clear memory...]")
            import time
            time.sleep(2)
    
    print("\n" + "=" * 70)
    print("📊 INTERLEAVED COMPARISON SUMMARY")
    print("=" * 70)
    print(f"\n{'Model':<35} {'Time':<8} {'ms/frame':<10} {'Speedup':<10} {'Status':<10}")
    print("-" * 80)
    
    best_model = None
    best_speedup = 0
    
    for r in results:
        model_name = r["model_name"].split("/")[-1][:32]
        
        if r["success"]:
            m = r["metrics"]
            status = "✅ PASS" if m["speedup"] >= 1.0 else "⚠️  SLOW"
            print(f"{model_name:<35} {m['total_s']:<8.1f} {m['ms_per_frame']:<10.0f} {m['speedup']:<10.1f}x {status:<10}")
            
            if m["speedup"] > best_speedup:
                best_speedup = m["speedup"]
                best_model = r
        else:
            print(f"{model_name:<35} {'N/A':<8} {'N/A':<10} {'N/A':<10} ❌ FAIL")
    
    print("-" * 80)
    
    if best_model:
        print(f"\n🏆 BEST MODEL: {best_model['model_name']}")
        print(f"   Speedup: {best_model['metrics']['speedup']:.1f}x vs Ollama baseline")
        print(f"   Time per frame: {best_model['metrics']['ms_per_frame']:.0f}ms")
        print(f"   Report: {best_model['report_path']}")
    
    print("\n" + "=" * 70)
    successful = [r for r in results if r["success"]]
    fast = [r for r in results if r["success"] and r["metrics"]["speedup"] >= 1.0]
    
    if len(fast) >= 2:
        print("✅ VERDICT: Excellent - Multiple models outperform Ollama")
    elif len(fast) == 1:
        print("✅ VERDICT: Good - One model outperforms Ollama")
    elif len(successful) > 0:
        print("⚠️  VERDICT: Mixed - Models work but slower than Ollama")
    else:
        print("❌ VERDICT: Failed - No models completed successfully")
    print("=" * 70)
    
    if best_model:
        print(f"\n📝 Open best model report:")
        print(f"   open {best_model['report_path']}")
    
    print(f"\n📁 All interleaved reports:")
    for r in results:
        if r.get("report_path"):
            print(f"   open {r['report_path']}")
    
    # Manual validation reminder
    print("\n" + "=" * 70)
    print("⚠️  MANUAL VALIDATION REQUIRED")
    print("=" * 70)
    print("Please open the HTML reports and verify:")
    print("1. Output quality (descriptions make sense)")
    print("2. Frame-to-description mapping is correct")
    print("3. No repetition or confusion between frames")
    print("4. Apps and topics are accurately identified")
    print("=" * 70)
    
    return len(fast) > 0


if __name__ == "__main__":
    try:
        success = main()
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        print("\n\n⚠️  Interrupted by user")
        sys.exit(130)
    except Exception as e:
        print(f"\n\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
