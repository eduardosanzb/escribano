"""HTML report generation with dashboard styling."""

import base64
import json
from pathlib import Path
from typing import List, Dict, Any


def generate_html_report(
    benchmark_results: List[Dict[str, Any]], 
    frames: List[Dict[str, Any]], 
    output_path: str
) -> str:
    """
    Generate side-by-side comparison HTML report.
    Uses styling from tools/dashboard/index.html
    """
    
    html_parts = [
        "<!DOCTYPE html>",
        "<html lang='en'>",
        "<head>",
        "  <meta charset='UTF-8'>",
        "  <meta name='viewport' content='width=device-width, initial-scale=1.0'>",
        "  <title>vLLM-MLX POC Results</title>",
        "  <style>",
        "    :root { font-family: system-ui, -apple-system, sans-serif; }",
        "    body { max-width: 1600px; margin: 0 auto; padding: 20px; background: #f5f5f5; }",
        "    h1 { color: #333; margin-bottom: 10px; }",
        "    h2 { color: #555; margin-top: 30px; }",
        "    ",
        "    /* Summary section */",
        "    .summary { background: white; padding: 20px; border-radius: 8px; margin-bottom: 30px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }",
        "    .summary table { width: 100%; border-collapse: collapse; }",
        "    .summary th, .summary td { padding: 12px; text-align: left; border-bottom: 1px solid #eee; }",
        "    .summary th { background: #f8f9fa; font-weight: 600; }",
        "    .summary tr:hover { background: #f8f9fa; }",
        "    ",
        "    /* Frame comparison */",
        "    .frame { background: white; padding: 20px; margin: 20px 0; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }",
        "    .frame-header { font-size: 1.1rem; font-weight: 600; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 2px solid #e0e0e0; color: #333; }",
        "    ",
        "    .comparison { display: grid; grid-template-columns: 300px 1fr 1fr; gap: 20px; }",
        "    ",
        "    .image-col { text-align: center; }",
        "    .image-col img { max-width: 100%; max-height: 200px; border-radius: 4px; border: 1px solid #ddd; }",
        "    .image-col .timestamp { font-size: 0.85rem; color: #666; margin-top: 8px; }",
        "    ",
        "    .vllm-col { background: #f0f7f0; padding: 15px; border-radius: 8px; border-left: 4px solid #4caf50; }",
        "    .ollama-col { background: #f0f4f8; padding: 15px; border-radius: 8px; border-left: 4px solid #2196f3; }",
        "    ",
        "    .col-header { font-weight: 600; margin-bottom: 10px; font-size: 0.9rem; }",
        "    .col-header .meta { font-weight: normal; color: #666; font-size: 0.8rem; }",
        "    ",
        "    .description { font-family: 'Monaco', 'Menlo', monospace; font-size: 0.85rem; line-height: 1.5; background: rgba(255,255,255,0.7); padding: 10px; border-radius: 4px; white-space: pre-wrap; word-break: break-word; }",
        "    ",
        "    /* Badges from dashboard */",
        "    .badges { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }",
        "    .badge { padding: 4px 10px; border-radius: 4px; font-size: 0.75rem; font-weight: 500; }",
        "    .badge-activity { background: #e0e7ff; color: #3730a3; }",
        "    .badge-app { background: #dcfce7; color: #166534; }",
        "    .badge-topic { background: #fef3c7; color: #92400e; }",
        "    ",
        "    /* Judgment section */",
        "    .judgment { margin-top: 15px; padding: 12px; background: #fff8e1; border-radius: 4px; border-left: 4px solid #ffc107; }",
        "    .judgment label { margin-right: 20px; cursor: pointer; }",
        "    .judgment input { margin-right: 5px; }",
        "    ",
        "    /* Stats */",
        "    .stats { display: flex; gap: 20px; margin-top: 20px; padding: 15px; background: #f8f9fa; border-radius: 8px; }",
        "    .stat { display: flex; flex-direction: column; }",
        "    .stat-label { font-size: 0.75rem; color: #666; text-transform: uppercase; }",
        "    .stat-value { font-size: 1.25rem; font-weight: 600; }",
        "    ",
        "    /* Speedup highlight */",
        "    .speedup { color: #4caf50; font-weight: bold; }",
        "    .speedup-poor { color: #f44336; font-weight: bold; }",
        "  </style>",
        "</head>",
        "<body>",
        "  <h1>🔬 vLLM-MLX POC Results</h1>"
    ]
    
    # Summary section
    html_parts.append("  <div class='summary'>")
    html_parts.append("    <h2>Performance Summary</h2>")
    html_parts.append("    <table>")
    html_parts.append("      <tr>")
    html_parts.append("        <th>Concurrency</th>")
    html_parts.append("        <th>Total Time</th>")
    html_parts.append("        <th>Avg per Frame</th>")
    html_parts.append("        <th>Frames/sec</th>")
    html_parts.append("        <th>Throughput</th>")
    html_parts.append("        <th>Speedup vs Baseline</th>")
    html_parts.append("      </tr>")
    
    # Calculate baseline for comparison (8s/frame from VLM-BENCHMARK-LEARNINGS.md)
    baseline_fps = 1 / 8.0  # 0.125 frames/sec
    
    for bench in benchmark_results:
        total_s = bench["total_ms"] / 1000
        avg_s = total_s / bench["frames"]
        fps = bench["frames"] / total_s
        
        # Calculate tokens per second
        total_tokens = sum(r["tokens"] for r in bench["results"])
        tok_per_sec = total_tokens / total_s
        
        # Speedup vs baseline
        speedup = fps / baseline_fps
        speedup_class = "speedup" if speedup >= 1.5 else "speedup-poor"
        
        html_parts.append(f"      <tr>")
        html_parts.append(f"        <td><strong>{bench['concurrency']}</strong></td>")
        html_parts.append(f"        <td>{total_s:.1f}s</td>")
        html_parts.append(f"        <td>{avg_s:.2f}s</td>")
        html_parts.append(f"        <td>{fps:.2f}</td>")
        html_parts.append(f"        <td>{tok_per_sec:.0f} tok/s</td>")
        html_parts.append(f"        <td class='{speedup_class}'>{speedup:.1f}x</td>")
        html_parts.append(f"      </tr>")
    
    html_parts.append("    </table>")
    
    # Best result highlight
    best_bench = max(benchmark_results, key=lambda x: x["frames"] / (x["total_ms"] / 1000))
    best_fps = best_bench["frames"] / (best_bench["total_ms"] / 1000)
    best_speedup = best_fps / baseline_fps
    
    html_parts.append("    <div class='stats'>")
    html_parts.append(f"      <div class='stat'><span class='stat-label'>Best Concurrency</span><span class='stat-value'>{best_bench['concurrency']}</span></div>")
    html_parts.append(f"      <div class='stat'><span class='stat-label'>Best Speedup</span><span class='stat-value'>{best_speedup:.1f}x</span></div>")
    html_parts.append(f"      <div class='stat'><span class='stat-label'>Est. Time (182 frames)</span><span class='stat-value'>{(182 / best_fps / 60):.1f} min</span></div>")
    html_parts.append("    </div>")
    
    html_parts.append("  </div>")
    
    # Frame-by-frame comparison
    html_parts.append("  <h2>Frame-by-Frame Comparison</h2>")
    html_parts.append("  <p><strong>Best configuration:</strong> Concurrency = {}</p>".format(best_bench['concurrency']))
    
    # Use best configuration results for detailed comparison
    vllm_results = {r["frame_id"]: r for r in best_bench["results"]}
    
    for i, frame in enumerate(frames):
        frame_id = frame["id"]
        
        if frame_id not in vllm_results:
            continue
        
        vllm = vllm_results[frame_id]
        
        # Encode image to base64
        try:
            with open(frame["frame_path"], "rb") as f:
                img_b64 = base64.b64encode(f.read()).decode()
        except Exception:
            img_b64 = ""
        
        html_parts.append(f"  <div class='frame'>")
        html_parts.append(f"    <div class='frame-header'>Frame {i+1} | ID: {frame_id[:8]}... | Timestamp: {frame.get('timestamp', 'N/A')}s</div>")
        html_parts.append(f"    <div class='comparison'>")
        
        # Image column
        html_parts.append(f"      <div class='image-col'>")
        if img_b64:
            html_parts.append(f"        <img src='data:image/jpeg;base64,{img_b64}' alt='Frame {i+1}'>")
        else:
            html_parts.append(f"        <div style='padding: 40px; background: #f0f0f0; border-radius: 4px;'>Image not found</div>")
        html_parts.append(f"        <div class='timestamp'>{Path(frame['frame_path']).name}</div>")
        html_parts.append(f"      </div>")
        
        # vLLM column
        html_parts.append(f"      <div class='vllm-col'>")
        html_parts.append(f"        <div class='col-header'>vLLM-MLX <span class='meta'>({vllm['duration_ms']:.0f}ms, {vllm['tokens']} tok)</span></div>")
        html_parts.append(f"        <div class='description'>{vllm.get('description', 'No output')}</div>")
        
        # Badges
        html_parts.append(f"        <div class='badges'>")
        if vllm.get("activity_type"):
            html_parts.append(f"          <span class='badge badge-activity'>{vllm['activity_type']}</span>")
        for app in vllm.get("apps", []):
            html_parts.append(f"          <span class='badge badge-app'>{app}</span>")
        for topic in vllm.get("topics", []):
            html_parts.append(f"          <span class='badge badge-topic'>{topic}</span>")
        html_parts.append(f"        </div>")
        
        html_parts.append(f"      </div>")
        
        # Ollama column
        html_parts.append(f"      <div class='ollama-col'>")
        html_parts.append(f"        <div class='col-header'>Ollama (Baseline)</div>")
        html_parts.append(f"        <div class='description'>{frame.get('ollama_description', 'No description')}</div>")
        
        # Badges
        html_parts.append(f"        <div class='badges'>")
        if frame.get("activity_type"):
            html_parts.append(f"          <span class='badge badge-activity'>{frame['activity_type']}</span>")
        for app in frame.get("apps", []):
            html_parts.append(f"          <span class='badge badge-app'>{app}</span>")
        for topic in frame.get("topics", []):
            html_parts.append(f"          <span class='badge badge-topic'>{topic}</span>")
        html_parts.append(f"        </div>")
        
        html_parts.append(f"      </div>")
        
        html_parts.append(f"    </div>")  # End comparison
        
        # Judgment
        html_parts.append(f"    <div class='judgment'>")
        html_parts.append(f"      <label><input type='checkbox' id='match-{i}'> ✅ Match (accurate)</label>")
        html_parts.append(f"      <label><input type='checkbox' id='review-{i}'> ⚠️ Needs Review</label>")
        html_parts.append(f"    </div>")
        
        html_parts.append(f"  </div>")  # End frame
    
    html_parts.append("</body>")
    html_parts.append("</html>")
    
    # Write file
    output_path_obj = Path(output_path)
    output_path_obj.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path_obj, "w", encoding="utf-8") as f:
        f.write("\n".join(html_parts))
    
    return str(output_path_obj)
