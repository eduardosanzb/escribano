# VLM-MLX POC Configuration
"""Configuration settings for mlx-vlm benchmarking POC."""

# Models to test - using bf16 (non-quantized) for batching compatibility
MODELS_TO_TEST = [
    {
        "name": "mlx-community/Qwen3-VL-2B-Instruct-bf16",
        "size": "~4GB",
        "quality": "⭐ Fastest, bf16 (non-quantized for batching)",
        "expected_speed": "Fast (bf16)"
    },
    {
        "name": "mlx-community/gemma-3n-E4B-it-bf16",
        "size": "~8GB",
        "quality": "⭐ Good quality, bf16",
        "expected_speed": "Medium"
    }
]

# Default model (first in list)
MODEL_NAME = MODELS_TO_TEST[0]["name"]

# Generation parameters (match production settings)
TEMPERATURE = 0.3      # Match production VLM temperature
MAX_TOKENS = 500       # Prevent runaway generation
TOP_P = 0.95           # Nucleus sampling

# Batching configuration
BATCH_SIZE = 4

# Interleaved configuration (frames per prompt)
INTERLEAVED_BATCH_SIZE = 4

# Database settings
DB_PATH = "~/.escribano/escribano.db"

# Test configuration
TEST_FRAMES = 30

# Vision caching test: include some duplicates
DUPLICATE_FRAMES = 0  # Disabled for now

# Baseline performance (from VLM-BENCHMARK-LEARNINGS.md)
BASELINE_SECONDS_PER_FRAME = 8.0

# Prompt format - matches production pipeline exactly
# Uses pipe-delimited format that production code parses with regex
VLM_PROMPT = """Analyze this screenshot from a screen recording.

Provide:
- description: What's on screen? Be specific about content, text, and UI elements.
- activity: What is the user doing? (e.g., browsing, coding, reading, debugging)
- apps: Which applications are visible? (e.g., Chrome, VS Code, Terminal)
- topics: What topics, projects, or technical subjects? (e.g., Next.js, Bun, cloud services)

Output in this exact format:
description: ... | activity: ... | apps: [...] | topics: [...]"""

# Interleaved prompt format for multi-image analysis
INTERLEAVED_PROMPT_TEMPLATE = """Analyze these {num_frames} screenshots from a screen recording.

{frames_section}

For each frame above, provide:
- description: What's on screen? Be specific about content, text, and UI elements.
- activity: What is the user doing?
- apps: Which applications are visible?
- topics: What topics, projects, or technical subjects?

Output in this exact format for each frame:
Frame 1: description: ... | activity: ... | apps: [...] | topics: [...]
Frame 2: description: ... | activity: ... | apps: [...] | topics: [...]
...and so on for all {num_frames} frames."""
