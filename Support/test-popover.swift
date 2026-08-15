// Tests for the one click that must not cost you a note.
//
//   swift build
//   swiftc -parse-as-library -I .build/debug/Modules \
//          $(find Sources/Imark -name '*.swift' ! -name main.swift) \
//          $(find Sources/ImarkRender -name '*.swift') \
//          Support/test-popover.swift -o /tmp/imark-test-popover && /tmp/imark-test-popover
//
// The composer holds the popover open on purpose: `applicationDefined` is what
// stops a stray click binning a half-written note. The cost of that was that an
// empty composer — opened by accident, or opened and thought better of — could
// only be closed by finding Cancel.
//
// So the protection is now conditional, and a condition that guesses wrong in
// one direction silently destroys somebody's writing. That is not a thing to
// establish by trying it once by hand. Both directions are checked here.
//
// These are posted events, not synthetic clicks. A CGEvent needs accessibility
// permission a terminal does not have, which is why the review handshake cannot
// be tested this way — but a local event monitor sees anything the app dispatches
// through its own event loop, and that is exactly what this watches for.

import AppKit

@main
enum PopoverTest {
    static var failures = 0

    static func check(_ name: String, _ condition: Bool, _ detail: @autoclosure () -> String = "") {
        if condition {
            print("OK   \(name)")
        } else {
            failures += 1
            print("FAIL \(name)\(detail().isEmpty ? "" : " — \(detail())")")
        }
    }

    static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.prohibited)

        emptyComposerGoesAway()
        writingIsNotThrownAway()
        aColourChangeCounts()
        clicksInsideDoNotCount()

        print(failures == 0 ? "\nall good" : "\n\(failures) failing")
        exit(failures == 0 ? 0 : 1)
    }

    // MARK: - The stage

    /// A window off-screen with a view big enough to anchor a popover to.
    static func stage() -> (NSWindow, NSView) {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 600, height: 400),
            styleMask: [.titled], backing: .buffered, defer: false
        )
        window.setFrameOrigin(NSPoint(x: -6_000, y: 0))
        let view = NSView(frame: NSRect(x: 0, y: 0, width: 600, height: 400))
        window.contentView = view
        window.makeKeyAndOrderFront(nil)
        return (window, view)
    }

    static let anchor = NSRect(x: 200, y: 200, width: 120, height: 18)

    /// Runs the run loop *and* pumps the application's event queue.
    ///
    /// RunLoop.run on its own is not enough, and the way it fails is a trap: a
    /// posted event sits in NSApplication's queue undispatched, the local
    /// monitor never runs, and every case that expects the popover to stay open
    /// passes for the wrong reason. Two of the four here did exactly that.
    static func spin(_ seconds: TimeInterval = 0.35) {
        let until = Date().addingTimeInterval(seconds)
        while Date() < until {
            guard let event = NSApp.nextEvent(
                matching: .any, until: Date().addingTimeInterval(0.02),
                inMode: .default, dequeue: true
            ) else { continue }
            NSApp.sendEvent(event)
        }
    }

    /// A click somewhere that is not the popover, delivered the way a real one
    /// would be: through the application's own event loop.
    static func clickAway(in window: NSWindow) {
        guard let event = NSEvent.mouseEvent(
            with: .leftMouseDown,
            location: NSPoint(x: 40, y: 40),
            modifierFlags: [],
            timestamp: ProcessInfo.processInfo.systemUptime,
            windowNumber: window.windowNumber,
            context: nil,
            eventNumber: 0,
            clickCount: 1,
            pressure: 1
        ) else { return }
        NSApp.postEvent(event, atStart: false)
        spin(0.3)
    }

    // MARK: - The cases

    static func emptyComposerGoesAway() {
        print("▸ a composer nobody has typed in closes when you click away")

        let (window, view) = stage()
        let popover = SelectionPopover()
        popover.compose(existing: "", colour: .standard, at: anchor, in: view)
        spin()
        check("the composer opened", popover.isShowing)

        clickAway(in: window)
        check("and a click in the document closed it", !popover.isShowing)

        window.close()
    }

    static func writingIsNotThrownAway() {
        print("\n▸ but one with a note in it stays put")

        let (window, view) = stage()
        let popover = SelectionPopover()
        popover.compose(existing: "", colour: .standard, at: anchor, in: view)
        spin()
        popover.composedText = "Half a thought, not finished yet."

        clickAway(in: window)
        // One check, not two. Asking separately whether the text survived reads
        // as a second guarantee and is not one: the composer keeps its string
        // after it closes, so that assertion passes whether the popover is open
        // or shut. It passed under a deliberately broken guard, which is the
        // only reason anybody noticed.
        check("the composer is still open, with the note still in it",
              popover.isShowing && popover.composedText == "Half a thought, not finished yet.",
              "showing \(popover.isShowing), text \(popover.composedText)")

        window.close()
    }

    static func aColourChangeCounts() {
        print("\n▸ editing a note and changing only its colour is a change")

        let (window, view) = stage()
        let popover = SelectionPopover()
        // Opened on an existing note, so its text is what it started with and
        // typing nothing leaves it untouched.
        popover.compose(existing: "An existing note.", colour: .standard, at: anchor, in: view)
        spin()
        clickAway(in: window)
        check("an edit nobody changed closes", !popover.isShowing)

        let (second, secondView) = stage()
        let another = SelectionPopover()
        another.compose(existing: "An existing note.", colour: .standard, at: anchor, in: secondView)
        spin()
        another.composedText = "An existing note, reworded."
        clickAway(in: second)
        check("an edit somebody did change stays", another.isShowing)

        window.close()
        second.close()
    }

    static func clicksInsideDoNotCount() {
        print("\n▸ and clicking the composer itself is not clicking away from it")

        let (window, view) = stage()
        let popover = SelectionPopover()
        popover.compose(existing: "", colour: .standard, at: anchor, in: view)
        spin()

        // The popover has a window of its own; that is what tells inside from
        // outside without hit-testing anything.
        guard let inside = popover.contentWindowForTesting else {
            check("the popover has a window to click in", false)
            return window.close()
        }
        clickAway(in: inside)
        check("an empty composer survives a click on itself", popover.isShowing)

        window.close()
    }
}
