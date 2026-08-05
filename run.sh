#!/usr/bin/env bash
# Launch the native WLtoys 6401 driver (Steam Deck / Linux + macOS). Uses the
# portable Node that install.sh set up in ~/wltoys-runtime; if it's missing, it
# fetches one on first run (needs internet once).
#
#   ./run.sh            # drive (video + control)
#   ./run.sh --list     # find which stick axis is which
#   ./run.sh --hud-demo # preview the OSD over a test pattern (no car needed)
#
# Auto-connect: drive.mjs joins the car's WiFi itself (Deck auto-discovers; on
# macOS set CAR_SSID="WL FPV CAR <digits>"). It reconnects if the link drops.
# NO_AUTOCONNECT=1 skips that and uses whatever network is joined. These env vars
# pass straight through to drive.mjs, e.g.  CAR_SSID="WL FPV CAR 75899112" ./run.sh
set -e

HERE="$(cd "$(dirname "$0")" && pwd)"
# Node must run from an exec-capable filesystem, so keep this on internal storage
# (not a noexec exFAT/FAT card). Override with RUNTIME_DIR.
RT="${RUNTIME_DIR:-$HOME/wltoys-runtime}"
NODE_VER="v22.11.0"
NODE_DIR="$RT/node"

# Platform token: linux-x64 | macos-arm64 (also used verbatim in release asset
# names). Rosetta trap: `uname -m` prints x86_64 on an arm64 Mac under a
# translated shell; `sysctl -n hw.optional.arm64` does not — trust it on Darwin.
detect_platform() {
  local arch
  case "$(uname -s)" in
    Darwin)
      if [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = "1" ]; then
        echo "macos-arm64"
      else
        echo "macos-x64"        # honest, but no assets built for it (unsupported)
      fi
      ;;
    Linux)
      case "$(uname -m)" in
        aarch64|arm64) arch="arm64" ;;
        *)             arch="x64" ;;
      esac
      echo "linux-$arch"
      ;;
    *) echo "unknown-unknown" ;;
  esac
}

PLATFORM="$(detect_platform)"
# nodejs.org names its macOS builds "darwin", not "macos" — remap the token so
# the download URL is correct (the token itself stays right for asset names).
case "$PLATFORM" in
  macos-arm64) NODE_SLUG="darwin-arm64" ;;
  linux-x64)   NODE_SLUG="linux-x64" ;;
  *) echo "run.sh: unsupported platform: $PLATFORM (need macos-arm64 or linux-x64)"; exit 1 ;;
esac

if [ ! -x "$NODE_DIR/bin/node" ]; then
  echo "Node not set up — run 'bash install.sh' first (needs internet). Fetching now…"
  mkdir -p "$RT"
  curl -fsSL "https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-$NODE_SLUG.tar.gz" | tar -xz -C "$RT"
  mv "$RT/node-$NODE_VER-$NODE_SLUG" "$NODE_DIR"
fi

# Mac players are a brew prereq (not bundled). Warn — non-fatal — if they're not
# on PATH; Apple-Silicon Homebrew lives in /opt/homebrew/bin, which a Finder- or
# Steam-launched shell may lack even when mpv/ffmpeg are installed.
if [ "$PLATFORM" = "macos-arm64" ]; then
  command -v mpv    >/dev/null 2>&1 || echo "run.sh: mpv not on PATH — the video HUD needs it: brew install mpv"
  command -v ffmpeg >/dev/null 2>&1 || echo "run.sh: ffmpeg not on PATH — optional; only the ffplay fallback if mpv can't run: brew install ffmpeg"
fi

# Game Mode has NO terminal: stderr goes nowhere, so every [wifi]/[drive] line —
# including the reason auto-connect failed — vanishes, and "it didn't connect" is
# indistinguishable from "it never tried". When stderr isn't a tty, tee the whole
# run into a log file instead (keeping one previous run), led by a short env dump.
# That dump is the point: a Steam-launched process inherits the Steam runtime's
# LD_PRELOAD/LD_LIBRARY_PATH and has no polkit agent behind it, either of which can
# break the nmcli calls auto-connect is built on — and Game Mode is the only place
# that happens. Probing nmcli HERE runs it in the exact environment drive.mjs will.
LOG="${WLTOYS_LOG:-$HOME/wltoys-drive.log}"
if [ -t 2 ]; then
  exec "$NODE_DIR/bin/node" "$HERE/drive.mjs" "$@"
fi
if [ -f "$LOG" ]; then mv -f "$LOG" "$LOG.prev"; fi
{
  echo "=== wltoys-drive $(date -u +%Y-%m-%dT%H:%M:%SZ)  platform=$PLATFORM ==="
  echo "app=$HERE"
  echo "args=$*"
  echo "session=${XDG_SESSION_TYPE:-?}/${XDG_CURRENT_DESKTOP:-?}  steam=${SteamAppId:-none}"
  echo "LD_PRELOAD=${LD_PRELOAD:-<unset>}"
  echo "LD_LIBRARY_PATH=${LD_LIBRARY_PATH:-<unset>}"
  if command -v nmcli >/dev/null 2>&1; then
    echo "nmcli=$(command -v nmcli)"
    nmcli --version 2>&1 | head -1
    rc=0; out="$(nmcli -t -f ACTIVE,SSID device wifi 2>&1)" || rc=$?
    echo "nmcli probe exit=$rc"
    [ "$rc" = "0" ] && echo "active=$(echo "$out" | grep '^yes' | head -1)" || echo "nmcli said: $out"
  else
    echo "nmcli=MISSING FROM PATH — auto-connect cannot work"
  fi
  echo "=== app output ==="
} > "$LOG" 2>&1
exec "$NODE_DIR/bin/node" "$HERE/drive.mjs" "$@" >> "$LOG" 2>&1
