#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="Sealio 图章工具"
VERSION="0.1.0"

case "$(uname -m)" in
  arm64 | aarch64)
    ARCH="aarch64"
    ;;
  x86_64)
    ARCH="x64"
    ;;
  *)
    ARCH="$(uname -m)"
    ;;
esac

TAURI_BIN="$ROOT_DIR/node_modules/.bin/tauri"
APP_PATH="$ROOT_DIR/src-tauri/target/release/bundle/macos/$APP_NAME.app"
STAGE_DIR="$ROOT_DIR/src-tauri/target/release/bundle/dmg-stage"
DMG_PATH="$ROOT_DIR/release/Sealio-Tauri-$VERSION-$ARCH.dmg"

PATH="$HOME/.cargo/bin:$PATH" "$TAURI_BIN" build --bundles app

rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR" "$ROOT_DIR/release"
cp -R "$APP_PATH" "$STAGE_DIR/"
ln -s /Applications "$STAGE_DIR/Applications"

hdiutil create \
  -volname "$APP_NAME" \
  -srcfolder "$STAGE_DIR" \
  -ov \
  -format UDZO \
  "$DMG_PATH"

echo "Created $DMG_PATH"
