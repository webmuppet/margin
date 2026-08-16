import CoreGraphics
import Foundation

// Prints the window id of the named app's largest on-screen window:
//
//   screencapture -x -o -l"$(swift Support/window-id.swift Margin)" shot.png
//
// Use this rather than a plain screencapture — it photographs that one window
// and nothing else that happens to be on the desktop.
//
// The name is the one the window server knows, which is CFBundleName — so it is
// "Margin", or "Margin Dev" for a `./build.sh --debug` build, never the SwiftPM
// target name.
let target = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "Margin"
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
    as? [[String: Any]] ?? []

let best = list
    .filter { ($0[kCGWindowOwnerName as String] as? String) == target }
    .compactMap { info -> (CGWindowID, Double)? in
        guard let id = info[kCGWindowNumber as String] as? CGWindowID,
              let bounds = info[kCGWindowBounds as String] as? [String: Any],
              let w = bounds["Width"] as? Double, let h = bounds["Height"] as? Double
        else { return nil }
        return (id, w * h)
    }
    .max { $0.1 < $1.1 }

print(best.map { String($0.0) } ?? "")
