#!/usr/bin/env bash
# Build the macOS gamepad helper: GameController framework -> the existing 8-byte
# joydev event format on stdout (the exact bytes drive.mjs's feedJoyBytes parses).
#
# Needs only the Xcode Command Line Tools (swiftc) — NO full Xcode / xcodebuild.
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

swiftc -O "$DIR/gamepad_mac.swift" -o "$DIR/gamepad_mac" \
  -framework GameController -framework Foundation \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker "$DIR/Info.plist"

echo "built $DIR/gamepad_mac"

# Keyboard helper — reads the physical keyboard (all keys at once) via CGEventTap
# so throttle + steer combine, working around mpv delivering only one key at a
# time. No Info.plist (not GameController). Needs "Input Monitoring" at runtime.
swiftc -O "$DIR/keyboard_mac.swift" -o "$DIR/keyboard_mac" \
  -framework CoreGraphics -framework Foundation -framework AppKit

echo "built $DIR/keyboard_mac"
