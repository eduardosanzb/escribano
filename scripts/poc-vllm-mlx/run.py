#!/usr/bin/env python3
"""
mlx-vlm POC - Multi-Model Benchmark

Tests 4 models sequentially:
1. Qwen3-VL-2B-Instruct-4bit (smallest, ~2GB) - Direct comparison to Ollama
2. gemma-3n-E4B-it-bf16 (fast, ~8GB)
3. pixtral-12b-8bit (medium, ~12GB)  
4. InternVL3-14B-8bit (highest quality, ~14GB)

Usage:
    python scripts/poc-vllm-mlx/run.py
    
Prerequisites:
    uv pip install -r scripts/poc-vllm-mlx/requirements.txt
"""

import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from config import (
    DB_PATH, TEST_FRAMES, MODELS_TO_TEST, TEMPERATURE, MAX_TOKENS,
    DUPLICATE_FRAMES, BASELINE_SECONDS_PER_FRAME, VLM_PROMPT
)
from db import get_frames
from benchmark import MLXVLMBenchmark, format_as_pipe_delimited
from report import generate_html_report


def test_model(model_info: dict, frames: list, model_index: int, total_models: int) -> dict:
    """Test a single model and return results."""
    model_name = model_info["name"]
    
    print("\n" + "=" * 70)
    print(f"🧪 MODEL {model_index}/{total_models}: {model_name}")
    print("=" * 70)
    print(f"   Size: {model_info['size']}")
    print(f"   Expected Quality: {model_info['quality']}")
    print(f"   Expected Speed: {model_info['expected_speed']}")
    print("=" * 70)
    
    try:
        # Load model
        print(f"\n[1/3] Loading model...")
        benchmark = MLXVLMBenchmark(model_name)
        
        # Run benchmark
        print(f"\n[2/3] Running benchmark...")
        result = benchmark.run_benchmark(frames, VLM_PROMPT, TEMPERATURE, MAX_TOKENS)
        
        # Format outputs
        print(f"\n[3/3] Formatting outputs...")
        for r in result["results"]:
            if not r["error"]:
                r["formatted_output"] = format_as_pipe_delimited(r)
        
        # Generate model-specific report
        model_slug = model_name.split("/")[-1].replace("-", "_")
        output_path = f"docs/mlx-vlm-poc-{model_slug}.html"
        generate_html_report([result], frames, output_path)
        print(f"   ✓ Report: {output_path}")
        
        # Calculate metrics
        total_s = result["total_ms"] / 1000
        fps = result["frames"] / total_s if result["frames"] > 0 else 0
        baseline_fps = 1 / BASELINE_SECONDS_PER_FRAME
        speedup = fps / baseline_fps if baseline_fps > 0 else 0
        
        # Calculate token rate
        total_tokens = sum(r.get("tokens", 0) for r in result["results"] if not r["error"])
        tok_per_sec = total_tokens / total_s if total_s > 0 else 0
        
        return {
            "model_name": model_name,
            "model_info": model_info,
            "success": True,
            "result": result,
            "metrics": {
                "total_s": total_s,
                "fps": fps,
                "speedup": speedup,
                "tok_per_sec": tok_per_sec,
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
    print("🚀 mlx-vlm POC - Multi-Model Benchmark")
    print("=" * 70)
    print(f"\nTesting {len(MODELS_TO_TEST)} models sequentially")
    print("Each model will process 10 frames")
    print()
    
    # 1. Fetch frames once
    print("[PREP] Fetching frames from database...")
    print(f"       Database: {DB_PATH}")
    frames = get_frames(DB_PATH, TEST_FRAMES)
    print(f"       ✓ Loaded {len(frames)} frames")
    
    if not frames:
        print("\n❌ ERROR: No frames found in database!")
        sys.exit(1)
    
    # 2. Test each model
    results = []
    for i, model_info in enumerate(MODELS_TO_TEST, 1):
        result = test_model(model_info, frames, i, len(MODELS_TO_TEST))
        results.append(result)
        
        # Brief pause between models to clear memory
        if i < len(MODELS_TO_TEST):
            print("\n   [Pausing 2s to clear memory...]")
            import time
            time.sleep(2)
    
    # 3. Print comparison summary
    print("\n" + "=" * 70)
    print("📊 COMPARISON SUMMARY")
    print("=" * 70)
    
    # Header
    print(f"\n{'Model':<35} {'Time':<8} {'FPS':<8} {'Speedup':<10} {'Tok/s':<8} {'Status':<10}")
    print("-" * 90)
    
    # Results table
    best_model = None
    best_speedup = 0
    
    for r in results:
        model_name = r["model_name"].split("/")[-1][:32]
        
        if r["success"]:
            m = r["metrics"]
            status = "✅ PASS" if m["speedup"] >= 1.0 else "⚠️  SLOW"
            print(f"{model_name:<35} {m['total_s']:<8.1f} {m['fps']:<8.2f} {m['speedup']:<10.1f}x {m['tok_per_sec']:<8.1f} {status:<10}")
            
            if m["speedup"] > best_speedup:
                best_speedup = m["speedup"]
                best_model = r
        else:
            print(f"{model_name:<35} {'N/A':<8} {'N/A':<8} {'N/A':<10} {'N/A':<8} ❌ FAIL")
    
    print("-" * 90)
    
    # Best model highlight
    if best_model:
        print(f"\n🏆 BEST MODEL: {best_model['model_name']}")
        print(f"   Speedup: {best_model['metrics']['speedup']:.1f}x vs Ollama baseline")
        print(f"   Token Rate: {best_model['metrics']['tok_per_sec']:.1f} tok/s")
        print(f"   Report: {best_model['report_path']}")
    
    # Overall verdict
    print("\n" + "=" * 70)
    successful_models = [r for r in results if r["success"]]
    fast_models = [r for r in results if r["success"] and r["metrics"]["speedup"] >= 1.0]
    
    if len(fast_models) >= 2:
        print("✅ VERDICT: Excellent - Multiple models outperform Ollama")
    elif len(fast_models) == 1:
        print("✅ VERDICT: Good - One model outperforms Ollama")
    elif len(successful_models) > 0:
        print("⚠️  VERDICT: Mixed - Models work but slower than Ollama")
    else:
        print("❌ VERDICT: Failed - No models completed successfully")
    print("=" * 70)
    
    # Open best report
    if best_model:
        print(f"\n📝 Open best model report:")
        print(f"   open {best_model['report_path']}")
    
    print(f"\n📁 All reports:")
    for r in results:
        if r.get("report_path"):
            print(f"   open {r['report_path']}")
    
    return len(fast_models) > 0


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
