# Notice

Margin is a fork of [Imark](https://github.com/migsilva89/imark) by Miguel
Silva, used and modified under the MIT licence. `LICENSE` is that licence,
unchanged, and it covers the original work and this one alike.

## What is different

Imark reads; comments are the one thing it writes, and its `CONTRIBUTING.md`
says plainly that changes pulling it toward being an editor are not going to be
merged. That is its author's call about its own scope, and this fork does not
argue with it — it goes the other way on purpose, which is what forking is for.

Margin adds editing in place: opening a block as its own markdown, deleting the
block under the pointer, dragging blocks to reorder them, and a switch that
turns all of it off. Everything else — the renderer, the comment format, the
Quick Look extension, the review handshake — is Imark's work.

## Name and marks

"Imark" is the original author's name for the original app, and the MIT licence
grants no rights to it. Margin is named, identified and branded separately:

| | Imark | Margin |
|---|---|---|
| App | `Imark.app` | `Margin.app` |
| Bundle id | `pt.miguelsilva.imark` | `nz.co.humanloop.margin` |
| Preferences | `pt.miguelsilva.imark.plist` | `nz.co.humanloop.margin.plist` |
| Review state | `~/.imark/pending` | `~/.margin/pending` |
| Private scheme | `imark://` | `margin://` |

The two install side by side and share no settings, which is deliberate: a fork
that inherited the original's file associations and preferences would be a fork
pretending to be an upgrade.

## What deliberately did not change

The `<!-- imark … -->` comment markers, and the `imark: review` front matter
key. Those are a file format, not branding — they are already written into
people's documents, and renaming them would orphan every note in every file
either app has ever touched. A document commented in one opens with its notes
intact in the other, and that is worth more than tidiness.

This fork is not endorsed by or affiliated with the original author. Please
raise anything about Margin here, and nothing about Margin there.
