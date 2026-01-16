#!/usr/bin/env python3
"""
Visual Observer Base - OCR + CLIP indexing for screen recordings.

Usage:
    uv run visual_observer_base.py --frames-dir /path/to/frames --output /path/to/visual-index.json
"""

import argparse
import json
import time
from pathlib import Path
from typing import TypedDict

import open_clip
import pytesseract
import torch
from PIL import Image
from sklearn.cluster import AgglomerativeClustering


# Type definitions
class FrameData(TypedDict):
    index: int
    timestamp: float
    imagePath: str
    ocrText: str
    clusterId: int
    changeScore: float


class ClusterData(TypedDict):
    id: int
    heuristicLabel: str
    timeRange: tuple[float, float]
    frameCount: int
    representativeIdx: int
    avgOcrCharacters: float
    mediaIndicators: list[str]


class VisualIndex(TypedDict):
    frames: list[FrameData]
    clusters: list[ClusterData]
    processingTime: dict[str, int]


# Constants
# Prefer MPS for Apple Silicon, fallback to CPU
DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"
CLIP_MODEL = "ViT-B-32"
CLIP_PRETRAINED = "laion2b_s34b_b79k"
CLUSTER_DISTANCE_THRESHOLD = 0.15  # 1 - 0.85 similarity

UI_CATEGORIES = [
    "A screenshot of a code editor showing programming code",
    "A screenshot of a terminal with command line interface",
    "A screenshot of a web browser showing a website",
    "A screenshot of a video player with playback controls",
    "A screenshot of a document or PDF viewer",
    "A screenshot of an image viewer or photo application",
    "A screenshot of a chat or messaging application",
    "A screenshot of a file manager or finder window",
]

CATEGORY_LABELS = [
    "code-editor",
    "terminal",
    "browser",
    "video-player",
    "document",
    "image-viewer",
    "chat",
    "file-manager",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Visual Observer Base")
    parser.add_argument("--frames-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--frame-interval", type=float, default=2.0,
                        help="Seconds between frames (default: 2)")
    return parser.parse_args()


def load_frames(frames_dir: Path, frame_interval: float) -> list[tuple[int, float, Path]]:
    """Load frame paths and compute timestamps.
    
    Args:
        frames_dir: Directory containing frame images
        frame_interval: Seconds between frames (e.g., 2.0 means frame 0 at 0s, frame 1 at 2s)
    """
    frames = []
    # Assumes filenames like scene_0001.jpg
    # Using sorted glob to ensure chronological order
    all_files = sorted(list(frames_dir.glob("*.jpg")))
    
    for i, path in enumerate(all_files):
        timestamp = i * frame_interval
        frames.append((i, timestamp, path))
        
    return frames


def extract_ocr(image_path: Path) -> str:
    """Extract text from image using Tesseract.
    
    Uses PSM 11 (sparse text) which works better for UI screenshots
    where text is scattered across the screen (menus, buttons, tabs, URLs).
    """
    try:
        image = Image.open(image_path)
        # PSM 11: Sparse text - finds text scattered anywhere (UI elements)
        # OEM 3: Default OCR engine mode (LSTM if available)
        custom_config = r'--psm 11 --oem 3'
        text = pytesseract.image_to_string(image, config=custom_config)
        return text.strip()
    except Exception as e:
        print(f"  Warning: OCR failed for {image_path.name}: {e}")
        return ""


def compute_clip_embeddings(
    frames: list[tuple[int, float, Path]],
    model,
    preprocess,
) -> torch.Tensor:
    """Compute CLIP embeddings for all frames."""
    embeddings = []
    
    for _, _, path in frames:
        try:
            image = preprocess(Image.open(path)).unsqueeze(0).to(DEVICE)
            
            with torch.no_grad():
                embedding = model.encode_image(image)
                embedding = embedding / embedding.norm(dim=-1, keepdim=True)
            
            embeddings.append(embedding.cpu())
        except Exception as e:
            print(f"  Warning: CLIP embedding failed for {path.name}: {e}")
            # Use zero vector as fallback to maintain alignment
            embeddings.append(torch.zeros((1, 512)))
    
    if not embeddings:
        return torch.zeros((0, 512))
        
    return torch.cat(embeddings, dim=0)


def cluster_frames(embeddings: torch.Tensor) -> list[int]:
    """Cluster frames by CLIP embedding similarity."""
    if len(embeddings) < 2:
        return [0] * len(embeddings)
    
    clustering = AgglomerativeClustering(
        n_clusters=None, # type: ignore
        distance_threshold=CLUSTER_DISTANCE_THRESHOLD,
        metric="cosine",
        linkage="average",
    )
    
    labels = clustering.fit_predict(embeddings.numpy())
    return labels.tolist()


def infer_label_with_clip(
    image_path: Path,
    model,
    preprocess,
    tokenizer,
) -> str:
    """Use CLIP zero-shot to classify frame into UI category."""
    try:
        image = preprocess(Image.open(image_path)).unsqueeze(0).to(DEVICE)
        text_tokens = tokenizer(UI_CATEGORIES).to(DEVICE)
        
        with torch.no_grad():
            image_features = model.encode_image(image)
            text_features = model.encode_text(text_tokens)
            
            image_features = image_features / image_features.norm(dim=-1, keepdim=True)
            text_features = text_features / text_features.norm(dim=-1, keepdim=True)
            
            similarity = (100.0 * image_features @ text_features.T).softmax(dim=-1)
            best_idx = similarity.argmax().item()
            
        return CATEGORY_LABELS[best_idx]
    except Exception as e:
        print(f"  Warning: Zero-shot classification failed for {image_path.name}: {e}")
        return "unknown"


def detect_media_indicators(ocr_text: str) -> list[str]:
    """
    Detect indicators that frame shows media content.
    
    TODO: Expand patterns based on real-world testing:
    - Video platforms: Vimeo, Twitch, Netflix, Disney+
    - Image formats: .gif, .webp, .svg, .bmp
    - Media players: VLC, QuickTime, IINA, mpv
    - Streaming: Spotify, Apple Music, SoundCloud
    - Social media: Twitter/X, Instagram, TikTok
    """
    indicators = []
    text_lower = ocr_text.lower()
    
    # Video platforms
    if "youtube" in text_lower:
        indicators.append("youtube")
    
    if "vimeo" in text_lower:
        indicators.append("vimeo")
    
    if "netflix" in text_lower:
        indicators.append("netflix")
    
    # Image files
    image_extensions = [".png", ".jpg", ".jpeg", ".gif", ".webp"]
    if any(ext in text_lower for ext in image_extensions):
        indicators.append("image-file")
    
    # TODO: Add more patterns after dry-run testing
    
    return indicators


def build_cluster_metadata(
    frames_data: list[FrameData],
    cluster_labels: list[int],
    model,
    preprocess,
    tokenizer,
) -> list[ClusterData]:
    """Build metadata for each cluster."""
    clusters: dict[int, list[FrameData]] = {}
    
    for frame, label in zip(frames_data, cluster_labels):
        if label not in clusters:
            clusters[label] = []
        clusters[label].append(frame)
    
    result = []
    for cluster_id, cluster_frames in clusters.items():
        # Find representative (middle frame)
        representative = cluster_frames[len(cluster_frames) // 2]
        
        # Compute average OCR characters
        avg_chars = sum(len(f["ocrText"]) for f in cluster_frames) / len(cluster_frames)
        
        # Get time range
        timestamps = [f["timestamp"] for f in cluster_frames]
        time_range = (float(min(timestamps)), float(max(timestamps)))
        
        # Aggregate media indicators
        all_indicators = set()
        for f in cluster_frames:
            all_indicators.update(detect_media_indicators(f["ocrText"]))
        
        # Infer label using CLIP on representative
        rep_path = Path(representative["imagePath"])
        label = infer_label_with_clip(rep_path, model, preprocess, tokenizer)
        
        result.append({
            "id": cluster_id,
            "heuristicLabel": label,
            "timeRange": time_range,
            "frameCount": len(cluster_frames),
            "representativeIdx": representative["index"],
            "avgOcrCharacters": avg_chars,
            "mediaIndicators": list(all_indicators),
        })
    
    return result


def main():
    args = parse_args()
    
    print(f"Loading frames from {args.frames_dir}...")
    frames = load_frames(args.frames_dir, args.frame_interval)
    
    if not frames:
        print("Error: No frames found")
        return 1
        
    print(f"Found {len(frames)} frames")
    
    # Initialize timing
    timing = {"ocrMs": 0, "clipMs": 0, "clusterMs": 0, "totalMs": 0}
    total_start = time.time()
    
    # Phase 1: OCR
    print("Phase 1: Extracting text with OCR...")
    ocr_start = time.time()
    frames_data: list[FrameData] = []
    
    for idx, timestamp, path in frames:
        ocr_text = extract_ocr(path)
        frames_data.append({
            "index": idx,
            "timestamp": timestamp,
            "imagePath": str(path),
            "ocrText": ocr_text,
            "clusterId": -1,  # Set later
            "changeScore": 0.0,  # TODO: Implement pixel delta if needed
        })
    
    timing["ocrMs"] = int((time.time() - ocr_start) * 1000)
    print(f"  OCR complete: {timing['ocrMs']}ms")
    
    # Phase 2: CLIP embeddings
    print(f"Phase 2: Computing CLIP embeddings on {DEVICE}...")
    clip_start = time.time()
    
    model, _, preprocess = open_clip.create_model_and_transforms(
        CLIP_MODEL, pretrained=CLIP_PRETRAINED
    )
    model.eval()
    model.to(DEVICE)
    tokenizer = open_clip.get_tokenizer(CLIP_MODEL)
    
    embeddings = compute_clip_embeddings(frames, model, preprocess)
    timing["clipMs"] = int((time.time() - clip_start) * 1000)
    print(f"  CLIP complete: {timing['clipMs']}ms")
    
    # Phase 3: Clustering
    print("Phase 3: Clustering frames...")
    cluster_start = time.time()
    
    cluster_labels = cluster_frames(embeddings)
    
    # Update frames with cluster IDs
    for frame, label in zip(frames_data, cluster_labels):
        frame["clusterId"] = label
    
    timing["clusterMs"] = int((time.time() - cluster_start) * 1000)
    print(f"  Clustering complete: {timing['clusterMs']}ms")
    
    # Phase 4: Build cluster metadata
    print("Phase 4: Building cluster metadata...")
    clusters = build_cluster_metadata(
        frames_data, cluster_labels, model, preprocess, tokenizer
    )
    print(f"  Found {len(clusters)} clusters")
    
    timing["totalMs"] = int((time.time() - total_start) * 1000)
    
    # Output
    result: VisualIndex = {
        "frames": frames_data,
        "clusters": clusters,
        "processingTime": timing,
    }
    
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "w") as f:
        json.dump(result, f, indent=2)
    
    print(f"\nOutput written to {args.output}")
    print(f"Total processing time: {timing['totalMs']}ms")
    
    return 0


if __name__ == "__main__":
    exit(main())
