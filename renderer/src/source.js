// Turning a rendered document back into editable pieces of its own source.
//
// Every block markdown-it renders carries a `data-line="from,to"` — the lines of
// the file it was built from, counting from the top, end exclusive. That is
// already what lets a comment be written back to the right place, and it is the
// whole basis of editing a block as text: slice those lines out of the file,
// hand them over, splice whatever comes back into the same range.
//
// The complication is that comments live in the document. `extractComments`
// blanks their lines before markdown-it ever sees them, which keeps the line
// numbering honest but leaves the blanks inside whatever block encloses them.
// A note written under a list item is the case that bites: markdown-it reads
// the blanked lines as part of the list and stretches one block across the
// note *and* the item after it, so the naive slice hands the reader a live
// `<!-- imark … -->` marker inside a paragraph they only meant to fix a typo
// in. comments.js:97 documents the same overlap from the anchoring side.
//
// So a block range is not an editable unit. Subtracting the marker spans from
// it is: what comes back is the prose either side of the note, and the note
// itself as a piece in its own right. A marker is deliberately editable —
// notes living in the file is the point of the app, and a note you cannot
// correct by hand is a note you have to delete and rewrite — which is why
// every commit has to be validated before it reaches the disk.
//
// Nothing here touches the DOM or keeps state. Ranges are derived on every
// parse and never stored: an edit can split a paragraph in two or promote a
// line to a heading, and any range remembered from the parse before it would
// still look perfectly valid while pointing at the wrong text.

/// One editable piece of the file. `to` is exclusive, matching markdown-it.
///
/// `content` is prose, `marker` is an `<!-- imark … -->` block. They are told
/// apart because a commit has to be checked differently: mangling prose costs
/// you a paragraph, and mangling a marker costs somebody their note.
const segment = (kind, from, to) => ({ kind, from, to })

/// The lines a marker occupies, as half-open ranges. `extractComments` reports
/// both ends inclusive; everything here counts the way markdown-it does, and
/// mixing the two conventions is an off-by-one that silently eats a line.
export const markerRanges = (comments) =>
  comments.map(({ line, endLine }) => [line, endLine + 1])

/// A block range with the markers inside it taken out, leaving the prose either
/// side. One range in, none or several out.
function withoutMarkers(from, to, markers) {
  let pieces = [[from, to]]
  for (const [start, end] of markers) {
    const next = []
    for (const [pieceStart, pieceEnd] of pieces) {
      if (end <= pieceStart || start >= pieceEnd) {
        next.push([pieceStart, pieceEnd])
        continue
      }
      if (start > pieceStart) next.push([pieceStart, start])
      if (end < pieceEnd) next.push([end, pieceEnd])
    }
    pieces = next
  }
  return pieces
}

/// Blank lines at either end belong to the gaps between blocks, not to the
/// block. markdown-it hands back a list whose range runs to the blank line that
/// ended it, and an editor that opened with a trailing empty line would put one
/// back on every commit until the document was mostly whitespace.
function trimBlank(from, to, lines) {
  let start = from
  let end = to
  while (start < end && !lines[start].trim()) start += 1
  while (end > start && !lines[end - 1].trim()) end -= 1
  return [start, end]
}

/// Every editable piece of the document, in the order they appear.
///
/// `blocks` are the ranges markdown-it reported, `comments` what
/// `extractComments` found. Markers are included whether or not a block
/// happened to enclose them: a note after a paragraph sits in the gap between
/// two blocks and belongs to neither, and leaving those out would make most of
/// the notes in a document unreachable.
export function segmentsOf(source, blocks, comments) {
  const lines = source.split('\n')
  const markers = markerRanges(comments)
  const found = []

  for (const [from, to] of blocks) {
    for (const [pieceStart, pieceEnd] of withoutMarkers(from, to, markers)) {
      const [start, end] = trimBlank(pieceStart, pieceEnd, lines)
      if (start < end) found.push(segment('content', start, end))
    }
  }
  for (const [from, to] of markers) found.push(segment('marker', from, to))

  // Sorted by where they start, so stepping through the list is reading down
  // the document. Two pieces can never start on the same line: a marker is cut
  // out of any block that overlaps it before the block's pieces are kept.
  return found.sort((a, b) => a.from - b.from)
}

/// The text of a piece, exactly as it sits in the file.
export const textOf = (source, { from, to }) => source.split('\n').slice(from, to).join('\n')

/// Puts edited text back where it came from, and hands back the whole document.
///
/// Splicing the buffer and re-parsing from it is the only safe order. Applying
/// an edit to a copy and trusting the ranges afterwards is how a stale address
/// gets used: it does not throw, it writes to the wrong block.
export function spliceSegment(source, { from, to }, replacement) {
  const lines = source.split('\n')
  lines.splice(from, to - from, ...replacement.split('\n'))
  return lines.join('\n')
}
