#!/bin/bash
# build-app.sh — Build Escribano.app bundle + DMG for distribution.
#
# Output: dist/Escribano.app and dist/Escribano.dmg
#
# Usage: bash scripts/build-app.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RECORDER_DIR="$REPO_ROOT/apps/recorder"
DIST_DIR="$REPO_ROOT/dist"
APP_DIR="$DIST_DIR/Escribano.app"
CONTENTS="$APP_DIR/Contents"
ENTITLEMENTS="$RECORDER_DIR/entitlements.plist"
INFO_PLIST="$RECORDER_DIR/Info.plist"

echo "==> Building Swift binary..."
swift build --package-path "$RECORDER_DIR" -c release

echo "==> Assembling Escribano.app..."
rm -rf "$APP_DIR"
mkdir -p "$CONTENTS/MacOS"
mkdir -p "$CONTENTS/Resources/migrations"

# Binary
cp "$RECORDER_DIR/.build/release/escribano" "$CONTENTS/MacOS/escribano"

# Info.plist
cp "$INFO_PLIST" "$CONTENTS/Info.plist"

# Resources: migration SQL files
shopt -s nullglob
SQL_FILES=("$REPO_ROOT"/migrations/*.sql)
shopt -u nullglob
if [ ${#SQL_FILES[@]} -eq 0 ]; then
  echo "Warning: No .sql migration files found in $REPO_ROOT/migrations/" >&2
else
  cp "${SQL_FILES[@]}" "$CONTENTS/Resources/migrations/"
fi

# Resources: Python bridge script
cp "$REPO_ROOT/scripts/mlx_bridge.py" "$CONTENTS/Resources/mlx_bridge.py"

echo "==> Bundle assembled: $APP_DIR"

# Resolve signing identity
if [ -n "$APPLE_SIGNING_IDENTITY" ]; then
  IDENTITY="$APPLE_SIGNING_IDENTITY"
else
  IDENTITY=$(security find-identity -v -p codesigning 2>/dev/null \
    | grep -E '"(Apple Development|Developer ID Application):' \
    | head -1 \
    | awk -F'"' '{print $2}') || true
fi

if [ -n "$IDENTITY" ]; then
  echo "==> Signing with: $IDENTITY"
  codesign --force --deep --options runtime \
    --entitlements "$ENTITLEMENTS" \
    -s "$IDENTITY" \
    "$APP_DIR"
  echo "==> Signed successfully."
else
  echo "==> Warning: No signing identity found. Using adhoc signing."
  echo "   (TCC permission will reset on every rebuild)"
  codesign --force --deep -s - "$APP_DIR"
fi

echo "==> Creating DMG..."
DMG_PATH="$DIST_DIR/Escribano.dmg"
rm -f "$DMG_PATH"

# Create a temporary DMG with the app
hdiutil create -volname "Escribano" \
  -srcfolder "$APP_DIR" \
  -ov -format UDZO \
  "$DMG_PATH"

echo ""
echo "==> Done!"
echo "   App:  $APP_DIR"
echo "   DMG:  $DMG_PATH"
echo ""
echo "To install: open $DMG_PATH and drag Escribano to /Applications"
