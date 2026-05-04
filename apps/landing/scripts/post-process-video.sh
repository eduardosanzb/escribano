#!/bin/bash
# Shared ffmpeg post-processing for all video renders
set -e

INPUT="$1"
OUTPUT="$2"
BITRATE="${3:-320k}"

ffmpeg -y -i "$INPUT" \
  -vf scale=in_range=pc:out_range=tv,format=yuv420p \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 \
  -af highpass=f=180:poles=2,volume=2.0 \
  -c:a aac -b:a "$BITRATE" \
  -movflags +faststart \
  "$OUTPUT"
