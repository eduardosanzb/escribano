# vLLM-MLX POC Plan

**Date:** February 21, 2026  
**Objective:** Validate vLLM-MLX parallel VLM inference vs Ollama sequential baseline  
**Success Criteria:** 2-3x throughput improvement with maintained accuracy

---

## Overview

This POC will test vLLM-MLX's continuous batching capability using your existing frame data. We'll create a Python script that:

1. Fetches frames from your SQLite DB
2. Processes them with vLLM-MLX (parallel continuous batching)
3. Compares results against your existing Ollama descriptions
4. Generates a performance report similar to VLM-BENCHMARK-LEARNINGS.md

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    POC Python Script                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐     ┌──────────────────┐     ┌─────────────┐  │
│  │   SQLite DB  │────▶│  Frame Extractor │────▶│  Test Set   │  │
│  │              │     │  (182 frames)    │     │  (20-50)    │  │
│  └──────────────┘     └──────────────────┘     └──────┬──────┘  │
│                                                       │          │
│  ┌────────────────────────────────────────────────────┘          │
│  ▼                                                               │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                vLLM-MLX Server (Port 8000)                │  │
│  │  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │  │
│  │  │   Request    │───▶│  Continuous  │───▶│   Model +    │  │  │
│  │  │   Queue      │    │   Batching   │    │  KV Cache    │  │  │
│  │  └──────────────┘    └──────────────┘    └──────────────┘  │  │
│  │                                                             │  │
│  │  Model: mlx-community/Qwen3-VL-4B-Instruct-3bit            │  │
│  │  Mode: --continuous-batching                                │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                              ▼                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                Results Processor                            │  │
│  │  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │  │
│  │  │   Timing     │    │  Description │    │  Comparison  │  │  │
│  │  │   Metrics    │    │  Extraction  │    │   with DB    │  │  │
│  │  └──────────────┘    └──────────────┘    └──────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                              ▼                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              Markdown Report Generator                      │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 1: Environment Setup (30-60 minutes)

**Step 1.1: Install vLLM-MLX**
```bash
# Option A: Using uv (recommended by vLLM-MLX)
uv tool install git+https://github.com/waybarrios/vllm-mlx.git

# Option B: Using pip
pip install git+https://github.com/waybarrios/vllm-mlx.git
```

**Step 1.2: Download Qwen3-VL Model**
```bash
# vLLM-MLX will auto-download on first use, or pre-download:
# Model ID: mlx-community/Qwen3-VL-4B-Instruct-3bit
```

**Step 1.3: Verify Installation**
```bash
# Test server startup
vllm-mlx serve mlx-community/Qwen3-VL-4B-Instruct-3bit --port 8000

# In another terminal, test health endpoint
curl http://localhost:8000/health
```

---

### Phase 2: POC Script Development (2-3 hours)

**File Structure:**
```
scripts/
├── poc-vllm-mlx/
│   ├── __init__.py
│   ├── config.py              # Configuration constants
│   ├── database.py            # SQLite connection
│   ├── frame_loader.py        # Fetch frames from DB
│   ├── vllm_client.py         # vLLM-MLX API client
│   ├── benchmark.py           # Timing and metrics
│   ├── accuracy_checker.py    # Compare with existing descriptions
│   └── report_generator.py    # Markdown report
├── run-poc.py                 # Main entry point
└── requirements.txt
```

**2.1 Configuration (`config.py`)**
```python
# POC Configuration
DB_PATH = "~/.escribano/escribano.db"  # Your DB path
TEST_FRAME_COUNT = 50                 # Number of frames to test
CONCURRENT_REQUESTS = [1, 2, 4, 8]    # Test different parallelism levels
VLLM_SERVER_URL = "http://localhost:8000/v1"
MODEL_NAME = "mlx-community/Qwen3-VL-4B-Instruct-3bit"

# Prompt configuration (match your existing prompt)
PROMPT_TEMPLATE = """Describe this screenshot in detail:
1. What is visible on screen?
2. What is the developer doing?
3. What applications are open?
4. What topics/projects are being worked on?"""
```

**2.2 Database Connection (`database.py`)**
```python
import sqlite3
from pathlib import Path

class EscribanoDB:
    def __init__(self, db_path: str):
        self.db_path = Path(db_path).expanduser()
    
    def get_frames_with_descriptions(self, recording_id: str, limit: int = 50):
        """
        Fetch frames and existing VLM descriptions from DB
        Returns: List[Dict[frame_path, timestamp, existing_description]]
        """
        query = """
        SELECT 
            o.id,
            o.timestamp,
            o.source_path,
            o.vlm_description,
            r.id as recording_id
        FROM observations o
        JOIN recordings r ON o.recording_id = r.id
        WHERE o.type = 'visual'
          AND r.id = ?
          AND o.vlm_description IS NOT NULL
        ORDER BY o.timestamp
        LIMIT ?
        """
        # Implementation here
        pass
    
    def get_latest_recording_id(self):
        """Get most recent recording ID"""
        pass
```

**2.3 vLLM-MLX Client (`vllm_client.py`)**
```python
import asyncio
import aiohttp
import base64
from typing import List, Dict
import time

class VLLMMLXClient:
    def __init__(self, base_url: str, api_key: str = "not-needed"):
        self.base_url = base_url
        self.api_key = api_key
        self.headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
    
    async def describe_frame(self, frame_path: str, prompt: str) -> Dict:
        """
        Send single frame to vLLM-MLX for description
        Returns: {description, tokens_used, duration_ms}
        """
        # Read image and encode as base64
        with open(frame_path, "rb") as f:
            image_base64 = base64.b64encode(f.read()).decode()
        
        payload = {
            "model": "default",
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{image_base64}"
                            }
                        }
                    ]
                }
            ],
            "temperature": 0.3,
            "max_tokens": 30000
        }
        
        start_time = time.perf_counter()
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.base_url}/chat/completions",
                headers=self.headers,
                json=payload
            ) as response:
                result = await response.json()
                duration_ms = (time.perf_counter() - start_time) * 1000
                
                return {
                    "description": result["choices"][0]["message"]["content"],
                    "tokens_used": result["usage"]["total_tokens"],
                    "duration_ms": duration_ms,
                    "frame_path": frame_path
                }
    
    async def describe_frames_parallel(self, frames: List[Dict], max_concurrent: int) -> List[Dict]:
        """
        Process multiple frames with controlled concurrency
        Uses asyncio.Semaphore to limit concurrent requests
        """
        semaphore = asyncio.Semaphore(max_concurrent)
        
        async def process_with_limit(frame):
            async with semaphore:
                return await self.describe_frame(
                    frame["source_path"],
                    frame.get("prompt", PROMPT_TEMPLATE)
                )
        
        tasks = [process_with_limit(frame) for frame in frames]
        return await asyncio.gather(*tasks)
```

**2.4 Benchmark Engine (`benchmark.py`)**
```python
import time
import statistics
from typing import List, Dict
from dataclasses import dataclass

@dataclass
class BenchmarkResult:
    concurrent_level: int
    total_frames: int
    total_duration_ms: float
    avg_duration_ms: float
    median_duration_ms: float
    min_duration_ms: float
    max_duration_ms: float
    total_tokens: int
    avg_tokens_per_frame: float
    throughput_tok_per_sec: float
    throughput_frames_per_sec: float
    
class BenchmarkRunner:
    def __init__(self, client, frames: List[Dict]):
        self.client = client
        self.frames = frames
    
    async def run_benchmark(self, concurrent_level: int) -> BenchmarkResult:
        """
        Run benchmark with specific concurrency level
        """
        print(f"\n=== Testing with {concurrent_level} concurrent requests ===")
        
        start_time = time.perf_counter()
        results = await self.client.describe_frames_parallel(
            self.frames, 
            concurrent_level
        )
        total_duration_ms = (time.perf_counter() - start_time) * 1000
        
        # Calculate metrics
        durations = [r["duration_ms"] for r in results]
        total_tokens = sum(r["tokens_used"] for r in results)
        
        return BenchmarkResult(
            concurrent_level=concurrent_level,
            total_frames=len(self.frames),
            total_duration_ms=total_duration_ms,
            avg_duration_ms=statistics.mean(durations),
            median_duration_ms=statistics.median(durations),
            min_duration_ms=min(durations),
            max_duration_ms=max(durations),
            total_tokens=total_tokens,
            avg_tokens_per_frame=total_tokens / len(self.frames),
            throughput_tok_per_sec=total_tokens / (total_duration_ms / 1000),
            throughput_frames_per_sec=len(self.frames) / (total_duration_ms / 1000)
        )
    
    async def run_all_benchmarks(self, concurrency_levels: List[int]) -> List[BenchmarkResult]:
        """Run benchmarks for all concurrency levels"""
        results = []
        for level in concurrency_levels:
            result = await self.run_benchmark(level)
            results.append(result)
            print(f"✓ Completed: {result.throughput_tok_per_sec:.1f} tok/s")
        return results
```

**2.5 Accuracy Checker (`accuracy_checker.py`)**
```python
from typing import List, Dict
import difflib

class AccuracyChecker:
    def __init__(self):
        pass
    
    def compare_descriptions(self, vllm_desc: str, ollama_desc: str) -> Dict:
        """
        Compare two descriptions and calculate similarity
        Returns: {similarity_ratio, key_differences, verdict}
        """
        # Normalize descriptions
        vllm_normalized = vllm_desc.lower().strip()
        ollama_normalized = ollama_desc.lower().strip()
        
        # Calculate similarity ratio
        similarity = difflib.SequenceMatcher(
            None, 
            vllm_normalized, 
            ollama_normalized
        ).ratio()
        
        # Extract key entities (apps, topics, actions)
        # Simple extraction - could be improved with NLP
        vllm_apps = self._extract_apps(vllm_desc)
        ollama_apps = self._extract_apps(ollama_desc)
        
        return {
            "similarity_ratio": similarity,
            "vllm_apps": vllm_apps,
            "ollama_apps": ollama_apps,
            "apps_match": set(vllm_apps) == set(ollama_apps),
            "verdict": "MATCH" if similarity > 0.8 else "REVIEW"
        }
    
    def _extract_apps(self, description: str) -> List[str]:
        """Extract application names from description"""
        # Look for common patterns like "Applications: X, Y, Z"
        # This is a simple implementation - could be improved
        apps = []
        lines = description.split('\n')
        for line in lines:
            if 'applications:' in line.lower() or 'apps open:' in line.lower():
                # Extract app names after the colon
                apps_part = line.split(':')[1] if ':' in line else ''
                apps = [a.strip() for a in apps_part.split(',')]
        return apps
    
    def validate_batch(self, vllm_results: List[Dict], db_frames: List[Dict]) -> Dict:
        """
        Validate entire batch against DB descriptions
        Returns: Summary statistics
        """
        comparisons = []
        for vllm_result, db_frame in zip(vllm_results, db_frames):
            if db_frame.get("vlm_description"):
                comparison = self.compare_descriptions(
                    vllm_result["description"],
                    db_frame["vlm_description"]
                )
                comparisons.append(comparison)
        
        # Calculate statistics
        similarities = [c["similarity_ratio"] for c in comparisons]
        matches = sum(1 for c in comparisons if c["verdict"] == "MATCH")
        app_matches = sum(1 for c in comparisons if c["apps_match"])
        
        return {
            "total_comparisons": len(comparisons),
            "avg_similarity": sum(similarities) / len(similarities) if similarities else 0,
            "matches": matches,
            "match_rate": matches / len(comparisons) if comparisons else 0,
            "app_match_rate": app_matches / len(comparisons) if comparisons else 0,
            "detailed_comparisons": comparisons
        }
```

**2.6 Report Generator (`report_generator.py`)**
```python
from datetime import datetime
from typing import List, Dict
from pathlib import Path

class ReportGenerator:
    def __init__(self, output_path: str = "docs/VLM-MLX-POC-RESULTS.md"):
        self.output_path = Path(output_path)
    
    def generate_report(
        self, 
        benchmark_results: List[BenchmarkResult],
        accuracy_results: Dict,
        metadata: Dict
    ) -> str:
        """Generate markdown report similar to VLM-BENCHMARK-LEARNINGS.md"""
        
        report = f"""# vLLM-MLX POC Results

**Date:** {datetime.now().strftime("%Y-%m-%d %H:%M")}  
**Model:** {metadata['model']}  
**Test Frames:** {metadata['frame_count']}  
**Hardware:** MacBook Pro M4 Max (128GB)

---

## Executive Summary

### Baseline (Ollama Sequential)
- **Speed:** 38 tok/s (from VLM-BENCHMARK-LEARNINGS.md)
- **Per-frame:** ~8s
- **Total (182 frames):** ~25 minutes

### vLLM-MLX Results

| Concurrent | Throughput (tok/s) | Speedup | Wall-clock (182 frames) |
|------------|-------------------|---------|------------------------|
"""
        
        # Add results table
        for result in benchmark_results:
            speedup = result.throughput_tok_per_sec / 38.0  # vs baseline
            wall_clock_min = (182 / result.throughput_frames_per_sec) / 60
            report += f"| {result.concurrent_level} | {result.throughput_tok_per_sec:.1f} | {speedup:.2f}x | {wall_clock_min:.1f} min |\n"
        
        report += f"""
### Accuracy Validation

| Metric | Value |
|--------|-------|
| Frames Compared | {accuracy_results['total_comparisons']} |
| Avg Similarity | {accuracy_results['avg_similarity']:.2%} |
| Match Rate (>80% similarity) | {accuracy_results['match_rate']:.1%} |
| App Detection Match | {accuracy_results['app_match_rate']:.1%} |

### Key Findings

"""
        
        # Add key findings based on results
        best_result = max(benchmark_results, key=lambda x: x.throughput_tok_per_sec)
        report += f"""1. **Best Performance:** {best_result.concurrent_level} concurrent requests achieved {best_result.throughput_tok_per_sec:.1f} tok/s ({best_result.throughput_tok_per_sec/38:.1f}x speedup)
2. **Accuracy:** {accuracy_results['match_rate']:.1%} of descriptions matched Ollama baseline (>80% similarity)
3. **Recommendation:** {'✅ Viable for production' if best_result.throughput_tok_per_sec > 76 else '⚠️ Marginal improvement'} (needs >2x speedup)

---

## Detailed Results

### Benchmark Metrics

| Concurrent | Total Time | Avg/Frame | Tok/s | Tok/Frame |
|------------|------------|-----------|-------|-----------|
"""
        
        for result in benchmark_results:
            report += f"| {result.concurrent_level} | {result.total_duration_ms/1000:.1f}s | {result.avg_duration_ms/1000:.2f}s | {result.throughput_tok_per_sec:.1f} | {result.avg_tokens_per_frame:.0f} |\n"
        
        report += f"""
### Latency Distribution

| Concurrent | Min | Median | Max |
|------------|-----|--------|-----|
"""
        
        for result in benchmark_results:
            report += f"| {result.concurrent_level} | {result.min_duration_ms/1000:.2f}s | {result.median_duration_ms/1000:.2f}s | {result.max_duration_ms/1000:.2f}s |\n"
        
        report += """
### Sample Comparisons

<details>
<summary>View detailed frame comparisons</summary>

"""
        
        # Add sample comparisons
        for i, comp in enumerate(accuracy_results['detailed_comparisons'][:5]):
            report += f"""#### Frame {i+1}
- **Similarity:** {comp['similarity_ratio']:.2%}
- **Apps Match:** {'✅' if comp['apps_match'] else '❌'}
- **Verdict:** {comp['verdict']}

"""
        
        report += """</details>

---

## Conclusion

### Verdict

"""
        
        # Add verdict based on results
        if best_result.throughput_tok_per_sec >= 114:  # 3x speedup
            report += "**✅ STRONG RECOMMENDATION:** vLLM-MLX provides significant performance improvement (≥3x). Recommend migration from Ollama."
        elif best_result.throughput_tok_per_sec >= 76:  # 2x speedup
            report += "**✅ RECOMMENDATION:** vLLM-MLX provides meaningful improvement (2-3x). Worth migration."
        elif best_result.throughput_tok_per_sec >= 57:  # 1.5x speedup
            report += "**⚠️ MARGINAL:** Improvement is modest (1.5-2x). Consider if complexity is justified."
        else:
            report += "**❌ NOT RECOMMENDED:** No meaningful improvement over sequential Ollama."
        
        report += f"""

### Next Steps

1. {'Proceed with migration planning' if best_result.throughput_tok_per_sec >= 76 else 'Investigate bottlenecks'}
2. Test with full 182-frame recording
3. {'Implement vision embedding caching' if metadata.get('test_caching') else 'Consider vision caching implementation'}
4. Benchmark against other alternatives (LM Studio, pre-computation)

---

**Raw data available in:** `poc-vllm-mlx/results/`
"""
        
        return report
    
    def save_report(self, report: str):
        """Save report to file"""
        self.output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.output_path, 'w') as f:
            f.write(report)
        print(f"✓ Report saved to: {self.output_path}")
```

---

### Phase 3: Main Entry Point (`run-poc.py`)

```python
#!/usr/bin/env python3
"""
vLLM-MLX POC Script
Tests parallel VLM inference vs Ollama sequential baseline
"""

import asyncio
import argparse
from pathlib import Path

from config import (
    DB_PATH, TEST_FRAME_COUNT, CONCURRENT_REQUESTS,
    VLLM_SERVER_URL, MODEL_NAME
)
from database import EscribanoDB
from vllm_client import VLLMMLXClient
from benchmark import BenchmarkRunner
from accuracy_checker import AccuracyChecker
from report_generator import ReportGenerator

async def main():
    parser = argparse.ArgumentParser(description="vLLM-MLX POC")
    parser.add_argument(
        "--frames", 
        type=int, 
        default=TEST_FRAME_COUNT,
        help=f"Number of frames to test (default: {TEST_FRAME_COUNT})"
    )
    parser.add_argument(
        "--concurrent", 
        nargs="+", 
        type=int, 
        default=CONCURRENT_REQUESTS,
        help="Concurrency levels to test"
    )
    parser.add_argument(
        "--server", 
        default=VLLM_SERVER_URL,
        help="vLLM-MLX server URL"
    )
    parser.add_argument(
        "--output", 
        default="docs/VLM-MLX-POC-RESULTS.md",
        help="Output report path"
    )
    args = parser.parse_args()
    
    print("=" * 60)
    print("vLLM-MLX POC - Parallel VLM Inference Test")
    print("=" * 60)
    
    # Step 1: Fetch frames from DB
    print("\n[1/5] Fetching frames from database...")
    db = EscribanoDB(DB_PATH)
    recording_id = db.get_latest_recording_id()
    frames = db.get_frames_with_descriptions(recording_id, args.frames)
    print(f"✓ Loaded {len(frames)} frames from recording {recording_id}")
    
    # Step 2: Initialize client
    print("\n[2/5] Initializing vLLM-MLX client...")
    client = VLLMMLXClient(args.server)
    print(f"✓ Client ready: {args.server}")
    
    # Step 3: Run benchmarks
    print("\n[3/5] Running benchmarks...")
    runner = BenchmarkRunner(client, frames)
    benchmark_results = await runner.run_all_benchmarks(args.concurrent)
    print(f"✓ Completed {len(benchmark_results)} benchmark configurations")
    
    # Step 4: Validate accuracy (compare with existing DB descriptions)
    print("\n[4/5] Validating accuracy...")
    checker = AccuracyChecker()
    # Get results from best performing configuration
    best_config = max(benchmark_results, key=lambda x: x.throughput_tok_per_sec)
    vllm_results = await client.describe_frames_parallel(frames, best_config.concurrent_level)
    accuracy_results = checker.validate_batch(vllm_results, frames)
    print(f"✓ Accuracy: {accuracy_results['match_rate']:.1%} match rate")
    
    # Step 5: Generate report
    print("\n[5/5] Generating report...")
    generator = ReportGenerator(args.output)
    report = generator.generate_report(
        benchmark_results,
        accuracy_results,
        metadata={
            "model": MODEL_NAME,
            "frame_count": len(frames),
            "server_url": args.server,
            "test_caching": False  # Could add caching test in future
        }
    )
    generator.save_report(report)
    
    print("\n" + "=" * 60)
    print("POC Complete!")
    print("=" * 60)
    print(f"\nBest result: {best_config.throughput_tok_per_sec:.1f} tok/s "
          f"({best_config.throughput_tok_per_sec/38:.1f}x speedup)")
    print(f"Accuracy: {accuracy_results['match_rate']:.1%} match rate")
    print(f"\nReport: {args.output}")

if __name__ == "__main__":
    asyncio.run(main())
```

---

## Running the POC

### Step 1: Start vLLM-MLX Server
```bash
# Terminal 1: Start server with continuous batching
vllm-mlx serve mlx-community/Qwen3-VL-4B-Instruct-3bit \
    --port 8000 \
    --continuous-batching

# Verify it's running
curl http://localhost:8000/health
```

### Step 2: Run POC Script
```bash
# Terminal 2: Run the POC
python scripts/poc-vllm-mlx/run-poc.py --frames 50

# Or with custom parameters
python scripts/poc-vllm-mlx/run-poc.py \
    --frames 30 \
    --concurrent 1 2 4 8 \
    --output docs/VLM-MLX-POC-RESULTS.md
```

### Step 3: Review Results
```bash
# View the generated report
cat docs/VLM-MLX-POC-RESULTS.md
```

---

## Success Criteria

| Metric | Target | Threshold |
|--------|--------|-----------|
| **Throughput** | >76 tok/s | >2x baseline (38 tok/s) |
| **Speedup** | 2-3x | Minimum 1.5x |
| **Accuracy** | >80% match rate | No image confusion |
| **Stability** | 0 crashes | Complete 50 frames |

---

## Timeline

| Phase | Duration | Cumulative |
|-------|----------|------------|
| Environment setup | 30-60 min | 1 hour |
| Script development | 2-3 hours | 4 hours |
| Testing & debugging | 1-2 hours | 6 hours |
| **Total** | **4-6 hours** | **6 hours** |

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| vLLM-MLX install fails | Try pip instead of uv; check Python 3.10+ |
| Model download issues | Pre-download with mlx-lm; check disk space |
| Server crashes | Monitor logs; reduce concurrent requests |
| Accuracy issues | Compare with baseline; check prompt matching |
| No performance gain | Test different concurrency levels; profile GPU |

---

**Ready to proceed?** The script structure is designed to mirror your existing benchmark approach. Want me to create the file structure and start implementation?
