#!/bin/sh
# Maintainer-only conversion; release builds use the checked-in native icons.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ICONS="$ROOT/assets/icons"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir "$WORK/wltoys.iconset"
sips -z 1024 1024 "$ICONS/source.png" --out "$ICONS/wltoys-drive.png" >/dev/null
for SIZE in 16 32 128 256 512; do
  sips -z "$SIZE" "$SIZE" "$ICONS/wltoys-drive.png" --out "$WORK/wltoys.iconset/icon_${SIZE}x${SIZE}.png" >/dev/null
  DOUBLE=$((SIZE * 2))
  sips -z "$DOUBLE" "$DOUBLE" "$ICONS/wltoys-drive.png" --out "$WORK/wltoys.iconset/icon_${SIZE}x${SIZE}@2x.png" >/dev/null
done
iconutil -c icns "$WORK/wltoys.iconset" -o "$ICONS/wltoys-drive.icns"
for SIZE in 16 24 32 48 64 128 256; do
  sips -z "$SIZE" "$SIZE" "$ICONS/wltoys-drive.png" --out "$WORK/$SIZE.png" >/dev/null
done
node --input-type=module - "$WORK" "$ICONS/wltoys-drive.ico" <<'JS'
import fs from 'node:fs';
import path from 'node:path';
const sizes = [16, 24, 32, 48, 64, 128, 256];
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
const frames = sizes.map((size, i) => {
  const png = fs.readFileSync(path.join(process.argv[2], `${size}.png`));
  const entry = 6 + i * 16;
  header[entry] = header[entry + 1] = size % 256;
  header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(png.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
  offset += png.length; return png;
});
fs.writeFileSync(process.argv[3], Buffer.concat([header, ...frames]));
JS
