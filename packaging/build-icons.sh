#!/bin/sh
# Maintainer-only conversion; release builds use the checked-in native icons.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ICONS="$ROOT/assets/icons"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir "$WORK/wltoys.iconset"
swift - "$ICONS/source.png" "$ICONS/wltoys-drive.png" <<'SWIFT'
import AppKit
let image = NSImage(contentsOfFile: CommandLine.arguments[1])!
let edge = 1024
let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: edge, pixelsHigh: edge,
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: edge * 4, bitsPerPixel: 32)!
let context = NSGraphicsContext(bitmapImageRep: bitmap)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = context
context.cgContext.clear(CGRect(x: 0, y: 0, width: edge, height: edge))
let scale = CGFloat(edge) / max(image.size.width, image.size.height)
let width = image.size.width * scale, height = image.size.height * scale
image.draw(in: NSRect(x: (CGFloat(edge) - width) / 2, y: (CGFloat(edge) - height) / 2,
    width: width, height: height), from: .zero, operation: .sourceOver, fraction: 1,
    respectFlipped: false, hints: [.interpolation: NSImageInterpolation.high])
NSGraphicsContext.restoreGraphicsState()
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
SWIFT
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
