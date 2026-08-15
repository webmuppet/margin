# Contributing

Imark is one person's app. Issues get answered; pull requests are welcome but
please open an issue first, so nobody spends a weekend on something I was never
going to merge.

## Bugs

Anything that damages a document comes first. Everything else, use the [bug
report form](https://github.com/migsilva89/imark/issues/new?template=bug_report.yml)
— the version and the macOS version save a round trip.

## Before a pull request

Run the suites. `./release.sh` refuses to build if any of them fail, so a change
that breaks one cannot ship anyway.

```bash
Support/test-review.sh
node Support/test-notes.mjs
node Support/test-export.mjs
swift Support/test-plus.swift
```

The rest of the suites, the ones a release runs:

```bash
swiftc -parse-as-library Sources/Imark/Comments.swift Sources/Imark/NoteColour.swift \
  Support/test-comments.swift -o /tmp/imark-test && /tmp/imark-test
Support/test-setup.sh
```

The two that need the whole app compiled — `swift build` first, and the `-I` is
not optional, because `Sources/Imark` imports `ImarkRender` by module:

```bash
swift build
for suite in test-undo test-popover; do
  swiftc -parse-as-library -I .build/debug/Modules \
    $(find Sources/Imark -name '*.swift' ! -name main.swift) \
    $(find Sources/ImarkRender -name '*.swift') \
    "Support/$suite.swift" -o "/tmp/imark-$suite" && "/tmp/imark-$suite"
done
```

## Where things are

```
Sources/Imark/           the app
Sources/ImarkQuickLook/  the Quick Look extension
Sources/ImarkRender/     the renderer both of them share
renderer/                JavaScript source
Resources/               build output — not edited by hand
Support/                 Info.plist, entitlements, generators, and tests
testdata/                documents that exercise the renderer
plugin/                  the Claude Code plugin — uses the app, is not part of it
```

The renderer is the only part that knows how to turn Markdown into anything. The
Swift side handles windows, files and navigation, and talks to it in messages
over a private `imark://` scheme, so images beside a document load without
opening `file://` to the page. There is no `.xcodeproj`: Swift Package Manager
compiles it and `build.sh` assembles the `.app`.

`plugin/` is the single source for the agent files, copied into the app at build
time. Editing the copy inside `Imark.app` changes nothing in the repo.

The app icon's source is `margin-app-icon.icon`, an Icon Composer document.
Apple's own asset compiler turns it into the two things the bundle carries —
an `.icns` and an `Assets.car` — and both are committed, so an ordinary build
needs neither the compiler nor this script:

```bash
Support/make-icon.sh
```

Do not hand-place the artwork onto the macOS grid from a flattened export. It
was tried twice, at 80.5% and then at Apple's own 75/80 split, and both read as
smaller than every icon beside them. `actool` produces exactly those numbers
and looks right, because the grid is not the whole of it: the squircle's curve,
the gradient, the shadow and the glass treatment come with it.

Two helpers exist for looking at the UI without photographing the whole desktop.
`Support/shoot.swift` renders a page in an off-screen web view, and
`Support/window-id.swift` resolves a window id so a screenshot can be taken of
one window:

```bash
screencapture -x -o -l"$(swift Support/window-id.swift Imark)" shot.png
```

## The review handshake: test the second round

Everything about a review passes through `~/.margin/pending`, and that directory
is the only state in Imark that outlives the thing that made it. A review that
is never answered — the session closed, the process killed — leaves its request
there, and 0.2.2 shipped an app that answered the leftover instead of the
review the reviewer was looking at. The agent waited four hours for a decision
that had already been made. Every suite passed: all of them reviewed a clean
document once.

So a change to `Review.swift` or to the handshake in `plugin/scripts/margin.mjs`
is not tested until it is tested **twice over the same document, with a
leftover in the directory**. Three cases in `Support/test-review.sh` hold that
line — the abandoned round, the interrupted one, the sweep — and a fourth
belongs there before the next one gets fixed.

The one step no suite reaches is the press itself: a synthetic click needs
accessibility permission a terminal does not have. Approve, Send Back, and
closing the window without deciding have to be tried by hand, in a build, on a
real review, before a release goes out.

## The renderer in a browser

`Support/harness.html` loads the built bundle in a browser, with a stand-in for
Swift that writes an edit into its copy of the document and re-renders from it.

```bash
cd renderer && npm ci && node build.mjs   # Resources/ has to exist first
python3 -m http.server 8899
open http://localhost:8899/Support/harness.html
```

The page carries its own list of what to look at. Its fixture is the awkward
cases rather than a tour of markdown: a table, a list with a note written into
the middle of it, and one block of every kind that has been positioned wrongly
at some point.

It is deliberately not a suite, and the reason is worth keeping. Everything the
renderer does that can be checked without a screen already is checked, in this
folder. What is left needs layout and paint, and neither can be faked: an
element can have the right rectangle, `opacity: 1` and `visibility: visible`,
and still never be drawn. That is not hypothetical — it is exactly how the
source control behaved inside a `<table>`, and a headless DOM would have passed
it, because a headless DOM has no paint step to disagree with. A dispatched
click needs no hit-testing either, so it passed a scripted test too.

Two things it cannot tell you, both of which stay manual:

- **Keyboard focus.** A driven browser never has system focus, so `:focus`
  cannot match and `Tab` never reaches the page. Reaching a control by keyboard
  has to be tried by hand.
- **The engine.** The app renders in WKWebView and your browser is not that.
  Anything that turns on engine behaviour is confirmed in a build or not at all.

## What this is not

- **Not a text editor.** Imark reads, and will let you fix what you are reading:
  a block at a time, through a control in the margin, with the whole document on
  the undo stack and a switch in Settings that turns it off. That is the whole of
  it. A cursor in the document, find-and-replace, anything that treats the file
  as text rather than as blocks — your editor is better at all of it than this
  will ever be, and *Open in* is one press away.
- **Not cross-platform.** It is AppKit and a WebView, and the Quick Look
  extension only exists on macOS.
- **Not a vault.** No database, no index, no folder structure it insists on.

Changes that pull in any of those three directions are not going to be merged,
however well they are written.
