// Tests for cutting a document into editable pieces and putting them back.
//
//   node Support/test-source.mjs
//
// The whole feature rests on one property: a piece spliced back unchanged
// leaves the file byte for byte as it was. Everything else — splitting a
// paragraph, promoting a line to a heading, editing a note by hand — is that
// property plus a re-parse. If it fails anywhere the failure is silent, and
// what it costs is somebody's document.
//
// The case worth having a suite for is a note under a list item. markdown-it
// reads the blanked marker lines as part of the list and stretches one block
// across the note and the item after it, so slicing the block hands the reader
// a live marker inside text they meant to fix a typo in. That one is checked
// here by hand as well as across the corpus, because the corpus documents
// might one day stop containing it and the check would quietly pass forever.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractComments } from '../renderer/src/markers.js'
import { markerRanges, segmentsOf, spliceSegment, textOf } from '../renderer/src/source.js'

const here = path.dirname(fileURLToPath(import.meta.url))

let failures = 0
const check = (name, ok, detail = '') => {
  if (ok) {
    console.log(`OK   ${name}`)
  } else {
    failures += 1
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

// Only an opening line can start a marker. A bare `-->` is not one: every
// mermaid diagram in testdata/ is full of `A --> B`, and matching those was
// this suite's own first bug — it reported four failures against code that was
// doing exactly the right thing.
const OPENING = /<!--\s*imark\b/

/// Whether a piece takes in any line of a note. Checked against the spans
/// extractComments actually found rather than by pattern: the spans are what
/// the app treats as a marker, so they are the only honest definition of one.
const overlapsMarker = (piece, spans) =>
  spans.some(([from, to]) => piece.from < to && from < piece.to)

// --------------------------------------------------------------- the fixture

const doc = [
  'A plain paragraph.',                                        // 0
  '',                                                          // 1
  '<!-- imark quote="plain" by="m" at="2026-01-01T00:00Z"',    // 2
  'A note on the paragraph.',                                  // 3
  '-->',                                                       // 4
  '',                                                          // 5
  '- item one',                                                // 6
  '- item two',                                                // 7
  '',                                                          // 8
  '<!-- imark quote="item two" by="m" at="2026-01-01T00:00Z"', // 9
  'A note under a list item.',                                 // 10
  '-->',                                                       // 11
  '',                                                          // 12
  '- item three',                                              // 13
].join('\n')

const { comments } = extractComments(doc, 0)

// The ranges markdown-it reports for the fixture, written out rather than
// parsed, so this file runs before anyone has installed the renderer's
// dependencies. The corpus section below checks them against the real parser.
const fixtureBlocks = [[0, 1], [6, 14]]

console.log('▸ a marker span is half-open once it leaves extractComments')
check('two notes found', comments.length === 2)
check('inclusive ends become exclusive',
  JSON.stringify(markerRanges(comments)) === JSON.stringify([[2, 5], [9, 12]]),
  JSON.stringify(markerRanges(comments)))

console.log('\n▸ the pieces of the fixture')
const segs = segmentsOf(doc, fixtureBlocks, comments)
const shape = segs.map((s) => `${s.kind}[${s.from},${s.to})`).join(' ')
check('the list splits around the note it contains',
  shape === 'content[0,1) marker[2,5) content[6,8) marker[9,12) content[13,14)', shape)
check('the prose before the note is just the two items',
  textOf(doc, segs[2]) === '- item one\n- item two', JSON.stringify(textOf(doc, segs[2])))
check('the item after it is a piece of its own',
  textOf(doc, segs[4]) === '- item three', JSON.stringify(textOf(doc, segs[4])))
check('the trailing blank line is not part of the list',
  !textOf(doc, segs[2]).endsWith('\n'))

console.log('\n▸ no marker reaches a piece that is not one')
for (const s of segs.filter((s) => s.kind === 'content')) {
  check(`content [${s.from},${s.to}) is clean`,
    !overlapsMarker(s, markerRanges(comments)) && !OPENING.test(textOf(doc, s)),
    JSON.stringify(textOf(doc, s)))
}
check('every note is reachable as a piece of its own',
  segs.filter((s) => s.kind === 'marker').length === comments.length)
check('and a note is the whole marker, opening line to close',
  textOf(doc, segs[1]) === doc.split('\n').slice(2, 5).join('\n'))

console.log('\n▸ putting a piece back unchanged changes nothing')
for (const s of segs) {
  check(`identity splice of ${s.kind}[${s.from},${s.to})`,
    spliceSegment(doc, s, textOf(doc, s)) === doc)
}

console.log('\n▸ an edit that changes the shape of the document')
const split = spliceSegment(doc, segs[0], 'First half.\n\nSecond half.')
check('a paragraph can be split in two', split.split('\n').slice(0, 3).join('|') === 'First half.||Second half.',
  JSON.stringify(split.split('\n').slice(0, 3)))
check('and the note below it moved down by the lines that were added',
  extractComments(split, 0).comments[0].line === comments[0].line + 2,
  String(extractComments(split, 0).comments[0].line))
check('which is why addresses are never kept across a parse',
  extractComments(split, 0).comments[0].line !== comments[0].line)

const promoted = spliceSegment(doc, segs[0], '## A heading now')
check('a line can be promoted to a heading', promoted.startsWith('## A heading now\n'))
check('and the document is otherwise untouched',
  promoted.split('\n').slice(1).join('\n') === doc.split('\n').slice(1).join('\n'))

console.log('\n▸ editing a note by hand is allowed and lands in the right place')
const edited = spliceSegment(doc, segs[1],
  '<!-- imark quote="plain" by="m" at="2026-01-01T00:00Z"\nReworded by hand.\n-->')
const after = extractComments(edited, 0).comments
check('the note still parses', after.length === 2)
check('its text is what was typed', after[0].text === 'Reworded by hand.', after[0].text)
check('its quote is untouched', after[0].quote === 'plain', after[0].quote)
check('and the second note is where it was', after[1].line === comments[1].line)

// ------------------------------------------------------- against the corpus

console.log('\n▸ every block of every document in testdata/')

const splitFrontMatter = (text) => {
  if (!text.startsWith('---')) return { body: text, offset: 0 }
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!match) return { body: text, offset: 0 }
  return { body: text.slice(match[0].length), offset: match[0].split('\n').length - 1 }
}

let md = null
try {
  const { default: MarkdownIt } = await import('../renderer/node_modules/markdown-it/index.mjs')
  md = new MarkdownIt({ html: true })
} catch {
  console.log('SKIP the corpus — run `cd renderer && npm ci` to include it')
}

if (md) {
  // What main.js does, in the same order: front matter off, markers blanked,
  // then parse. Anything else and the line numbers stop meaning the same thing.
  const topLevelRanges = (blanked, offset) => {
    const ranges = []
    let depth = 0
    for (const token of md.parse(blanked, {})) {
      if (token.nesting === -1) depth -= 1
      if (depth === 0 && token.map) ranges.push([token.map[0] + offset, token.map[1] + offset])
      if (token.nesting === 1) depth += 1
    }
    return ranges
  }

  const dir = path.join(here, '..', 'testdata')
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.md'))) {
    const source = fs.readFileSync(path.join(dir, name), 'utf8')
    const { body, offset } = splitFrontMatter(source)
    const { body: blanked, comments: found } = extractComments(body, offset)
    const pieces = segmentsOf(source, topLevelRanges(blanked, offset), found)

    const spans = markerRanges(found)
    const dirty = pieces.filter((s) => s.kind === 'content'
      && (overlapsMarker(s, spans) || OPENING.test(textOf(source, s))))
    check(`${name}: no marker inside a content piece`, dirty.length === 0,
      dirty.map((s) => `[${s.from},${s.to})`).join(' '))

    const moved = pieces.filter((s) => spliceSegment(source, s, textOf(source, s)) !== source)
    check(`${name}: ${pieces.length} pieces splice back byte for byte`, moved.length === 0,
      moved.map((s) => `[${s.from},${s.to})`).join(' '))

    const overlapping = pieces.filter((s, i) => i > 0 && s.from < pieces[i - 1].to)
    check(`${name}: no two pieces overlap`, overlapping.length === 0,
      overlapping.map((s) => `[${s.from},${s.to})`).join(' '))

    check(`${name}: every note is editable`,
      pieces.filter((s) => s.kind === 'marker').length === found.length)
  }
}

console.log(failures === 0 ? '\nall good' : `\n${failures} failing`)
process.exit(failures === 0 ? 0 : 1)
