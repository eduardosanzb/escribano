#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "torch>=2.0",
#   "soundfile",
#   "numpy",
#   "silero-vad",
# ]
# ///
"""
Audio Preprocessor - Silero VAD for speech segment extraction.
Uses soundfile for I/O to avoid torchaudio/torchcodec native dependency issues.

Usage:
    uv run audio_preprocessor.py --audio /path/to/audio.wav --output-dir /tmp/segments --output-json /path/to/segments.json
"""

import argparse
import json
import os
from pathlib import Path
import torch
import soundfile as sf
import numpy as np

def parse_args():
    parser = argparse.ArgumentParser(description="Audio Preprocessor with Silero VAD")
    parser.add_argument("--audio", type=Path, required=True, help="Path to input audio file")
    parser.add_argument("--output-dir", type=Path, required=True, help="Directory to save segment WAV files")
    parser.add_argument("--output-json", type=Path, required=True, help="Path to save segments manifest JSON")
    parser.add_argument("--threshold", type=float, default=0.5, help="VAD threshold (default: 0.5)")
    parser.add_argument("--min-speech-duration-ms", type=int, default=250, help="Min speech duration in ms")
    parser.add_argument("--min-silence-duration-ms", type=int, default=1000, help="Min silence duration in ms")
    return parser.parse_args()

def read_audio_sf(path: str, sampling_rate: int = 16000):
    wav, sr = sf.read(path)
    if len(wav.shape) > 1:
        wav = np.mean(wav, axis=1)
    if sr != sampling_rate:
        # Note: We expect the input to be pre-converted by ffmpeg to 16000
        # But if not, we would need a resampler. For now, we assume sr is correct.
        pass
    return torch.from_numpy(wav.astype(np.float32))

def main():
    args = parse_args()
    
    if not args.audio.exists():
        print(f"Error: Audio file not found: {args.audio}")
        return 1
        
    args.output_dir.mkdir(parents=True, exist_ok=True)
    
    # Load Silero VAD model
    model, utils = torch.hub.load(repo_or_dir='snakers4/silero-vad',
                                  model='silero_vad',
                                  force_reload=False,
                                  onnx=False)
    
    (get_speech_timestamps, _, _, _, _) = utils
    
    # Load audio
    sampling_rate = 16000
    wav = read_audio_sf(str(args.audio), sampling_rate=sampling_rate)
    
    # Get speech timestamps
    speech_timestamps = get_speech_timestamps(
        wav, 
        model, 
        sampling_rate=sampling_rate,
        threshold=args.threshold,
        min_speech_duration_ms=args.min_speech_duration_ms,
        min_silence_duration_ms=args.min_silence_duration_ms
    )
    
    segments = []
    
    for i, ts in enumerate(speech_timestamps):
        start_sec = ts['start'] / sampling_rate
        end_sec = ts['end'] / sampling_rate
        
        # Extract segment
        segment_wav = wav[ts['start']:ts['end']].numpy()
        
        # Save segment to WAV using soundfile
        segment_filename = f"segment_{i:04d}.wav"
        segment_path = args.output_dir / segment_filename
        
        sf.write(str(segment_path), segment_wav, sampling_rate)
        
        segments.append({
            "start": float(start_sec),
            "end": float(end_sec),
            "audioPath": str(segment_path)
        })
        
    # Write manifest
    with open(args.output_json, "w") as f:
        json.dump(segments, f, indent=2)
        
    print(f"Extracted {len(segments)} speech segments to {args.output_dir}")
    print(f"Manifest written to {args.output_json}")
    
    return 0

if __name__ == "__main__":
    exit(main())
