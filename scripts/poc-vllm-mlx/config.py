# VLM-MLX POC Configuration
"""Configuration settings for vLLM-MLX benchmarking POC."""

# VLM Prompt - exact same as used in production
VLM_PROMPT = """Analyze this screenshot from a screen recording.

Provide:
- description: What's on screen? Be specific about content, text, and UI elements.
- activity: What is the user doing? (e.g., browsing, coding, reading, debugging)
- apps: Which applications are visible? (e.g., Chrome, VS Code, Terminal)
- topics: What topics, projects, or technical subjects? (e.g., Next.js, Bun, cloud services)

Output in this exact format:
description: ... | activity: ... | apps: [...] | topics: [...]"""

# Model settings
MODEL_NAME = "mlx-community/Qwen3-VL-4B-Instruct-3bit"
TEMPERATURE = 0.3
MAX_TOKENS = 30000

# Database settings
DB_PATH = "~/.escribano/escribano.db"

# Test configuration
TEST_FRAMES = 10
CONCURRENCY_LEVELS = [1, 2]
VLLM_SERVER = "http://localhost:8000/v1"

# Vision caching test: include some duplicates
DUPLICATE_FRAMES = 0  # Repeat 3 frames to test caching

# Baseline performance (from VLM-BENCHMARK-LEARNINGS.md)
BASELINE_SECONDS_PER_FRAME = 8.0
