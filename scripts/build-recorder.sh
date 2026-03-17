#!/bin/bash
# build-recorder.sh — Build and sign the Swift recorder binary for distribution.
#
# Output: bin/recorder-macos-arm64
#
# Signing tiers (auto-detected):
#   1. APPLE_SIGNING_IDENTITY env var     → explicit identity (CI / paid Developer ID)
#   2. "Apple Development: ..." in keychain → free Apple Developer account (personal use)
#      TCC tracks by Team ID → permissions survive rebuilds on your machine
#   3. Fallback                            → adhoc signing (TCC resets on rebuild, dev only)
#
# For public distribution (other users' machines), you need a paid Apple Developer Program
# membership ($99/yr) for "Developer ID Application" cert + xcrun notarytool notarization.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RECORDER_DIR="$REPO_ROOT/apps/recorder"
OUTPUT="$REPO_ROOT/bin/recorder-macos-arm64"
ENTITLEMENTS="$RECORDER_DIR/entitlements.plist"

echo "Building escribano recorder (Swift)..."
swift build --package-path "$RECORDER_DIR" -c release

mkdir -p "$REPO_ROOT/bin"
cp "$RECORDER_DIR/.build/release/escribano" "$OUTPUT"
echo "Binary copied to: $OUTPUT"

# Resolve signing identity
if [ -n "$APPLE_SIGNING_IDENTITY" ]; then
  IDENTITY="$APPLE_SIGNING_IDENTITY"
else
  IDENTITY=$(security find-identity -v -p codesigning 2>/dev/null \
    | grep -E '"(Apple Development|Developer ID Application):' \
    | head -1 \
    | awk -F'"' '{print $2}')
fi

if [ -n "$IDENTITY" ]; then
  echo "Signing with: $IDENTITY"
  codesign --force --options runtime \
    --entitlements "$ENTITLEMENTS" \
    -s "$IDENTITY" \
    "$OUTPUT"
  echo "Signed successfully."
  echo "TCC will track by Team ID — Screen Recording permission survives rebuilds."
else
  echo "Warning: No signing identity found in keychain."
  echo "  → Using adhoc signing (TCC permission resets on every rebuild)"
  echo "  → To fix: sign in to Xcode with your Apple ID, or set APPLE_SIGNING_IDENTITY"
  codesign --force -s - "$OUTPUT"
fi

echo ""
echo "Done: $OUTPUT"
echo "Now run: pnpm recorder:install (or npx escribano recorder install)"
