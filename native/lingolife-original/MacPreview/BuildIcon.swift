import AppKit
import Foundation

let directory = CommandLine.arguments[1]
try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
for (pixels, filename) in [(16, "icon_16x16.png"), (32, "icon_16x16@2x.png"), (32, "icon_32x32.png"), (64, "icon_32x32@2x.png"), (128, "icon_128x128.png"), (256, "icon_128x128@2x.png"), (256, "icon_256x256.png"), (512, "icon_256x256@2x.png"), (512, "icon_512x512.png"), (1024, "icon_512x512@2x.png")] {
    let space = CGColorSpace(name: CGColorSpace.sRGB)!
    let context = CGContext(data: nil, width: pixels, height: pixels, bitsPerComponent: 8, bytesPerRow: pixels * 4, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    let scale = CGFloat(pixels) / 1024
    context.scaleBy(x: scale, y: scale)
    context.setFillColor(CGColor(srgbRed: 0.385, green: 0.486, blue: 0.420, alpha: 1))
    context.addPath(CGPath(roundedRect: CGRect(x: 56, y: 56, width: 912, height: 912), cornerWidth: 210, cornerHeight: 210, transform: nil))
    context.fillPath()
    context.translateBy(x: 164, y: 860)
    context.scaleBy(x: 29, y: -29)
    // Same original leaf path as web/src/original/OriginalIcon.tsx.
    let leaf = CGMutablePath()
    leaf.move(to: CGPoint(x: 19, y: 4))
    leaf.addCurve(to: CGPoint(x: 6, y: 14), control1: CGPoint(x: 9, y: 2), control2: CGPoint(x: 3, y: 7))
    leaf.addCurve(to: CGPoint(x: 19, y: 4), control1: CGPoint(x: 11, y: 18), control2: CGPoint(x: 18, y: 15))
    leaf.closeSubpath()
    leaf.move(to: CGPoint(x: 5, y: 20)); leaf.addLine(to: CGPoint(x: 15, y: 9))
    context.setStrokeColor(CGColor(srgbRed: 0.98, green: 0.965, blue: 0.914, alpha: 1))
    context.setLineWidth(1.65); context.setLineCap(.round); context.setLineJoin(.round)
    context.addPath(leaf); context.strokePath()
    let bitmap = NSBitmapImageRep(cgImage: context.makeImage()!)
    try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: directory).appendingPathComponent(filename))
}
