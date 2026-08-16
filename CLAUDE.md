# Working in this repository

Margin is a macOS markdown reader that lets you fix what you are reading, forked
from [Imark](https://github.com/migsilva89/imark). `README.md` is what it does,
`CONTRIBUTING.md` is where things live and how to run the suites, `NOTICE.md` is
what came from the fork and what did not. Read those first; this file is only
the things that are easy to get wrong.

## The shape of it

The **renderer is the only thing that parses markdown**. It is markdown-it, in
`renderer/src`, and the Swift side handles windows, files and navigation and
talks to it over a private `margin://` scheme. A second parser in Swift would be
a second definition of what a comment is, and the two would disagree the first
time either changed.

Where that leaves the split, for anything that writes:

- the **renderer** owns the parse, so it decides whether an edit breaks a note
- **Swift** owns the file, so it decides whether the file moved underneath us

Neither checks the other's half.

## Things that are not what they look like

**The SwiftPM targets are still `Imark`, `ImarkRender` and `ImarkQuickLook`.**
`Sources/Imark/` is the app; `build.sh` renames the binary on its way into
`Margin.app`, and every plist, bundle id and menu already says Margin. The
target names are internal and staying, so a path in a doc that says
`Sources/Margin/` is wrong rather than aspirational.

Two AppKit identifiers are also stuck that way on purpose: the window's
`setFrameAutosaveName("ImarkDocument")` and the toolbar's
`"ImarkDocumentToolbar"` are keys in people's preferences. Renaming either one
loses their saved window frames and toolbar layout.

**`<!-- imark … -->` and `imark: review` are the file format, not branding.**
They are written into people's documents. Renaming them would orphan every note
in every file either app has ever touched. They stay.

**Block ranges are half-open and derived, never stored.** `data-line="from,to"`
counts from the top of the file with `to` exclusive, matching markdown-it. An
edit can split a paragraph or promote a line to a heading, so any range
remembered across a parse is a range that still looks valid and points at the
wrong text.

**A commented block is wrapped in a `.note-holder`.** It stops being a child of
`#content` and becomes a grandchild. Reading only the top level makes every
block somebody has commented on invisible — that has now been the same bug
twice, which is why there is one `documentBlocks()` and everything uses it.

**State must not outlive the DOM it describes.** A commit re-renders the whole
document, and anything the renderer remembered across that is stale: an
"editor is open" flag, a drag in progress. Ask the document instead. Three bugs
have come from this.

## Verify at the point of use, not the point of definition

This is the one that has cost the most time, and it has failed in the same shape
four times:

- an element with the right rectangle, `opacity: 1` and `visibility: visible`,
  that is **never painted** — a `position: absolute` child of a `<table>`
- a menu item bound to `undo:`, which **NSWindow answers first**, so the app's
  own undo silently stopped running
- an `.icns` measuring identically to Mail's at every size, drawn **smaller** —
  because the Finder composites its own render and caches it
- a dispatched `element.click()` passing on a control that could not be
  clicked, because a synthetic event needs no hit-testing

Measure the output. `NSWorkspace.icon(forFile:)` for what the Finder draws,
`NSApp.target(forAction:)` for where a menu item lands, a real pointer for
whether a control can be reached. A number that says the input is correct is not
evidence that the result is.

## Checking things

`CONTRIBUTING.md` lists every suite. Two habits worth keeping:

- **Mutation-test a new assertion.** Break the thing on purpose and confirm the
  test fails. Two checks written this month passed against deliberately broken
  code — one because `RunLoop.run` does not pump `NSApplication`'s event queue,
  one because a composer keeps its text after closing.
- **`Support/harness.html`** loads the built bundle in a browser with a stand-in
  for Swift. It is not a suite, deliberately: what is left needs layout and
  paint, and neither can be faked. It cannot tell you about keyboard focus (a
  driven browser never has system focus) or about WKWebView.

## The icon

`margin-app-icon.icon` is the source; `Support/make-icon.sh` runs `xcrun actool`
over it. Do not hand-place the artwork onto the macOS grid from a flattened
export — it was tried twice, at the right numbers both times, and read as
smaller than every icon beside it. The grid is not the whole of it.

## Installing

`./build.sh` installs to `/Applications`, replacing what is there.
`./build.sh --no-install` leaves it in `dist/`. Ask before overwriting an
installed copy.
