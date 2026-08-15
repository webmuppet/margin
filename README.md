<p align="center">
  <img src=".github/assets/app-icon.png" width="128" height="128" alt="Margin app icon">
</p>

<h1 align="center">Margin</h1>

<p align="center">
  <strong>Native Markdown reader for macOS, that lets you fix what you are reading.</strong><br><br>
  Double-click a <code>.md</code> file and it opens rendered, reloads itself while you<br>
  edit, and previews in the Finder with the space bar. Comment on a phrase and the<br>
  note goes into the file itself. Nothing leaves the machine.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/macOS-14%2B-blue?style=flat-square" alt="macOS 14 or later">
  <img src="https://img.shields.io/badge/Swift-6-orange?style=flat-square" alt="Swift 6">
  <img src="https://img.shields.io/badge/network-update%20check%20only-brightgreen?style=flat-square" alt="Network: update check only, can be turned off">
  <img src="https://img.shields.io/badge/size-13%20MB-lightgrey?style=flat-square" alt="13 MB">
  <img src="https://img.shields.io/badge/licence-MIT-blue?style=flat-square" alt="MIT licence">
</p>

<p align="center">
  <img src=".github/assets/comment.gif" width="720" alt="Selecting a block, writing a note in the popover, and the note appearing in the margin">
</p>

<p align="center"><em>Comment on anything. The note goes into the <code>.md</code> file.</em></p>

> [!NOTE]
> Margin is a reader that will let you fix what you are reading. A block at a time: open one as markdown, correct it, move it, or take it out — see [Editing in place](#editing-in-place). It is not a text editor and is not trying to become one; for anything larger the *Open in* button hands the file to Cursor, VS Code, Sublime, Zed, or whatever else you have installed. One switch in Settings turns all of it off.

## What it does

- **Comments in the file** — select, comment, edit or delete, and the note lives in the document as an HTML comment, so it survives being emailed, committed, or opened in anything else. `⌘Z` undoes any of it
- **Editing in place** — open any block as its own markdown and put it back, delete the one under the pointer, or drag it somewhere else. A heading takes its section with it and numbered headings renumber themselves. `⌘Z` covers all of it, and Settings turns it off
- **Quick Look previews** — the space bar in the Finder renders the document, not raw text, using the same engine as the app
- **Live reload** — saving in your editor updates the view in under 300ms, keeping your scroll position, and it survives the delete-and-rename that editors call an atomic save
- **Foldable outline** — headings in the sidebar, with sections you can collapse; past twenty entries it opens folded, so a changelog is one row per version
- **Outline rail** — a tick per heading down the edge of every document, tapering around the pointer, with a card that names the section before you commit to going there
- **Wiki-links** — `[[note]]` resolves against the folder and opens in the same window, with back and forward history
- **The folder and the recents** — every `.md` beside the open document, plus the last five you opened from anywhere else
- **Everything GitHub-flavoured** — tables, task lists, footnotes, front matter as a header card, syntax highlighting, Mermaid diagrams, KaTeX maths
- **Actions on a selection** — comment on it, translate it on device, or search the web for it in your default browser
- **Notes where the words are** — read past an underlined quote and its note appears over the phrase it is about, then goes when you move on
- **Find with a counter** — `⌘F` highlights every hit and tells you which one you are on
- **Tabs** — several documents in one window, with everything macOS gives a tabbed app: `⌘⇧[` and `⌘⇧]`, drag a tab out, Merge All Windows
- **Offline where it counts** — documents render with every request blocked by a content security policy, KaTeX fonts embedded, remote images refused on purpose

## Screenshots

| Document window | Quick Look preview |
|:---:|:---:|
| ![A document window with the outline sidebar and syntax-highlighted code](.github/assets/imark-window.png) | ![The Finder preview panel, with the outline rail down the left edge](.github/assets/imark-quicklook.png) |

Both are rendering [`testdata/showcase.md`](testdata/showcase.md). For the full
sweep — every construction, every kind of comment, and enough headings that the
outline folds itself — open [`testdata/everything.md`](testdata/everything.md).

<p align="center">
  <img src=".github/assets/quicklook.gif" width="720" alt="Pressing the space bar in Finder and stepping through markdown files in the preview panel">
</p>

<p align="center"><em>Space bar in the Finder. No app to open first.</em></p>

<p align="center">
  <img src=".github/assets/imark-rail.png" width="520" alt="The rail tapering around the pointer, with a card naming the section and quoting its first line">
</p>

<p align="center"><em>The rail: one tick per heading, in the window and in the Finder's preview panel alike. Click to jump, or press and drag to scrub.</em></p>

## Install

Download the [latest release](../../releases/latest) and drag `Margin.app` into `/Applications`, or build it yourself — see [Building from source](#building-from-source).

Margin installs beside [Imark](https://github.com/migsilva89/imark) rather than over it: different name, different bundle identifier, its own settings. Neither takes the other's file associations, and a document commented in one opens with its notes intact in the other.

macOS 14 or later. Margin tells you when a newer version exists — once per release, and only if you leave the check on in Settings.

To make it the default for `.md`: launch it with no document open and click **Make Margin the default for .md**, or use the same item in the **Margin** menu. Once it is the default, both quietly disappear.

## Comments

<p align="center">
  <img src=".github/assets/imark-comments.png" width="620" alt="A phrase underlined in the text, a dot in the margin, and a card floating over the right margin with the note">
</p>

Select a phrase, press the speech bubble, write, press `↵`. The quoted words get
underlined, a dot appears in the margin, and clicking either opens the note. Pick
one of five colours while writing it, or change it later. The card carries **Edit**
and **Delete**, and `⌘Z` undoes any of it — writing, editing or deleting.

The note is stored **inside the `.md` file**, as an HTML comment:

```markdown
Rows move in batches of 500, and the deadline is generous but achievable.

<!-- imark quote="generous but achievable" by="john" at="2026-08-02T14:31Z"
Achievable with which team? This needs a number, not an adjective.
-->
```

Which means it travels with the document instead of living in a database only
this app can read:

| Where | What you see |
|---|---|
| **Margin** | the words underlined, a dot in the margin, the note on click |
| **Cursor, VS Code, Vim** | the block above, verbatim, right under the paragraph |
| **GitHub, any renderer** | nothing — HTML comments are invisible |
| **`grep`, `cat`** | the note, with the quote it refers to beside it |

The `quote=` is what makes the note legible in raw text: someone opening the file
in Vim can see what it refers to without counting lines. If the quoted words are
later edited away the note goes **orphan** — still visible, still attached to its
block, marked as having lost its anchor. There is no fuzzy matching, because a
note in the wrong place is worse than a note without an exact one.

Four ways to get at them, because they answer different questions. The count in
the status bar opens **the list** — every note at once, out of the document.
`⌘⇧C` opens them all **in place**, each under its own block. `⌘'` and `⌘⇧'`
**step** through one at a time. And a rail down the left edge marks **where**
they are, so three clustered in one section is visible at a glance.

**File › Export Comments as Text…** writes a copy — not the document — with every
note turned into a blockquote, for the review the other person has to read on
GitHub:

```markdown
Rows move in batches of 500, and the deadline is generous but achievable.

> **john, 2 Aug 2026** on *“generous but achievable”*
>
> Achievable with which team? This needs a number, not an adjective.
```

## Editing in place

Hover any block and three controls appear in the margin, in the order you meet
them: comment on it, open it as markdown, move it.

```
 +   ← comment on this block
</>  ← open it as markdown
 ⠿   ← drag to move it
```

**Open it as markdown.** The `</>` control replaces the rendered block with the
lines of the file it was built from. Correct the typo, press `⌘↵`, and the block
is written back and re-rendered. `Esc` abandons it, *Done* and clicking away
both save. A note's own markdown opens the same way from the `</>` on its card,
which is how you fix a mistyped `quote=` or an attribute the composer does not
offer — without deleting the note and writing it again.

**Delete it.** `⌫` removes the block under the pointer, and the blank line it
would otherwise leave behind. Nothing asks first; `⌘Z` puts it back, ten deep.

**Move it.** Drag the grip, or press `⌥↑` / `⌥↓`. A heading carries its whole
section — everything under it to the next heading of the same or higher level —
and headings written as `## 1. Title` are renumbered afterwards, per level. A
block always carries the notes written about it, which matters more than it
sounds: a note anchors to the block it physically follows, so one left behind
would quietly become a note about whatever ended up above it.

Only the grip is draggable. A draggable block would take every drag that starts
inside it, and a drag inside a paragraph is you selecting the words you want to
comment on.

> [!IMPORTANT]
> Every edit goes through the same door a comment does: the whole document is
> put on the undo stack first, and the write is refused outright if the file
> changed on disk since Margin read it. An edit that would break a note — a
> deleted `-->`, one typed into the middle of a note's body, an opening that
> never closes — is refused with a message naming the note, and what you typed
> stays on screen.

**Settings › General › Editing** turns all three off together. Off, the controls
are gone and `⌫` does nothing. Comments are not covered by the switch and are
not meant to be: they go through their own composer and have always been the one
thing this app writes.

## Reviewing an agent's work

A plan from a coding agent is markdown. So is a diff, once it is wrapped in a
fenced block. Because comments live in the file, an agent can hand you a
document, you can annotate it in Margin, and the agent can read your notes back
out — with no server, no port and nothing installed on the other side. The file
is the whole bridge.

<p align="center">
  <img src=".github/assets/review.gif" width="720" alt="Pressing Send Back in the toolbar, and the agent picking the notes up in the terminal">
</p>

<p align="center"><em>Send Back, and the agent reads your notes back.</em></p>

A document under review gets two buttons in the toolbar, **Approve** and **Send
Back**, and pressing either one ends the wait on the other side. Closing the
window without pressing one asks first, because something is waiting for an
answer and closing is not an answer.

The buttons appear on a document an agent asked to have reviewed, and nowhere
else: the agent leaves a small file in `~/.imark/pending` naming the document
before opening it, and Margin writes the decision beside that file. Every other
`.md` opens exactly as it always did.

[`plugin/`](plugin/README.md) is a Claude Code plugin that does this:

```
/imark:imark-review PLAN.md       # review a markdown document
/imark:imark-notes PLAN.md        # notes you already left
```

Launched with no document, Margin offers to **set itself up for the coding agents
on your machine** — one skill, written into each one's `skills` folder. The alert
names every file before writing it, and undoing it is deleting those. Claude Code
and Codex read the same `SKILL.md`; only Claude Code also takes the two loose
commands.

## What it touches

| Where | What, and when |
|---|---|
| The `.md` you are reading | when you comment, and when you edit, delete or move a block. Written to a temporary file beside it and moved into place; it refuses to save at all if the document changed on disk since Margin read it. Settings turns everything but commenting off |
| `~/.imark/pending` | while an agent is waiting on a review: which document, and what you decided. Deleted when the agent reads it |
| `~/Library/Preferences/pt.miguelsilva.imark.plist` | your settings — theme, text size, width, whether blocks can be edited, the update check |
| `~/.claude/skills`, `~/.codex/skills`, … | only if you accept the offer to set up your coding agents, and only the files the alert names |
| The network | one request a day to `api.github.com` asking whether a newer version exists. A version number travels, nothing of yours does, and Settings turns it off |

> [!IMPORTANT]
> Commenting and editing are the only features that write to your documents, and
> both go the same way: an atomic replace that refuses if the file moved
> underneath it. Margin keeps the last ten states of a document, so `⌘Z` puts any
> of them back. If it ever damages a file, [open an
> issue](../../issues/new?template=bug_report.yml) before anything else — that is
> the one bug worth interrupting whatever else is happening.

## Keyboard shortcuts

| | | | |
|---|---|---|---|
| `⌘O` | Open | `⌘F` | Find, prefilled with the selection |
| `⌘W` | Close window | `⌘G` / `⌘⇧G` | Next / previous hit |
| `⌘\` | Toggle sidebar | `←` / `→` | Fold / unfold outline section |
| `⌘[` / `⌘]` | Back / forward | `⌘R` | Reload |
| `⌘+` / `⌘-` / `⌘0` | Text size | `⌘⇧R` | Reveal in Finder |
| `⌘P` | Print or export PDF | `⌘⇧C` | Show all comments |
| `⌘'` / `⌘⇧'` | Next / previous comment | `⌘Z` | Undo the last change |
| `⌫` | Delete the block under the pointer | `⌥↑` / `⌥↓` | Move it up or down |
| `⌘↵` | Save the block you are editing | `Esc` | Abandon it |
| `⌘/` | This table, in the app | | |

`⌘/` opens the same list inside the app, built by reading the menu bar rather
than from a copy of this table — which is also how it stays right on keyboards
where macOS remaps the keys. On a Portuguese layout, Back and Forward are `⌘Ç`
and `⌘~`, not `⌘[` and `⌘]`.

## Building from source

Requires Xcode 16 or later and Node 20.

```bash
git clone https://github.com/migsilva89/imark.git
cd imark
cd renderer && npm ci && cd ..
./build.sh
```

That builds the JavaScript bundle, compiles the Swift, assembles `Margin.app` and
installs it to `/Applications`. `npm ci` is not optional: the rendered output is
generated, not committed, and `build.sh` refuses to assemble an app with a blank
window.

| | |
|---|---|
| `./build.sh` | build and install |
| `./build.sh --debug` | fast compile, for iterating |
| `./build.sh --no-install` | leave it in `dist/` |
| `IMARK_INSTALL_DIR=~/Applications ./build.sh` | install elsewhere |

Swift 6 with AppKit and no external Swift dependencies, around a WKWebView that
only ever renders; markdown-it, highlight.js, Mermaid and KaTeX are bundled
offline with esbuild. [`CONTRIBUTING.md`](CONTRIBUTING.md) has the layout of the
repository, the test suites and how to run them.

## FAQ

### Why does the Quick Look extension need the network entitlement?

It does not use the network. WebKit refuses to start its WebContent process
inside a sandboxed app extension without `com.apple.security.network.client`,
even when every byte is served from a local scheme. The panel stays blank without
it, with no error and no log entry.

### What does `⌘Z` undo?

The last change to the document — a note written, edited or deleted, a block
edited, deleted or moved — up to ten deep. Each one is a snapshot of the whole
file taken before the change, and the Edit menu names the one it will put back.
It only covers changes Margin made; edits from your own editor are your editor's
to undo.

### Can I stop it editing my files?

Yes. **Settings › General › Editing** turns off the way into a block's markdown,
the way into a note's, and the delete key, in one switch. Commenting is not
covered by it — that has always been what the app is for, and it goes through
its own composer.

### What happens to a note when I move the block it is about?

It goes with it. A note anchors to the block it physically follows, so a move
carries the block, its notes, and — if it is a heading — everything in its
section. Editing away the words a note quoted is a different thing: the note
stays and is drawn as an orphan, which is a state to be shown rather than
prevented.

### What happens if two people comment on the same words?

The second note gets an `nth="2"` so it anchors to the right occurrence. Notes on
the same paragraph stack down the margin rather than landing on top of each
other.

## Security, contributing, licence

Margin is a personal project, maintained by one person. Issues get answered and
pull requests are welcome —
[`CONTRIBUTING.md`](CONTRIBUTING.md) says what is out of scope before you spend a
weekend on it — but there is no support promise and no release schedule. For
anything that looks like a security problem, [`SECURITY.md`](SECURITY.md) says
where to send it instead of the issue tracker.

Everything Margin bundles is permissive — MIT, ISC, BSD, Unlicense — with no
copyleft anywhere in the tree. Several require their copyright notice to travel
with the binary, so [`THIRD-PARTY.md`](THIRD-PARTY.md) is generated from what
esbuild actually put in the bundle, on every build, and the same list ships
inside the app: **Margin › About Margin** shows it.

Margin is a fork of [Imark](https://github.com/migsilva89/imark) by Miguel
Silva, used and modified under the MIT licence — see [`NOTICE.md`](NOTICE.md)
for what is different and what deliberately is not. The renderer, the comment
format, the Quick Look extension and the review handshake are all their
work. This fork is not endorsed by or affiliated with them.

[MIT](LICENSE) throughout — use it, change it, redistribute it, just keep the
copyright notice.
