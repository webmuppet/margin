// Tests for moving a block somewhere else in the document.
//
//   node Support/test-move.mjs
//
// The arithmetic is the whole risk. A move is a cut and a paste against line
// numbers taken before the cut, and being out by one is a paragraph landing on
// the wrong side of its neighbour — which looks like a design decision rather
// than a bug, and so gets lived with.
//
// The case worth the most attention is a note travelling with its block. Notes
// anchor by position: a note is about the block it physically follows. Leaving
// one behind does not orphan it, which would at least be drawn as a warning. It
// silently turns it into a note about whatever is now above it.

import {
  canMove, documentAfterMove, moveLines, renumberHeadings, unitFor,
} from '../renderer/src/move.js'

let failures = 0
const check = (name, ok, detail = '') => {
  if (ok) {
    console.log(`OK   ${name}`)
  } else {
    failures += 1
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const doc = (...lines) => lines.join('\n')

// ------------------------------------------------------------------- units

console.log('▸ what a grab actually takes with it')

{
  const source = doc('First.', '', 'Second.', '', 'Third.')
  const unit = unitFor(source, 2, 3)
  check('a plain paragraph is only itself',
    unit.from === 2 && unit.to === 3, JSON.stringify(unit))
}

{
  const source = doc(
    '## Sources',            // 0
    '',                      // 1
    'What it is written from.', // 2
    '',                      // 3
    '### Detail',            // 4
    '',                      // 5
    'More.',                 // 6
    '',                      // 7
    '## Rules',              // 8
  )
  const unit = unitFor(source, 0, 1)
  check('a heading takes its section',
    unit.from === 0 && unit.to === 7, JSON.stringify(unit))
  check('and stops at the next heading of its own level',
    !source.split('\n').slice(unit.from, unit.to).includes('## Rules'))
  check('but takes the deeper ones inside it',
    source.split('\n').slice(unit.from, unit.to).includes('### Detail'))

  const deeper = unitFor(source, 4, 5)
  check('a deeper heading takes only its own',
    deeper.from === 4 && deeper.to === 7, JSON.stringify(deeper))
}

{
  const source = doc(
    'A paragraph.',                                          // 0
    '',                                                      // 1
    '<!-- imark quote="paragraph" by="m" at="2026-01-01T00:00Z"', // 2
    'A note about it.',                                      // 3
    '-->',                                                   // 4
    '',                                                      // 5
    'Another.',                                              // 6
  )
  const unit = unitFor(source, 0, 1)
  check('a block takes the note written about it',
    unit.from === 0 && unit.to === 5, JSON.stringify(unit))
  check('and not the blank line after it',
    unit.to === 5 && source.split('\n')[5] === '')
}

{
  const source = doc(
    'A paragraph.',                                          // 0
    '',                                                      // 1
    '<!-- imark quote="a" by="m" at="2026-01-01T00:00Z"',    // 2
    'One.',                                                  // 3
    '-->',                                                   // 4
    '',                                                      // 5
    '<!-- imark quote="b" by="m" at="2026-01-02T00:00Z"',    // 6
    'Two.',                                                  // 7
    '-->',                                                   // 8
    '',                                                      // 9
    'Another.',                                              // 10
  )
  check('two notes on one block both come',
    unitFor(source, 0, 1).to === 9, JSON.stringify(unitFor(source, 0, 1)))
}

// -------------------------------------------------------------- the arithmetic

console.log('\n▸ a block lands where it was dropped')

{
  const source = doc('A.', '', 'B.', '', 'C.')
  const unit = unitFor(source, 2, 3)

  check('moved to the top', moveLines(source, unit, 0) === doc('B.', '', 'A.', '', '', 'C.'),
    JSON.stringify(moveLines(source, unit, 0)))
  check('moved to the end, past everything',
    moveLines(source, unit, 5).trim().endsWith('B.'),
    JSON.stringify(moveLines(source, unit, 5)))
}

{
  const source = doc('A.', '', 'B.', '', 'C.')
  const unit = unitFor(source, 0, 1)
  const after = moveLines(source, unit, 4)
  const order = after.split('\n').filter((l) => l.trim())
  check('a block moved down past one neighbour swaps with it',
    order.join('|') === 'B.|A.|C.', order.join('|'))
}

{
  const source = doc('A.', '', 'B.')
  const unit = unitFor(source, 0, 1)
  check('dropping a block on itself changes nothing',
    moveLines(source, unit, 0) === source)
  check('and so does dropping it just after itself',
    moveLines(source, unit, 1) === source)
  check('which canMove says before anything is spliced',
    !canMove(unit, 0) && !canMove(unit, 1) && canMove(unit, 2))
}

{
  const source = doc('# Title', '', 'Body.', '', '# Other', '', 'More.')
  const unit = unitFor(source, 0, 1)
  check('a heading cannot be dropped inside its own section',
    !canMove(unit, 2), JSON.stringify(unit))
}

{
  const source = doc('A.', '', 'B.')
  const unit = unitFor(source, 2, 3)
  const after = moveLines(source, unit, 0)
  check('nothing is ever glued to its new neighbour',
    !/\S\n\S/.test(after), JSON.stringify(after))
}

console.log('\n▸ and its notes go with it')

{
  const source = doc(
    'First.',                                                // 0
    '',                                                      // 1
    'Second.',                                               // 2
    '',                                                      // 3
    '<!-- imark quote="Second." by="m" at="2026-01-01T00:00Z"', // 4
    'About the second.',                                     // 5
    '-->',                                                   // 6
    '',                                                      // 7
    'Third.',                                                // 8
  )
  const unit = unitFor(source, 2, 3)
  const after = moveLines(source, unit, 0)
  const lines = after.split('\n').filter((l) => l.trim())
  check('the note still follows the block it is about',
    lines[0] === 'Second.' && lines[1].startsWith('<!-- imark'), lines.join('|'))
  // The note is three lines of its own — opening, body, close — so what used to
  // be above the block sits at 4, not 3. Counting it as one line is how this
  // check first claimed a correct move was broken.
  check('and what it moved past is now below all of it',
    lines[4] === 'First.' && lines[5] === 'Third.', lines.join('|'))
}

// -------------------------------------------------------------- renumbering

console.log('\n▸ numbered headings are renumbered, and nothing else is')

{
  const source = doc('## 2. Rules', '', '## 1. Sources', '', '## 3. Open')
  check('numbers follow the order they are in now',
    renumberHeadings(source) === doc('## 1. Rules', '', '## 2. Sources', '', '## 3. Open'),
    JSON.stringify(renumberHeadings(source)))
}

{
  const source = doc('## 1. One', '', '### 5. Inner', '', '### 9. Also', '', '## 4. Two', '', '### 2. Again')
  const out = renumberHeadings(source).split('\n').filter((l) => l.trim())
  check('deeper levels count within their parent',
    out.join('|') === '## 1. One|### 1. Inner|### 2. Also|## 2. Two|### 1. Again', out.join('|'))
}

{
  const source = doc('## Sources', '', 'In 1999 things happened.', '', '## Rules')
  check('a heading nobody numbered is left alone', renumberHeadings(source) === source)
  check('and so is a paragraph that starts with a year',
    renumberHeadings(source).includes('In 1999 things happened.'))
}

{
  const source = doc('1. alpha', '2. beta', '', 'Text.')
  check('an ordered list is not a heading and is not touched',
    renumberHeadings(source) === source, JSON.stringify(renumberHeadings(source)))
}

console.log('\n▸ the two together')

{
  const source = doc('## 1. Sources', '', 'From.', '', '## 2. Rules', '', 'How.')
  const unit = unitFor(source, 4, 5)
  const after = documentAfterMove(source, unit, 0)
  const heads = after.split('\n').filter((l) => l.startsWith('## '))
  check('moving a numbered section renumbers both',
    heads.join('|') === '## 1. Rules|## 2. Sources', heads.join('|'))
  check('and the bodies went with their headings',
    after.indexOf('How.') < after.indexOf('## 2. Sources'), JSON.stringify(after))
}

{
  const source = doc('A.', '', 'B.')
  check('a move that changes nothing reports nothing',
    documentAfterMove(source, unitFor(source, 0, 1), 0) === null)
}

console.log(failures === 0 ? '\nall good' : `\n${failures} failing`)
process.exit(failures === 0 ? 0 : 1)
