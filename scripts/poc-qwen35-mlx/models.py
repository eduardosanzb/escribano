"""
Qwen3.5 model registry for POC testing.

All models are VLMs but mlx-lm v0.30.7+ supports loading them as text-only LLMs.
"""

from dataclasses import dataclass
from typing import List


@dataclass
class ModelConfig:
    name: str
    model_id: str
    size_gb: float
    tier: str  # 'small', 'mid', 'large', 'special'
    note: str


MODELS: List[ModelConfig] = [
    # Small tier (warm-up)
    ModelConfig(
        name="Qwen3.5-4B-OptiQ-4bit",
        model_id="mlx-community/Qwen3.5-4B-OptiQ-4bit",
        size_gb=2.95,
        tier="small",
        note="Smallest, warm-up",
    ),
    # Mid tier
    ModelConfig(
        name="Qwen3.5-9B-OptiQ-4bit",
        model_id="mlx-community/Qwen3.5-9B-OptiQ-4bit",
        size_gb=6.0,
        tier="mid",
        note="Mid tier",
    ),
    # Large tier (vanilla)
    ModelConfig(
        name="Qwen3.5-27B-4bit-mlx",
        model_id="SiddharthaGolu/Qwen3.5-27B-4bit-mlx",
        size_gb=15.0,
        tier="large",
        note="Vanilla 27B",
    ),
    ModelConfig(
        name="Qwen3.5-27B-4bit",
        model_id="mlx-community/Qwen3.5-27B-4bit",
        size_gb=17.0,
        tier="large",
        note="Already cached, retest with mlx-lm 0.30.7+",
    ),
    # Special tier (distilled/abliterated)
    ModelConfig(
        name="Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-4bit",
        model_id="mlx-community/Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-4bit",
        size_gb=14.0,
        tier="special",
        note="Claude-distilled",
    ),
    ModelConfig(
        name="Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-6bit",
        model_id="mlx-community/Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-6bit",
        size_gb=20.0,
        tier="special",
        note="Claude-distilled 6bit",
    ),
    ModelConfig(
        name="Huihui-Qwen3.5-27B-abliterated-6bit",
        model_id="mlx-community/Huihui-Qwen3.5-27B-abliterated-6bit",
        size_gb=21.9,
        tier="special",
        note="Abliterated",
    ),
]
