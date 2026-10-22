import AppKit

let base = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent()
let hud = NSImage(contentsOf: base.appendingPathComponent("source/hud-preview.jpg"))!
let car = NSImage(contentsOf: base.appendingPathComponent("source/wltoys-6401.jpg"))!
let deck = NSImage(contentsOf: base.appendingPathComponent("source/steam-deck-oled.png"))!
let logo = NSImage(contentsOf: base.deletingLastPathComponent().appendingPathComponent("icons/wltoys-drive.png"))!

func photo(_ image: NSImage, _ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) {
    image.draw(in: NSRect(x: x, y: y, width: w, height: h), from: .zero,
               operation: .sourceOver, fraction: 1, respectFlipped: true,
               hints: [.interpolation: NSImageInterpolation.high])
}

func app(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat) {
    let h = w * 9 / 16
    let frame = NSBezierPath(roundedRect: NSRect(x: x, y: y, width: w, height: h + 38),
                             xRadius: 8, yRadius: 8)
    NSColor(calibratedWhite: 0.95, alpha: 1).setFill()
    frame.fill()
    NSColor(calibratedWhite: 0.80, alpha: 1).setStroke()
    frame.lineWidth = 1
    frame.stroke()
    for (i, color) in [NSColor.systemRed, .systemYellow, .systemGreen].enumerated() {
        color.setFill()
        NSBezierPath(ovalIn: NSRect(x: x + 16 + CGFloat(i) * 20,
                                  y: y + 14, width: 10, height: 10)).fill()
    }
    photo(logo, x + w / 2 - 67, y + 6, 26, 26)
    ("wltoys-drive" as NSString).draw(at: NSPoint(x: x + w / 2 - 35, y: y + 11),
        withAttributes: [.font: NSFont.systemFont(ofSize: 13),
                         .foregroundColor: NSColor(calibratedWhite: 0.42, alpha: 1)])
    photo(hud, x + 3, y + 38, w - 6, (w - 6) * 9 / 16)
}

func handheld(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat) {
    let scale = w / 1964
    photo(deck, x, y, w, 761 * scale)
    // OLED active display: 984×615 (16:10); center the 16:9 camera view.
    NSColor.black.setFill()
    NSRect(x: x + 491 * scale, y: y + 69 * scale,
           width: 984 * scale, height: 615 * scale).fill()
    let videoH: CGFloat = 984 * 9 / 16
    photo(hud, x + 491 * scale, y + (69 + (615 - videoH) / 2) * scale,
          984 * scale, videoH * scale)
}

func render(_ filename: String, _ width: Int, _ height: Int, _ draw: () -> Void) {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width,
        pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
        isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: width * 4,
        bitsPerPixel: 32)!
    let context = NSGraphicsContext(bitmapImageRep: bitmap)!
    NSGraphicsContext.saveGraphicsState()
    context.cgContext.translateBy(x: 0, y: CGFloat(height))
    context.cgContext.scaleBy(x: 1, y: -1)
    NSGraphicsContext.current = NSGraphicsContext(cgContext: context.cgContext, flipped: true)
    NSColor.white.setFill()
    NSRect(x: 0, y: 0, width: width, height: height).fill()
    draw()
    NSGraphicsContext.restoreGraphicsState()
    try! bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.9])!
        .write(to: base.appendingPathComponent(filename))
    print("Rendered \(filename): \(width)×\(height)")
}

render("overview.jpg", 1800, 900) {
    app(70, 65, 740)
    handheld(840, 170, 930)
    photo(logo, 200, 550, 320, 320)
    let ratio = car.size.width / car.size.height
    let w: CGFloat = ratio > 1 ? 370 : 340 * ratio
    let h = w / ratio
    photo(car, 900 - w / 2, 550, w, h)
}

render("hud.jpg", 1280, 720) { photo(hud, 0, 0, 1280, 720) }
