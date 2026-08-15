// Reading the `<!-- imark … -->` markers out of a document, and nothing else.
//
// Split out of comments.js so it can be imported without a DOM. comments.js
// installs listeners the moment it loads, which makes it unimportable from a
// test runner — and the marker scanner is the one piece of it that both the
// renderer and the source editor have to agree on exactly. A second copy of
// OPEN living in the source editor would be a second definition of what a
// comment is, drifting away from this one the first time either changed.
//
// Swift writes these blocks; the escaping rules it has to match live in
// Comments.swift.

export const OPEN = /^\s*<!--\s*imark\b(.*)$/
export const ATTR = /(\w+)="([^"]*)"/g

/// The colours a note may carry. A closed set on purpose: the value comes out
/// of somebody's file and ends up in a `data-color` attribute, so anything
/// unrecognised has to become the default rather than reach the stylesheet.
/// An absent colour is the default one and writes no attribute at all.
const COLOURS = new Set(['amber', 'green', 'blue', 'red'])
const colourOf = (raw) => (COLOURS.has(raw) ? raw : '')

/// Pulls the comment blocks out of the source and blanks the lines they came
/// from. Blanking rather than deleting is deliberate: every `data-line` in the
/// rendered HTML counts from the top of the file, and removing lines here would
/// silently shift everything below by however many notes came before it.
export function extractComments(body, lineOffset = 0) {
  const lines = body.split('\n')
  const comments = []

  for (let index = 0; index < lines.length; index += 1) {
    const open = OPEN.exec(lines[index])
    if (!open) continue

    let end = index
    while (end < lines.length && !lines[end].includes('-->')) end += 1
    // An unterminated block is somebody's half-typed comment; leave it as text
    // rather than swallowing the rest of the document.
    if (end >= lines.length) continue

    const attributes = {}
    for (const [, key, value] of open[1].matchAll(ATTR)) attributes[key] = unescapeHTML(value)

    comments.push({
      id: `note-${comments.length}`,
      quote: attributes.quote ?? '',
      // `scope="file"` is a note about the document, not about anything in it.
      // Anything else, including nothing, is a note about a block.
      scope: attributes.scope === 'file' ? 'file' : 'block',
      by: attributes.by ?? '',
      at: attributes.at ?? '',
      nth: Number(attributes.nth) || 1,
      colour: colourOf(attributes.color),
      // Stamped by whoever acted on the note. Still shown — it is the record
      // of what was asked — but quietly, because it is no longer asking.
      resolved: attributes.resolved ?? '',
      text: unwrap(unescapeHTML(lines.slice(index + 1, end).join('\n').trim())),
      // Both ends, because editing and deleting have to find the block again.
      line: index + lineOffset,
      endLine: end + lineOffset,
    })

    for (let i = index; i <= end; i += 1) lines[i] = ''
    index = end
  }

  return { body: lines.join('\n'), comments }
}

/// A note hard-wrapped in the file is one paragraph, not one line per line.
/// Single newlines become spaces; a blank line still starts a paragraph.
export const unwrap = (text) =>
  text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, ' ').trim())
    .join('\n\n')

export const unescapeHTML = (value) =>
  value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
