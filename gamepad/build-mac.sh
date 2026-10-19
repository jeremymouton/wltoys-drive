#!/usr/bin/env bash
# Build the macOS gamepad helper: GameController framework -> the existing 8-byte
# joydev event format on stdout (the exact bytes drive.mjs's feedJoyBytes parses).
#
# Needs Xcode Command Line Tools and Homebrew mpv (including libmpv headers).
# The Info.plist is embedded into the binary via the linker so
# GCController.controllers() actually populates.
#
# bash 3.2 safe (stock macOS /bin/bash). Paths resolve from this script's dir, so
# it works from any cwd.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v swiftc >/dev/null 2>&1; then
  echo "swiftc not found. Install the Xcode Command Line Tools:  xcode-select --install" >&2
  exit 1
fi

swiftc -target arm64-apple-macos14.0 -O "$DIR/gamepad_mac.swift" -o "$DIR/gamepad_mac" \
  -framework GameController -framework Foundation \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker "$DIR/Info.plist"

echo "built $DIR/gamepad_mac"

# The player owns its Cocoa window, so keyboard events never need a global tap.
MPV_PREFIX="$(brew --prefix mpv)"
clang -fobjc-arc -fblocks -O2 -mmacosx-version-min=14.0 "$DIR/player_mac.m" \
  -I"$MPV_PREFIX/include" -L"$MPV_PREFIX/lib" -lmpv \
  -framework Cocoa -framework OpenGL -o "$DIR/player_mac"
echo "built $DIR/player_mac"
