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
// The whole of what this does is put the artwork on Apple's grid. A macOS app
// icon is not full-bleed: the rounded body occupies 824 of a 1024 canvas, and
// Mail, Notes and Safari all measure at exactly that. The remaining space is
// not waste — it is where the system's drop shadow falls, and it is what makes
// every icon in a Finder window look like it belongs to the same set.
//
// An iOS icon is the opposite: full-bleed, with the OS applying the mask. Ours
// was exported that way, and dropped into a .icns unchanged it came out 24%
// larger than its neighbours with nowhere for a shadow to go — which reads as
// flat and pasted on rather than sitting on the surface.

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
func render(_ size: Int) -> Data? {
    let canvas = CGFloat(size)
    let body = (canvas * 824 / 1024).rounded()
    let inset = ((canvas - body) / 2).rounded()

    guard let ctx = CGContext(
        data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else { return nil }

    ctx.interpolationQuality = .high
    ctx.clear(CGRect(x: 0, y: 0, width: canvas, height: canvas))
    // Proportional to the canvas, so a 16px icon is not carrying a 24px blur.
    ctx.setShadow(
        offset: CGSize(width: 0, height: -canvas * 0.01),
        blur: canvas * 0.023,
        color: NSColor.black.withAlphaComponent(0.28).cgColor
    )
    // Nudged up by half the shadow's drop so the body stays optically centred.
    ctx.draw(artwork, in: CGRect(x: inset, y: inset + canvas * 0.008, width: body, height: body))

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
print("AppIcon.icns — \(wanted.count) sizes, artwork at 80.5% on the macOS grid, \(bytes) bytes")
