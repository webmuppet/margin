// Checking an edit before it reaches the disk.
//
// In most editors a source view is safe by construction: the text is the
// document and nothing else lives in it. Here the notes are in the file too, so
// a block opened as text is a block where somebody can break a note without
// ever meaning to — delete a `-->`, type one in the middle of a sentence, or
// truncate an opening line. None of those look like damage while you are typing
// them, and all of them are silent afterwards: the note stops being a note and
// its words turn up in the middle of the document as prose.
//
// Comments.swift:250 already guards the composer against exactly this, escaping
// a literal `-->` in anything it writes. Hand-editing goes around that, so this
// is the same guard on the other path. It refuses rather than repairs: a
// validator that quietly rewrote what somebody typed would be a worse surprise
// than one that stops and says which note it is about.
//
// What is *not* refused is worth being explicit about. Rewording a note,
// recolouring it, correcting its quote, deleting it outright, or writing a new
// one by hand are all things a person may legitimately do to a document they
// own. An edit that orphans a note is allowed too — imark has drawn orphans as
// a first-class state since before this feature existed, and losing an anchor
// is a thing to be shown, not a thing to be prevented.

import { OPEN as OPENING, danglingOpenings, extractComments } from './markers.js'

const FIELDS = ['quote', 'by', 'at', 'nth', 'colour', 'scope', 'resolved', 'text']

const same = (a, b) => FIELDS.every((field) => a[field] === b[field])

const describe = (note) =>
  note.quote ? `the note on “${note.quote}”` : `the note at line ${note.line + 1}`

const refuse = (reason, note) => ({ ok: false, reason, line: note?.line ?? null })

/// Whether an edit may be written.
///
/// `before` and `after` are whole documents, not pieces: a splice can move
/// every line below it, and half the ways a note breaks only show up in what
/// happened to its neighbours. `segment` is the piece that was edited, in
/// `before`'s coordinates.
export function validateCommit(before, after, segment, replacement) {
  const dangling = danglingOpenings(after)
  if (dangling.length && !danglingOpenings(before).length) {
    return {
      ok: false,
      reason: `Line ${dangling[0] + 1} opens a note that is never closed. `
        + 'Add a line with `-->` to close it, or the note becomes ordinary text.',
      line: dangling[0],
    }
  }

  const wasNotes = extractComments(before, 0).comments
  const nowNotes = extractComments(after, 0).comments
  const shift = after.split('\n').length - before.split('\n').length

  // The edited piece is checked before its neighbours, and the order is not
  // cosmetic. Delete the closing `-->` of a note and the opening line does not
  // dangle to the end of the file — it scans on and takes the *next* note's
  // close, swallowing that note whole. Checked the other way round, the app
  // refuses the edit and names the note that got eaten, which is the one place
  // the person did not touch and the last place they would look.
  const edited = wasNotes.filter(
    (note) => note.line >= segment.from && note.endLine < segment.to
  )

  // Cleared on purpose. Deleting a note by emptying it is the same act as
  // pressing Delete on its card, and refusing it would be the app arguing with
  // somebody about their own document. The neighbours are still checked below.
  if (edited.length && replacement.trim()) {
    const from = segment.from
    const written = replacement.split('\n')
    // Blank lines at the end are spacing, not spilled text. Counting them as
    // content made a note that ended tidily look like one closed early, which
    // is a refusal nobody could act on.
    let length = written.length
    while (length > 0 && !written[length - 1].trim()) length -= 1
    const to = from + length

    const inside = nowNotes.filter((note) => note.line >= from && note.endLine < to)

    // Nothing parses as a note over those lines any more. Either it opens as
    // one and never closes, or it stopped being one altogether.
    if (inside.length < edited.length) {
      const swallowed = nowNotes.find(
        (note) => note.line >= from && note.line < to && note.endLine >= to
      )
      if (swallowed) {
        return refuse(
          `${describe(edited[0])} is missing its closing \`-->\`, so it runs on and `
            + 'takes the next note with it. Close it with a line reading `-->`.',
          edited[0]
        )
      }
      return refuse(
        `This edit would stop ${describe(edited[0])} being a note. `
          + 'Its opening line has to start with `<!-- imark` and it has to end with `-->`.',
        edited[0]
      )
    }

    // Parses, but stops short: a `-->` somebody typed into the body ends the
    // note there, and everything past it is now prose in the document.
    for (const note of inside) {
      if (note.endLine + 1 < to) {
        return refuse(
          `${describe(note)} closes early: a \`-->\` inside it ends the note there, `
            + 'and the rest would appear in the document as ordinary text. '
            + 'Write it as `--&gt;` to keep it inside the note.',
          note
        )
      }
    }
  }

  // A note opened inside the replacement and not closed inside it. Left to the
  // checks below, this reads as "a note somewhere else was destroyed", which is
  // true and useless: what happened is that the opening ran on until it found
  // some other note's `-->` and swallowed everything in between. The person
  // typed the cause, so the cause is what they should be told about.
  const written = replacement.split('\n')
  for (let index = 0; index < written.length; index += 1) {
    if (!OPENING.test(written[index])) continue
    let end = index
    while (end < written.length && !written[end].includes('-->')) end += 1
    if (end < written.length) {
      index = end
      continue
    }
    return {
      ok: false,
      reason: 'This opens a note and never closes it, so it would run on and '
        + 'swallow the next one. End it with a line reading `-->`.',
      line: segment.from + index,
    }
  }

  // Notes above the edit cannot have moved; notes below it moved by exactly the
  // lines the edit added or removed. Anything else means the splice reached
  // past the piece it was given — which is the failure that would be silent.
  const untouched = [
    ...wasNotes.filter((note) => note.endLine < segment.from).map((note) => [note, note.line]),
    ...wasNotes.filter((note) => note.line >= segment.to).map((note) => [note, note.line + shift]),
  ]

  for (const [note, expected] of untouched) {
    const still = nowNotes.find((candidate) => candidate.line === expected)
    if (!still) {
      return refuse(
        `This edit would destroy ${describe(note)}, which is not the one being edited.`,
        note
      )
    }
    if (!same(note, still)) {
      return refuse(
        `This edit would change ${describe(note)}, which is not the one being edited.`,
        note
      )
    }
  }

  return { ok: true }
}
