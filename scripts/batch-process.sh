#!/bin/bash
# Batch processing with proper DB initialization

VIDEOS=(
  "$HOME/Desktop/Screen Recording 2026-02-21 at 10.03.16.mov"
  "$HOME/Desktop/Screen Recording 2026-02-21 at 21.13.07.mov"
  "$HOME/Desktop/Screen Recording 2026-02-22 at 09.45.32.mov"
  "$HOME/Desktop/Screen Recording 2026-02-23 at 22.50.47.mov"
  "$HOME/Desktop/Screen Recording 2026-02-24 at 09.57.28.mov"
  "$HOME/Desktop/Screen Recording 2026-02-24 at 12.10.13.mov"
  "$HOME/Desktop/Screen Recording 2026-02-24 at 12.26.09.mov"
)

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
