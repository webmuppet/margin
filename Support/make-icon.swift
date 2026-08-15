#!/usr/bin/env swift
//
// Builds Support/AppIcon.icns from Support/AppIcon-source.png.
//
//   swift Support/make-icon.swift
//
// Run it when the artwork changes. The .icns is committed so an ordinary build
// needs neither this nor sips; the source is committed so the .icns can always
// be rebuilt from something that is not itself a build artefact.
//
// It cuts the ten sizes and does nothing else. See `ratio` for why: two
// attempts at putting the artwork on Apple's grid both made it read smaller
// than the icons beside it, and the reason turned out not to be its size.

import AppKit

let support = URL(fileURLWithPath: CommandLine.arguments.first.map {
    URL(fileURLWithPath: $0).deletingLastPathComponent().path
} ?? ".").standardizedFileURL

let root = FileManager.default.fileExists(atPath: support.appendingPathComponent("AppIcon-source.png").path)
    ? support
    : URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent("Support")

let source = root.appendingPathComponent("AppIcon-source.png")
let iconset = root.appendingPathComponent("AppIcon.iconset")
let icns = root.appendingPathComponent("AppIcon.icns")

guard let master = NSImage(contentsOf: source),
      let artwork = master.cgImage(forProposedRect: nil, context: nil, hints: nil)
else {
    FileHandle.standardError.write(Data("cannot read \(source.path)\n".utf8))
    exit(1)
}

/// The artwork, inset onto the grid and given the shadow the inset makes room
/// for. Drawn at each size rather than once and downscaled: a shadow scaled
/// down with the image loses its softness and reads as a grey edge.
/// How much of the canvas the artwork fills.
///
/// All of it. Apple's own icons sit at 75–80% and leave the rest for the
/// system's shadow, and matching that number exactly — measured against Mail
/// and MarkEdit at both the sizes a Finder list draws — still read as smaller
/// than everything around it. Twice.
///
/// The reason is not geometry. Every neighbour in that row is a light, high
/// contrast icon on a dark list background, and this one is near-black on
/// near-black: its outer edge disappears into the row, so what registers as
/// "the icon" is only the pale marks inside it. Shrinking the body to hit a
/// grid made the visible part smaller still.
///
/// So the artwork is drawn at full size, which is the most that can be done
/// about it here. The rest is a question about the artwork — a lighter ground,
/// or a rim that separates it from the row — and that is not a decision to
/// make on somebody's behalf inside a build script.
func ratio(_ size: Int) -> CGFloat { 1.0 }

func render(_ size: Int) -> Data? {
    let canvas = CGFloat(size)
    let body = (canvas * ratio(size)).rounded()
    let inset = ((canvas - body) / 2).rounded()

    guard let ctx = CGContext(
        data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else { return nil }

    ctx.interpolationQuality = .high
    ctx.clear(CGRect(x: 0, y: 0, width: canvas, height: canvas))
    ctx.draw(artwork, in: CGRect(x: inset, y: inset, width: body, height: body))

    guard let image = ctx.makeImage() else { return nil }
    return NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
}

try? FileManager.default.removeItem(at: iconset)
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)

// Every size macOS asks for. The @2x of one size is the pixel count of the
// next, which is what @2x means and why the list looks repetitive.
let wanted: [(Int, String)] = [
    (16, "icon_16x16.png"), (32, "icon_16x16@2x.png"),
    (32, "icon_32x32.png"), (64, "icon_32x32@2x.png"),
    (128, "icon_128x128.png"), (256, "icon_128x128@2x.png"),
    (256, "icon_256x256.png"), (512, "icon_256x256@2x.png"),
    (512, "icon_512x512.png"), (1024, "icon_512x512@2x.png"),
]

for (size, name) in wanted {
    guard let png = render(size) else {
        FileHandle.standardError.write(Data("could not render \(name)\n".utf8))
        exit(1)
    }
    try png.write(to: iconset.appendingPathComponent(name))
}

let iconutil = Process()
iconutil.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
iconutil.arguments = ["-c", "icns", iconset.path, "-o", icns.path]
try iconutil.run()
iconutil.waitUntilExit()
guard iconutil.terminationStatus == 0 else { exit(iconutil.terminationStatus) }

try? FileManager.default.removeItem(at: iconset)
let bytes = (try? FileManager.default.attributesOfItem(atPath: icns.path))?[.size] as? Int ?? 0
print("AppIcon.icns — \(wanted.count) sizes, artwork at full size, \(bytes) bytes")
