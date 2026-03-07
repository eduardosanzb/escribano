#!/usr/bin/env python3
"""
Qwen3.5 Text-Only Load POC

Tests 7 Qwen3.5 model variants with mlx-lm (not mlx-vlm) to validate
text-only loading support in mlx-lm v0.30.7+.

Usage:
    python run.py [--thinking]

Options:
    --thinking    Also test thinking mode on Prompt A (slower)
"""

import sys
import argparse
from typing import List

from models import MODELS
from benchmark import benchmark_model, BenchmarkResult


def print_results_table(results: List[BenchmarkResult]):
    """Print ASCII table with benchmark results."""
    print("\n" + "="*120)
    print("BENCHMARK RESULTS")
    print("="*120)
    print()

    # Header
    header = (
        f"{'Model':<40} | {'Load':>6} | {'Speed':>7} | {'Memory':>7} | "
        f"{'A Parse':>8} | {'B Parse':>8} | {'Think':>6} | {'Status':<10}"
    )
    print(header)
    print("-" * len(header))

    # Rows
    for r in results:
        if r.error:
            status = "ERROR"
            load_str = "-"
            speed_str = "-"
            mem_str = "-"
            a_str = "-"
            b_str = "-"
            think_str = "-"
        else:
            status = "OK"
            load_str = f"{r.load_time_s:.1f}s"
            speed_str = f"{r.generation_speed_tps:.1f}t/s"
            mem_str = f"{r.peak_memory_gb:.1f}GB"
            a_str = "✓" if r.prompt_a_parsed else "✗"
            b_str = "✓" if r.prompt_b_parsed else "✗"
            think_str = "✓" if r.thinking_works else ("✗" if r.thinking_works is False else "-")

        row = (
            f"{r.model_name:<40} | {load_str:>6} | {speed_str:>7} | {mem_str:>7} | "
            f"{a_str:>8} | {b_str:>8} | {think_str:>6} | {status:<10}"
        )
        print(row)

    print()
    print("="*120)
    print()

    # Summary
    total = len(results)
    passed = sum(1 for r in results if not r.error and r.prompt_a_parsed and r.prompt_b_parsed)
    failed = total - passed

    print(f"Summary: {passed}/{total} models passed both prompts")
    if failed > 0:
        print(f"  {failed} models failed or errored")
        for r in results:
            if r.error or not (r.prompt_a_parsed and r.prompt_b_parsed):
                reason = r.error if r.error else "Parse failure"
                print(f"  - {r.model_name}: {reason}")
    print()


def main():
    parser = argparse.ArgumentParser(description="Qwen3.5 text-only load POC")
    parser.add_argument("--thinking", action="store_true", help="Test thinking mode")
    args = parser.parse_args()

    print("="*120)
    print("Qwen3.5 Text-Only Load POC")
    print("="*120)
    print()
    print(f"Models to test: {len(MODELS)}")
    print(f"Test thinking mode: {args.thinking}")
    print()

    for i, model in enumerate(MODELS, 1):
        print(f"{i}. {model.name} ({model.size_gb} GB) - {model.note}")

    print()
    input("Press Enter to start benchmarks...")
    print()

    results: List[BenchmarkResult] = []

    for model in MODELS:
        result = benchmark_model(model, test_thinking=args.thinking)
        results.append(result)

    print_results_table(results)

    # Return exit code
    all_passed = all(
        not r.error and r.prompt_a_parsed and r.prompt_b_parsed
        for r in results
    )
    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    main()
