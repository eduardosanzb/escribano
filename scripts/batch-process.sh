#!/bin/bash
# Batch processing with proper DB initialization

# Add your video files here, or pass them as arguments
# Example: ./batch-process.sh ~/Desktop/recording1.mov ~/Desktop/recording2.mov
VIDEOS=(
  # "$HOME/Desktop/Screen Recording 1.mov"
  # "$HOME/Desktop/Screen Recording 2.mov"
)

# Override with command-line arguments if provided
if [ ${#@} -gt 0 ]; then
  VIDEOS=("$@")
fi

if [ ${#VIDEOS[@]} -eq 0 ]; then
  echo "Usage: ./batch-process.sh <video1.mov> [video2.mov] ..."
  echo "Or edit the VIDEOS array in this script"
  exit 1
fi

TOTAL=${#VIDEOS[@]}
CURRENT=0
SUCCESS=0
FAILED=0

echo "========================================"
echo "ESCRIbano Batch Processor"
echo "========================================"
echo ""

# Clean shutdown of any lingering processes
echo "Cleaning up any lingering processes..."
pkill -f "tsx" 2>/dev/null || true
pkill -f "escribano" 2>/dev/null || true
sleep 2

# Ensure DB is fresh (remove WAL files that can cause I/O errors)
echo "Cleaning database files..."
rm -f ~/.escribano/escribano.db-shm ~/.escribano/escribano.db-wal 2>/dev/null || true
echo "✓ Database ready"
echo ""

echo "Starting batch processing of $TOTAL videos"
echo "Started at: $(date)"
echo "========================================"
echo ""

for video in "${VIDEOS[@]}"; do
  CURRENT=$((CURRENT + 1))
  BASENAME=$(basename "$video")
  
  echo ""
  echo "[$CURRENT/$TOTAL] Processing: $BASENAME"
  echo "Started: $(date)"
  echo "----------------------------------------"
  
  # Run escribano - continue even on error
  pnpm escribano --file "$video" 2>&1
  EXIT_CODE=$?
  
  echo "----------------------------------------"
  
  if [ $EXIT_CODE -eq 0 ]; then
    echo "[$CURRENT/$TOTAL] ✓ SUCCESS: $BASENAME"
    SUCCESS=$((SUCCESS + 1))
  else
    echo "[$CURRENT/$TOTAL] ✗ FAILED (exit $EXIT_CODE): $BASENAME"
    FAILED=$((FAILED + 1))
    echo "Continuing with next video..."
  fi
  
  echo "Finished: $(date)"
  echo "========================================"
  
  # Cleanup WAL files between runs to prevent I/O errors
  rm -f ~/.escribano/escribano.db-shm ~/.escribano/escribano.db-wal 2>/dev/null || true
  
  # Wait for resources to release
  sleep 3
done

echo ""
echo "========================================"
echo "BATCH COMPLETE"
echo "========================================"
echo "Finished at: $(date)"
echo "Total: $CURRENT videos"
echo "Success: $SUCCESS"
echo "Failed: $FAILED"
echo "========================================"
