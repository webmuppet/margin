// Moving a block to somewhere else in the document.
//
// Three things decide what a move actually is, and none of them is the block
// you grabbed on its own.
//
// A heading carries its section. Dragging the heading line by itself leaves
// everything under it behind, which does not read as "the title moved" — it
// reads as the document coming apart. The section runs to the next heading of
// the same or higher level, so moving a `##` takes its `###`s with it and stops
// at the next `##`.
//
// Any block carries its notes. A note lives on the lines after the block it is
// about, and anchoring is by position: `blockAbove` in comments.js finds the
// block a note physically follows. Move a paragraph and leave its note where it
// was, and the note does not become an orphan — it silently becomes a note
// about whatever is now above it, which is worse, because nothing on screen
// says so.
//
// And numbered headings are renumbered afterwards. A document whose sections
// are `## 1.`, `## 2.`, `## 3.` is a document where the numbers are the order,
// and a move that leaves them alone leaves the file contradicting itself.
//
// Nothing here touches the DOM. Line numbers in, a new document out.

import { OPEN } from './markers.js'

const HEADING = /^(#{1,6})\s/
const NUMBERED = /^(#{1,6})\s+(\d+)\.\s+(.*)$/

const isBlank = (line) => !line.trim()

/// The end of the marker block starting at `index`, or null if there is not one
/// there. Half-open, like everything else that counts lines here.
function markerEnd(lines, index) {
  if (index >= lines.length || !OPEN.test(lines[index])) return null
  let end = index
  while (end < lines.length && !lines[end].includes('-->')) end += 1
  // Unterminated: somebody's half-typed comment. Not ours to drag around.
  return end < lines.length ? end + 1 : null
}

/// What a grab on this block actually moves.
///
/// `from`/`to` are the block's own lines, half-open. What comes back is the
/// range that has to travel with it — the section under a heading, and the
/// notes written about whatever is inside.
export function unitFor(source, from, to) {
  const lines = source.split('\n')
  let end = Math.min(to, lines.length)

  const heading = lines[from]?.match(HEADING)
  if (heading) {
    const depth = heading[1].length
    for (let index = end; index < lines.length; index += 1) {
      const next = lines[index].match(HEADING)
      if (next && next[1].length <= depth) break
      end = index + 1
    }
  }

  // Anything written about the block, and the blank lines between. Run until
  // something that is neither, so a note followed by another note comes too.
  for (;;) {
    let look = end
    while (look < lines.length && isBlank(lines[look])) look += 1
    const marker = markerEnd(lines, look)
    if (marker === null) break
    end = marker
  }

  // The blank lines at the end are spacing between this and what follows, not
  // part of it. Carrying them would move the gap and leave the join behind.
  while (end > from && isBlank(lines[end - 1])) end -= 1

  return { from, to: end }
}

/// Where a move is allowed to land.
///
/// A block cannot be dropped inside itself, and a heading cannot be dropped
/// inside its own section — both would ask for the lines to end up before
/// themselves, which is not a position.
export const canMove = (unit, before) => before < unit.from || before > unit.to

/// Takes `unit` out and puts it back before line `before`, blank lines and all.
///
/// The target is a line in the document as it stands now, before anything has
/// moved. Working out where that line ends up once the unit is gone is the
/// whole of the arithmetic, and getting it wrong by one is a paragraph landing
/// on the wrong side of its neighbour.
export function moveLines(source, unit, before) {
  if (!canMove(unit, before)) return source

  const lines = source.split('\n')
  const moving = lines.slice(unit.from, unit.to)
  if (!moving.length) return source

  const rest = [...lines.slice(0, unit.from), ...lines.slice(unit.to)]
  // Everything after the hole shifts up by however much was taken out of it.
  const at = before > unit.from ? before - (unit.to - unit.from) : before

  // A block glued to its new neighbour would be read as part of it — two
  // paragraphs becoming one, or a heading swallowed into the text above.
  const block = [...moving]
  if (at > 0 && !isBlank(rest[at - 1])) block.unshift('')
  if (at < rest.length && !isBlank(rest[at])) block.push('')

  rest.splice(at, 0, ...block)
  return rest.join('\n')
}

/// Rewrites the numbers on headings that already have them.
///
/// Only lines that are already numbered are touched: a heading that merely
/// begins with a year is not a numbered heading, and one nobody numbered is not
/// asking to be. Counters are kept per level and reset under a shallower one, so
/// a `### 1.` starts again inside each `## n.` rather than counting through the
/// document.
export function renumberHeadings(source) {
  const counters = new Map()

  return source
    .split('\n')
    .map((line) => {
      const match = line.match(NUMBERED)
      if (!match) return line
      const depth = match[1].length

      const next = (counters.get(depth) ?? 0) + 1
      counters.set(depth, next)
      // Anything nested under this one starts again.
      for (const level of [...counters.keys()]) {
        if (level > depth) counters.delete(level)
      }
      return `${match[1]} ${next}. ${match[3]}`
    })
    .join('\n')
}

/// The unit next to this one in the document, in the given direction.
///
/// Not the next one in a list, and the difference is not academic: units nest.
/// A heading's unit contains the units of everything under it, so stepping one
/// place along a list of blocks steps *into* the section beside you rather than
/// over it — which moved a section up one place by slotting it between the
/// previous heading and that heading's own first paragraph.
///
/// The neighbour is the nearest unit clear of this one, and where several end
/// in the same place, the outermost: the section, not its last line.
export function neighbourUnit(units, unit, direction) {
  let best = null
  for (const other of units) {
    if (direction < 0) {
      if (other.to > unit.from) continue
      if (!best || other.to > best.to || (other.to === best.to && other.from < best.from)) {
        best = other
      }
    } else {
      if (other.from < unit.to) continue
      if (!best || other.from < best.from || (other.from === best.from && other.to > best.to)) {
        best = other
      }
    }
  }
  return best
}

/// A move, from the grabbed block's lines to a landing line, as a whole
/// document. Returns null when there is nothing to do.
export function documentAfterMove(source, unit, before) {
  const moved = moveLines(source, unit, before)
  if (moved === source) return null
  const numbered = renumberHeadings(moved)
  return numbered === source ? null : numbered
}
