// Tests for what a source edit is allowed to do to a document.
//
//   node Support/test-commit.mjs
//
// The whole risk of editing a block as text is that the notes are in the text.
// Comments.swift escapes a literal `-->` in anything the composer writes, so a
// note written through the app can never close itself early. Hand-editing goes
// straight around that guard, and every way of breaking a note is quiet: the
// note stops being a note and its words appear in the document as prose, with
// nothing on screen to say so.
//
// So the cases below are mostly attacks. The ones that must be *allowed* matter
// just as much: a validator that refuses a legitimate edit teaches people the
// feature is broken, and they stop using it long before they file anything.

import { extractComments } from '../renderer/src/markers.js'
import { segmentsOf, spliceSegment, textOf } from '../renderer/src/source.js'
import { validateCommit } from '../renderer/src/validate.js'

let failures = 0
const check = (name, ok, detail = '') => {
  if (ok) {
    console.log(`OK   ${name}`)
  } else {
    failures += 1
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const doc = [
  'The opening paragraph.',                                    // 0
  '',                                                          // 1
  '<!-- imark quote="opening" by="m" at="2026-01-01T00:00Z"',  // 2
  'A note on the opening.',                                    // 3
  '-->',                                                       // 4
  '',                                                          // 5
  'A second paragraph.',                                       // 6
  '',                                                          // 7
  '<!-- imark quote="second" by="m" at="2026-01-02T00:00Z"',   // 8
  'A note on the second.',                                     // 9
  '-->',                                                       // 10
  '',                                                          // 11
  'A third paragraph.',                                        // 12
].join('\n')

const { comments } = extractComments(doc, 0)
const blocks = [[0, 1], [6, 7], [12, 13]]
const segs = segmentsOf(doc, blocks, comments)

const pieceAt = (line) => segs.find((s) => s.from === line)
const firstNote = pieceAt(2)
const secondNote = pieceAt(8)
const firstProse = pieceAt(0)

/// What the app will do: splice, then ask whether the result may be written.
const commit = (segment, replacement) => {
  const after = spliceSegment(doc, segment, replacement)
  return { after, verdict: validateCommit(doc, after, segment, replacement) }
}

console.log('▸ what a person may do to their own document')

{
  const { verdict, after } = commit(firstNote,
    '<!-- imark quote="opening" by="m" at="2026-01-01T00:00Z"\nReworded by hand.\n-->')
  check('reword a note', verdict.ok, verdict.reason)
  check('and the wording is what was typed',
    extractComments(after, 0).comments[0].text === 'Reworded by hand.')
}

{
  const { verdict } = commit(firstNote,
    '<!-- imark quote="opening" by="m" at="2026-01-01T00:00Z" color="red"\nA note on the opening.\n-->')
  check('recolour a note', verdict.ok, verdict.reason)
}

{
  const { verdict, after } = commit(firstNote, '')
  check('delete a note by clearing it', verdict.ok, verdict.reason)
  check('and it is gone', extractComments(after, 0).comments.length === 1)
}

{
  const { verdict } = commit(firstProse, 'The opening paragraph, corrected.')
  check('fix a typo in prose', verdict.ok, verdict.reason)
}

{
  const { verdict, after } = commit(firstProse, 'One paragraph.\n\nNow two.')
  check('split a paragraph, moving every note below it', verdict.ok, verdict.reason)
  check('and both notes came through',
    extractComments(after, 0).comments.length === 2)
}

{
  const { verdict, after } = commit(firstProse,
    'The opening paragraph.\n\n<!-- imark quote="opening" by="m" at="2026-02-01T00:00Z"\nWritten by hand.\n-->')
  check('write a new note by hand', verdict.ok, verdict.reason)
  check('and there are three of them now',
    extractComments(after, 0).comments.length === 3)
}

{
  // Orphaning is a state the app draws, not a failure it prevents.
  const { verdict } = commit(pieceAt(6), 'Nothing it quoted survives this.')
  check('edit away the words a note quoted', verdict.ok, verdict.reason)
}

console.log('\n▸ and what it has to refuse')

{
  // Deleting a close does not leave the opening dangling to the end of the
  // file: it scans on and takes the next note's `-->`, swallowing that note
  // whole. The refusal has to name the note that lost its close, not the one
  // that got eaten — that one is nowhere near where the person was typing.
  const { verdict, after } = commit(firstNote,
    '<!-- imark quote="opening" by="m" at="2026-01-01T00:00Z"\nA note on the opening.')
  check('a note whose close was deleted', !verdict.ok)
  check('and it blames the note that lost its close',
    /“opening”/.test(verdict.reason || ''), verdict.reason)
  check('and says to close it',
    /closing `-->`/.test(verdict.reason || ''), verdict.reason)
  check('the damage it prevented was two notes becoming one',
    extractComments(after, 0).comments.length === 1,
    String(extractComments(after, 0).comments.length))
}

{
  // The same mistake in the last note of a document, where there is no next
  // close to steal and the opening really does run to the end.
  const { verdict } = commit(secondNote,
    '<!-- imark quote="second" by="m" at="2026-01-02T00:00Z"\nA note on the second.')
  check('the last note, with nothing below to swallow', !verdict.ok)
  check('and that one is reported as never closed',
    /never closed/.test(verdict.reason || ''), verdict.reason)
}

{
  const { verdict } = commit(firstNote,
    '<!-- imark quote="opening" by="m" at="2026-01-01T00:00Z"\n'
    + 'The arrow --> ends it here.\nAnd this becomes prose.\n-->')
  check('a `-->` typed into the body', !verdict.ok)
  check('and it names the note it is about',
    /“opening”/.test(verdict.reason || ''), verdict.reason)
  check('and says what to write instead',
    /--&gt;/.test(verdict.reason || ''), verdict.reason)
}

{
  const { verdict } = commit(firstNote, 'Just some prose where a note used to be.')
  check('a note flattened into ordinary text', !verdict.ok)
  check('and it says what an opening line needs',
    /<!-- imark/.test(verdict.reason || ''), verdict.reason)
}

{
  const { verdict } = commit(firstProse,
    'The opening paragraph.\n\n<!-- imark quote="x" by="m" at="2026-02-01T00:00Z"\nNever closed.')
  check('an unterminated note opened in prose', !verdict.ok)
  check('and it points at the line that opened it',
    verdict.line === 2, String(verdict.line))
  // The opening finds the *next* note's close and eats everything between, so
  // the neighbour checks would report a note elsewhere as destroyed. True, and
  // useless: the person typed the cause, so the cause is what they are told.
  check('and it blames what was typed, not what it swallowed',
    /opens a note and never closes it/.test(verdict.reason || ''), verdict.reason)
}

console.log('\n▸ an edit may not reach past the piece it was given')

{
  // The failure that would be silent: a splice that damages a note nowhere
  // near the edit. Forged by handing the validator a range wider than the one
  // the edit actually covered, which is what a stale address does.
  const stale = { kind: 'content', from: 0, to: 11 }
  const after = spliceSegment(doc, stale, 'Everything above the third paragraph, gone.')
  const verdict = validateCommit(doc, after, { kind: 'content', from: 0, to: 1 },
    'Everything above the third paragraph, gone.')
  check('a stale range that swallows two notes is refused', !verdict.ok)
  check('and it says the note was not the one being edited',
    /not the one being edited/.test(verdict.reason || ''), verdict.reason)
}

{
  // Editing the first note must not be able to disturb the second.
  const { after } = commit(firstNote,
    '<!-- imark quote="opening" by="m" at="2026-01-01T00:00Z"\nStill fine.\n-->')
  const [, second] = extractComments(after, 0).comments
  check('the note below an edited note is untouched',
    second.text === 'A note on the second.' && second.quote === 'second')
}

console.log('\n▸ the shapes that trip a naive check')

{
  const { verdict } = commit(secondNote,
    '<!-- imark quote="second" by="m" at="2026-01-02T00:00Z"\nA note on the second.\n-->\n')
  check('a trailing blank line is spacing, not spilled text', verdict.ok, verdict.reason)
}

{
  const { verdict } = commit(pieceAt(12), 'A third paragraph, with an arrow --> in it.')
  check('a bare `-->` in prose is not a broken note', verdict.ok, verdict.reason)
}

{
  const { verdict } = commit(firstNote,
    '<!-- imark quote="opening" by="m" at="2026-01-01T00:00Z"\nMentions --&gt; safely.\n-->')
  check('an escaped arrow inside a note is fine', verdict.ok, verdict.reason)
}

// A validator that refuses things it should not is worse than no validator:
// people conclude the feature is broken and stop using it long before they
// file anything. So every piece of every real document is committed back
// unchanged, and every one of them has to be allowed.
console.log('\n▸ no false refusal anywhere in testdata/')

let md = null
try {
  const { default: MarkdownIt } = await import('../renderer/node_modules/markdown-it/index.mjs')
  md = new MarkdownIt({ html: true })
} catch {
  console.log('SKIP the corpus — run `cd renderer && npm ci` to include it')
}

if (md) {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const here = path.dirname(fileURLToPath(import.meta.url))

  const splitFrontMatter = (text) => {
    if (!text.startsWith('---')) return { body: text, offset: 0 }
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
    if (!match) return { body: text, offset: 0 }
    return { body: text.slice(match[0].length), offset: match[0].split('\n').length - 1 }
  }

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

    const refused = pieces
      .map((piece) => {
        const text = textOf(source, piece)
        return { piece, verdict: validateCommit(source, source, piece, text) }
      })
      .filter(({ verdict }) => !verdict.ok)

    check(`${name}: all ${pieces.length} pieces commit back unchanged`,
      refused.length === 0,
      refused.map(({ piece, verdict }) => `[${piece.from},${piece.to}) ${verdict.reason}`).join(' | '))
  }
}

console.log(failures === 0 ? '\nall good' : `\n${failures} failing`)
process.exit(failures === 0 ? 0 : 1)
