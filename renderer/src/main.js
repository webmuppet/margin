import MarkdownIt from 'markdown-it'
import anchor from 'markdown-it-anchor'
import taskLists from 'markdown-it-task-lists'
import footnote from 'markdown-it-footnote'
import deflist from 'markdown-it-deflist'
import mark from 'markdown-it-mark'
import hljs from 'highlight.js'
import { load as parseYaml } from 'js-yaml'
import katex from 'katex'
import renderMathInElement from 'katex/contrib/auto-render'
import mermaid from 'mermaid'

import wikilink from './wikilink.js'
import { ICON_SOURCE, elementsFor, openSourceEditor, withEmptyAncestors } from './editor.js'
import { canMove, documentAfterMove, neighbourUnit, unitFor } from './move.js'
import { segmentsOf, spliceSegment, textOf } from './source.js'
import { validateCommit, validateMove } from './validate.js'
import {
  attachComments,
  attached as attachedNotes,
  buildNoteRail,
  extractComments,
  installCommentHandlers,
  isReviewing,
  restoreNoteState,
  setReviewing as applyReviewing,
  stepNote,
  toVisibleText,
} from './comments.js'
import './style.css'

const bridge = (payload) => {
  window.webkit?.messageHandlers?.imark?.postMessage(payload)
}

/* ------------------------------------------------------------------ paths */

// Absolute path of the directory holding the document currently rendered.
let docDir = '/'

function normalizePath(path) {
  const parts = path.split('/')
  const out = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return '/' + out.join('/')
}

function resolveLocal(href) {
  const path = href.startsWith('/') ? href : `${docDir}/${href}`
  return normalizePath(decodeURI(path))
}

// Local files are served by a WKURLSchemeHandler on the Swift side so that
// images next to the document load without granting file:// access.
const fileURL = (absPath) => `margin://file${absPath.split('/').map(encodeURIComponent).join('/')}`

const isExternal = (href) => /^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('imark:')

/* ----------------------------------------------------------------- parser */

const slugCounts = new Map()

function slugify(text) {
  const base =
    text
      .toLowerCase()
      .trim()
      .replace(/[̀-ͯ]/g, '')
      .normalize('NFD')
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s+/g, '-') || 'section'
  const seen = slugCounts.get(base) ?? 0
  slugCounts.set(base, seen + 1)
  return seen === 0 ? base : `${base}-${seen}`
}

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  breaks: false,
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
      } catch {
        /* fall through to auto */
      }
    }
    try {
      return hljs.highlightAuto(code).value
    } catch {
      return ''
    }
  },
})

md.use(anchor, { slugify, permalink: false, tabIndex: false })
  .use(taskLists, { enabled: true, label: true })
  .use(footnote)
  .use(deflist)
  .use(mark)
  .use(wikilink)

// Every block token knows which lines of the source produced it. Emitting that
// into the DOM is what lets a selection on screen be turned back into a
// position in the file — without it, writing anything next to a paragraph is
// guesswork.
// The front matter is stripped before parsing, so markdown-it counts from the
// body while the file counts from the top. Everything it reports is short by
// however many lines the front matter took.
let lineOffset = 0

const stampLines = (token) => {
  if (!token.map) return
  token.attrSet('data-line', `${token.map[0] + lineOffset},${token.map[1] + lineOffset}`)
}

const defaultRenderToken = md.renderer.renderToken.bind(md.renderer)
md.renderer.renderToken = (tokens, idx, options) => {
  if (tokens[idx].nesting !== -1) stampLines(tokens[idx])
  return defaultRenderToken(tokens, idx, options)
}

/**
 * A ```diff block, rendered the way everybody already reads a diff: the whole
 * row tinted rather than just the `+` or the `-`, with the old and new line
 * numbers down the side.
 *
 * highlight.js colours the marker character and leaves the rest of the line on
 * the block's own background, which is legible but has to be read a character
 * at a time. Tinting the row is what makes a diff scannable.
 *
 * Unified only. A reading column is one column, and two columns of code inside
 * it is a different app.
 */
function renderDiff(source) {
  const HUNK = /^@@+ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/
  let oldNo = 0
  let newNo = 0

  const rows = source.split('\n').map((line) => {
    const cell = (kind, left, right) =>
      `<div class="diff-row diff-${kind}">`
      + `<span class="diff-num">${left}</span>`
      + `<span class="diff-num">${right}</span>`
      + `<code>${escapeHtml(line) || '&nbsp;'}</code>`
      + '</div>'

    const hunk = line.match(HUNK)
    if (hunk) {
      oldNo = Number(hunk[1])
      newNo = Number(hunk[2])
      return cell('hunk', '', '')
    }
    // The `diff --git`, `index`, `---` and `+++` preamble. Matched before the
    // +/- tests, or the file headers would be read as an added and a removed
    // line and tinted as changes nobody made.
    if (/^(diff --git |index |--- |\+\+\+ |new file|deleted file|similarity|rename |Binary files )/.test(line)) {
      return cell('meta', '', '')
    }
    if (line.startsWith('+')) return cell('add', '', newNo++)
    if (line.startsWith('-')) return cell('del', oldNo++, '')
    if (line.startsWith('\\')) return cell('meta', '', '')
    return cell('ctx', oldNo++, newNo++)
  })

  return `<div class="diff-block">${rows.join('')}</div>`
}

// Fenced ```mermaid blocks are held aside and rendered after the HTML lands.
const defaultFence = md.renderer.rules.fence.bind(md.renderer.rules)
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  const info = (token.info || '').trim().split(/\s+/)[0]
  // Built by hand rather than through renderToken, so the offset has to be
  // applied here too — this is exactly where it was forgotten once already.
  const lines = token.map
    ? ` data-line="${token.map[0] + lineOffset},${token.map[1] + lineOffset}"`
    : ''
  if (info === 'mermaid') {
    return `<div class="mermaid-block"${lines} data-graph="${encodeURIComponent(token.content)}"></div>`
  }
  if (info === 'diff') {
    return `<div class="code-wrap diff-wrap"${lines} data-lang="diff">${renderDiff(token.content)}</div>`
  }
  const html = defaultFence(tokens, idx, options, env, self)
  const label = info || 'text'
  return `<div class="code-wrap"${lines} data-lang="${label}">${html}</div>`
}

// Rewrite relative hrefs/srcs so they resolve against the document's folder.
const patchAttr = (rules, rule, attr) => {
  const original = rules[rule]
  rules[rule] = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    const i = token.attrIndex(attr)
    if (i >= 0) {
      const value = token.attrs[i][1]
      if (!isExternal(value) && !value.startsWith('#')) {
        token.attrs[i][1] = fileURL(resolveLocal(value))
      }
    }
    return original
      ? original(tokens, idx, options, env, self)
      : self.renderToken(tokens, idx, options)
  }
}
patchAttr(md.renderer.rules, 'image', 'src')
patchAttr(md.renderer.rules, 'link_open', 'href')

/* ------------------------------------------------------- front matter */

function splitFrontMatter(text) {
  if (!text.startsWith('---')) return { data: null, body: text, offset: 0 }
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!match) return { data: null, body: text, offset: 0 }
  try {
    const data = parseYaml(match[1])
    if (data && typeof data === 'object') {
      return {
        data,
        body: text.slice(match[0].length),
        offset: match[0].split('\n').length - 1,
      }
    }
  } catch {
    /* malformed front matter is shown as-is */
  }
  return { data: null, body: text, offset: 0 }
}

const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function renderFrontMatter(data) {
  if (!data) return ''
  const title = data.title ?? data.name
  const rows = Object.entries(data)
    // `imark:` is how a document tells the app what it is — machinery, not
    // something the person reading it put there or needs to see.
    .filter(([key]) => key !== 'title' && key !== 'name' && key !== 'imark')
    .map(([key, value]) => {
      const shown = Array.isArray(value)
        ? value.map((v) => `<span class="fm-chip">${escapeHtml(v)}</span>`).join('')
        : value && typeof value === 'object'
          ? `<code>${escapeHtml(JSON.stringify(value))}</code>`
          : escapeHtml(value)
      return `<div class="fm-row"><dt>${escapeHtml(key)}</dt><dd>${shown}</dd></div>`
    })
    .join('')
  if (!title && !rows) return ''
  return `<header class="front-matter">
    ${title ? `<h1 class="fm-title">${escapeHtml(title)}</h1>` : ''}
    ${rows ? `<dl class="fm-grid">${rows}</dl>` : ''}
  </header>`
}

/* --------------------------------------------------------------- mermaid */

let mermaidSeq = 0

// Mermaid ships its own palette, which clashes badly with ours. Feeding it the
// live CSS variables keeps diagrams on-theme in both light and dark.
function mermaidTheme() {
  const css = getComputedStyle(document.documentElement)
  const token = (name) => css.getPropertyValue(name).trim()
  return {
    background: token('--bg'),
    primaryColor: token('--code-bg'),
    primaryTextColor: token('--text'),
    primaryBorderColor: token('--diagram'),
    secondaryColor: token('--accent-soft'),
    secondaryBorderColor: token('--diagram'),
    tertiaryColor: token('--bg'),
    tertiaryBorderColor: token('--border'),
    lineColor: token('--secondary'),
    textColor: token('--text'),
    mainBkg: token('--code-bg'),
    nodeBorder: token('--diagram'),
    clusterBkg: token('--bg'),
    clusterBorder: token('--border'),
    edgeLabelBackground: token('--bg'),
    fontSize: '14px',
  }
}

async function renderMermaid(root, theme) {
  const blocks = root.querySelectorAll('.mermaid-block')
  if (!blocks.length) return
  mermaid.initialize({
    startOnLoad: false,
    theme: 'base',
    themeVariables: mermaidTheme(),
    securityLevel: 'strict',
    fontFamily: 'inherit',
  })
  for (const block of blocks) {
    const source = decodeURIComponent(block.dataset.graph || '')
    try {
      const { svg } = await mermaid.render(`mermaid-${mermaidSeq++}`, source)
      block.innerHTML = svg
      block.classList.add('is-rendered')
    } catch (error) {
      block.classList.add('is-error')
      block.innerHTML = `<div class="diagram-error"><strong>Invalid diagram</strong><pre>${escapeHtml(
        error?.message ?? error,
      )}</pre></div>`
    }
  }
}

/* ------------------------------------------------------------------ math */

function renderMath(root) {
  try {
    renderMathInElement(root, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '\\[', right: '\\]', display: true },
        { left: '$', right: '$', display: false },
        { left: '\\(', right: '\\)', display: false },
      ],
      ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
      throwOnError: false,
    })
  } catch {
    /* math is best-effort */
  }
}

/* ------------------------------------------------------------------- toc */

function buildToc(root) {
  const headings = [...root.querySelectorAll('h1, h2, h3, h4, h5, h6')].filter((h) => h.id)
  bridge({
    type: 'toc',
    items: headings.map((h) => ({
      id: h.id,
      level: Number(h.tagName.slice(1)),
      title: h.textContent.trim(),
    })),
  })
  return headings
}

/* ---------------------------------------------------------------- scroll */

// The browser's own `behavior: 'smooth'` scales its duration with the distance
// travelled, so a jump across a long document takes one or two seconds. This
// starts at once and always lands in about a third of a second.
let scrollAnimation = 0

function glideTo(top) {
  cancelAnimationFrame(scrollAnimation)

  const from = window.scrollY
  const to = Math.max(0, Math.min(top, document.body.scrollHeight - window.innerHeight))
  const delta = to - from
  if (Math.abs(delta) < 2) return window.scrollTo(0, to)

  // Long jumps get a little longer, but never much: 260ms to 420ms.
  const duration = Math.min(420, 260 + Math.abs(delta) * 0.06)
  const start = performance.now()
  // Quintic ease-out: leaves immediately, arrives without a bump.
  const ease = (t) => 1 - Math.pow(1 - t, 5)

  // If requestAnimationFrame is not running — WebKit stops it whenever it
  // decides the view is not visible — land on the target anyway.
  const failsafe = setTimeout(() => {
    cancelAnimationFrame(scrollAnimation)
    window.scrollTo(0, to)
  }, duration + 120)

  const step = (now) => {
    const t = Math.min(1, (now - start) / duration)
    window.scrollTo(0, from + delta * ease(t))
    if (t < 1) {
      scrollAnimation = requestAnimationFrame(step)
    } else {
      clearTimeout(failsafe)
    }
  }
  scrollAnimation = requestAnimationFrame(step)
}

/* ------------------------------------------------------------------ rail */

// The table of contents for Quick Look, where there is no room for a sidebar.
// Only H1 to H3 get a tick: every mark has to be a place you can name, or the
// rail is texture rather than navigation.

const RAIL_SPAN = 0.72       // how much of the panel the rail should fill
// Between two headings. Every row is half of this, because a minor gradation
// sits in each gap.
const RAIL_PITCH_RANGE = [11, 22]
// A minor row is a gradation, not a place: thin, faint, and it grows far less
// than a heading when the funnel passes over it.
const RAIL_MINOR_WIDTH = 5
const RAIL_MINOR_OPACITY = 0.15
const RAIL_MINOR_AMPLITUDE = 10
// Narrow on purpose. At 2.6 the third tick either side still grew by half and
// the funnel read as a blunt bulge; at 1.15 only the immediate neighbours are
// clearly bigger and everything past them settles back to rest.
const RAIL_SIGMA = 1.15
const RAIL_AMPLITUDE = 32    // how much longer the mark at the centre grows

// Set per document: few headings spread out, many pack in, so the rail is
// neither a stub nor an overflowing column.
let railPitch = RAIL_PITCH_RANGE[0]

// Every row in the rail, majors and minors alike. Indices everywhere below are
// row indices; `railSection` maps one back to the heading it belongs to.
let railTicks = []
let railSection = []
let railBlocks = []
let railTip = null

let railScrollIndex = 0
// Where the funnel is centred. Normally that follows the scroll position, but
// while the pointer is on the rail it follows the pointer instead — you get to
// look around the document before deciding to go there.
let railHoverIndex = null

const paintRail = () => updateRail(railHoverIndex ?? railScrollIndex)

const headingLevel = (el) => (/^H[1-6]$/.test(el.tagName) ? Number(el.tagName[1]) : 0)

// Headings stand slightly proud of prose, but only slightly: if the resting
// widths spread too far they compete with the funnel and the rail reads as
// noise instead of as one moving shape.
const restingWidth = (level) => 10 + Math.max(0, 3 - level) * 3

const restingOpacity = (level) => 0.34 + Math.max(0, 3 - level) * 0.06

// A bell instead of a linear ramp with a cutoff: the taper has no edge, so the
// funnel reads as one soft shape however fast you move.
const falloffAt = (distance) => Math.exp(-(distance * distance) / (2 * RAIL_SIGMA * RAIL_SIGMA))

function collectBlocks(root) {
  const all = [...root.querySelectorAll('h1, h2, h3')]
  // As many headings as the panel can hold at the tightest pitch. Halved
  // against the row count, since each heading now brings a gradation with it.
  const capacity = Math.max(12, Math.floor((window.innerHeight * 0.94) / RAIL_PITCH_RANGE[0] / 2))
  if (all.length <= capacity) return all
  // Sample evenly instead of truncating: the rail has to stay proportional to
  // the whole document, or scrubbing lies about where you are.
  const step = all.length / capacity
  return Array.from({ length: capacity }, (_, i) => all[Math.floor(i * step)])
}

function buildRail(root) {
  document.querySelector('.rail')?.remove()
  document.querySelector('.rail-tip')?.remove()

  railTicks = []
  railSection = []
  railBlocks = collectBlocks(root)
  railHoverIndex = null
  if (railBlocks.length < 3) return

  // A row is half the distance between two headings: one heading, one gradation
  // between it and the next. The last heading has nothing after it to bridge to.
  const rows = railBlocks.length * 2 - 1
  // The range is written in headings, so it is halved before it meets a count
  // of rows. Clamping a row pitch with heading bounds and halving afterwards
  // gives a rail half the height it should be.
  const [minPitch, maxPitch] = RAIL_PITCH_RANGE
  railPitch = Math.min(maxPitch / 2, Math.max(minPitch / 2, (window.innerHeight * RAIL_SPAN) / rows))

  const rail = document.createElement('nav')
  rail.className = 'rail'
  rail.setAttribute('aria-hidden', 'true')
  rail.style.setProperty('--rail-row', `${railPitch}px`)

  const add = (block, index, minor) => {
    // The dash sits inside a taller transparent row, because a 2px mark is
    // impossible to hit with a pointer.
    const slot = document.createElement('span')
    slot.className = minor ? 'rail-tick minor' : 'rail-tick'
    slot.dataset.level = String(headingLevel(block))
    // Which heading a row belongs to. A minor answers to the heading above it,
    // so nothing on the rail is dead to the pointer — and the notes rail lines
    // its marks up with the majors, which need to say where in the document
    // they start. A tick's own position is a slot in a list, not a place.
    if (block.id && !minor) slot.dataset.heading = block.id
    slot.appendChild(document.createElement('i'))
    rail.appendChild(slot)
    railTicks.push(slot)
    railSection.push(index)
  }

  railBlocks.forEach((block, index) => {
    add(block, index, false)
    if (index < railBlocks.length - 1) add(block, index, true)
  })

  railTip = document.createElement('aside')
  railTip.className = 'rail-tip'
  document.body.appendChild(railTip)

  attachRail(rail)
  document.body.appendChild(rail)
}

function updateRail(centre) {
  railTicks.forEach((tick, index) => {
    const dash = tick.firstElementChild
    if (!dash) return

    const minor = tick.classList.contains('minor')
    const level = Number(tick.dataset.level || 0)
    const base = minor ? RAIL_MINOR_WIDTH : restingWidth(level)
    const rest = minor ? RAIL_MINOR_OPACITY : restingOpacity(level)
    const amplitude = minor ? RAIL_MINOR_AMPLITUDE : RAIL_AMPLITUDE
    // Measured in headings, not rows. The bell was tuned so that the tick
    // either side grows and the third is back at rest; counting gradations
    // would halve its reach and the funnel would crawl at half speed.
    const weight = falloffAt((index - centre) / 2)

    dash.style.width = `${base + weight * amplitude}px`
    dash.style.opacity = `${rest + weight * (1 - rest)}`
    tick.classList.toggle('is-active', index === centre && !minor)
  })
}

/* ---------------------------------------------------------- rail tooltip */

// A comment card lives inside the block it is attached to, so the plain text of
// a block is not its text content any more — without this the preview quoted
// somebody's note back as if it were the document.
const flatten = (el) => {
  const copy = el.cloneNode(true)
  for (const note of copy.querySelectorAll('.note-card, .note-dot, .note-actions')) note.remove()
  return copy.textContent.replace(/\s+/g, ' ').trim()
}

// A commented block is wrapped, so its neighbours are the wrapper's neighbours.
const outermost = (el) =>
  el.parentElement?.classList.contains('note-holder') ? el.parentElement : el

const headingIn = (el) =>
  /^H[1-6]$/.test(el.tagName) ? el : el.querySelector('h1, h2, h3, h4, h5, h6')

/// How many notes fall under this heading, down to the next one at the same
/// level or higher. The rail on the other edge says where the notes are; this
/// says whether the section you are about to jump to has any, which is the
/// question you have while reading the outline.
function notesInSection(heading) {
  const start = outermost(heading)
  const level = headingLevel(heading)
  let count = start.querySelectorAll('.note-dot').length

  for (let node = start.nextElementSibling; node; node = node.nextElementSibling) {
    const inner = headingIn(node)
    const innerLevel = inner ? headingLevel(inner) : 0
    if (innerLevel > 0 && innerLevel <= level) break
    count += node.querySelectorAll('.note-dot').length
  }
  return count
}

function tipContent(index) {
  const heading = railBlocks[index]
  if (!heading) return null

  // Every tick is a heading now, so the title is the tick itself. The body has
  // to come from the DOM rather than from railBlocks — the prose that follows
  // is no longer in the list.
  let body = ''
  let sibling = outermost(heading).nextElementSibling
  while (sibling && !headingIn(sibling)) {
    body = flatten(sibling)
    if (body) break
    sibling = sibling.nextElementSibling
  }

  const position = railBlocks.length > 1 ? index / (railBlocks.length - 1) : 0

  return {
    label: `${Math.round(position * 100)}% in`,
    title: flatten(heading),
    body,
    notes: notesInSection(heading),
  }
}

function showTip(index, tick) {
  if (!railTip || !tick) return
  const content = tipContent(railSection[index] ?? index)
  if (!content) return

  railTip.replaceChildren()

  const label = document.createElement('em')
  label.textContent = content.label
  if (content.notes) {
    const badge = document.createElement('i')
    badge.className = 'rail-tip-notes'
    badge.textContent = content.notes === 1 ? '1 comment' : `${content.notes} comments`
    label.appendChild(badge)
  }
  railTip.appendChild(label)

  const heading = document.createElement('strong')
  heading.textContent = content.title
  railTip.appendChild(heading)

  if (content.body) {
    const body = document.createElement('span')
    body.textContent = content.body
    railTip.appendChild(body)
  }

  railTip.classList.add('is-visible')

  // Anchor to the tick, then keep the whole card on screen. Height has to be
  // read after the content lands or the first frame is positioned wrong.
  const box = tick.getBoundingClientRect()
  const height = railTip.offsetHeight
  const top = Math.min(
    Math.max(10, box.top + box.height / 2 - height / 2),
    window.innerHeight - height - 10,
  )
  railTip.style.top = `${top}px`
}

function hideTip() {
  railTip?.classList.remove('is-visible')
}

/* --------------------------------------------------------- rail scrubbing */

function attachRail(rail) {
  let scrubbing = false

  const nearest = (clientY) => {
    const first = railTicks[0].getBoundingClientRect()
    // Ticks are evenly pitched, so arithmetic beats measuring all of them on
    // every pointer move.
    const index = Math.round((clientY - (first.top + first.height / 2)) / railPitch)
    return Math.min(Math.max(index, 0), railTicks.length - 1)
  }

  /// Where the document should sit for a pointer anywhere along the rail —
  /// between headings as well as on them.
  ///
  /// Snapping to the nearest heading is right for a click and wrong for a drag:
  /// it made scrubbing jump from section to section, which reads as the rail
  /// resisting rather than following. This interpolates between the heading
  /// above and the one below, so the page moves with the hand the way a
  /// scrollbar does, while the rail still means headings.
  const scrollAt = (clientY) => {
    const first = railTicks[0].getBoundingClientRect()
    const row = (clientY - (first.top + first.height / 2)) / railPitch
    // Rows are half-headings — one tick per heading, one gradation between.
    const at = Math.min(Math.max(row / 2, 0), railBlocks.length - 1)
    const lower = Math.floor(at)
    const upper = Math.min(lower + 1, railBlocks.length - 1)
    const topOf = (i) => railBlocks[i].getBoundingClientRect().top + window.scrollY - 24
    const from = topOf(lower)
    return from + (topOf(upper) - from) * (at - lower)
  }

  // A gradation takes you to the heading it sits under. It is not a place of
  // its own, and a row that swallows a click is worse than one that is not
  // there.
  const goTo = (index, smooth) => {
    const target = railBlocks[railSection[index]]
    if (!target) return
    const top = target.getBoundingClientRect().top + window.scrollY - 24
    // Dragging tracks the pointer one to one; a click gets the glide.
    if (smooth) glideTo(top)
    else {
      cancelAnimationFrame(scrollAnimation)
      window.scrollTo(0, top)
    }
    railScrollIndex = index
  }

  // Deliberately not coalesced through requestAnimationFrame: WebKit stops
  // firing it whenever it decides the view is not visible, and a rail that
  // freezes is worse than one that does a little extra work. Instead the work
  // is skipped outright while the pointer stays within the same tick, which is
  // most pointer moves.
  const track = (clientY) => {
    // The page follows the pointer continuously, on every move — outside the
    // tick check below, which exists to skip repainting the funnel and would
    // otherwise make the scroll steppy again for a different reason.
    if (scrubbing) {
      cancelAnimationFrame(scrollAnimation)
      window.scrollTo(0, scrollAt(clientY))
    }
    const index = nearest(clientY)
    if (index === railHoverIndex) return
    railHoverIndex = index
    paintRail()
    showTip(index, railTicks[index])
    if (scrubbing) railScrollIndex = index
  }

  rail.addEventListener('pointermove', (event) => track(event.clientY))

  rail.addEventListener('pointerdown', (event) => {
    scrubbing = true
    rail.classList.add('is-scrubbing')
    rail.setPointerCapture(event.pointerId)
    goTo(nearest(event.clientY), true)
    event.preventDefault()
  })

  const release = (event) => {
    if (!scrubbing) return
    scrubbing = false
    rail.classList.remove('is-scrubbing')
    if (rail.hasPointerCapture?.(event.pointerId)) rail.releasePointerCapture(event.pointerId)
  }
  rail.addEventListener('pointerup', release)
  rail.addEventListener('pointercancel', release)

  rail.addEventListener('pointerleave', () => {
    if (scrubbing) return
    railHoverIndex = null
    paintRail()
    hideTip()
  })
}

/* -------------------------------------------------------- code copy button */

function addCopyButtons(root) {
  for (const wrap of root.querySelectorAll('.code-wrap')) {
    const button = document.createElement('button')
    button.className = 'copy-btn'
    button.type = 'button'
    button.textContent = 'Copiar'
    button.addEventListener('click', async () => {
      // A diff is one `code` per row, so the first one alone would copy a
      // single line and look like it had worked.
      const code = wrap.classList.contains('diff-wrap')
        ? [...wrap.querySelectorAll('.diff-row code')].map((el) => el.textContent).join('\n')
        : wrap.querySelector('code')?.textContent ?? ''
      try {
        await navigator.clipboard.writeText(code)
        button.textContent = 'Copiado'
      } catch {
        button.textContent = 'Falhou'
      }
      setTimeout(() => {
        button.textContent = 'Copiar'
      }, 1400)
    })
    wrap.appendChild(button)
  }
}

/* ---------------------------------------------------------------- render */

const content = () => document.getElementById('content')

let activeHeadings = []
let renderToken = 0

// Kept so comments can be exported without asking Swift to hand the file back.
let lastSource = ''
// And the notes found in it, so an edit can be checked against the document as
// it was rather than against a second parse that might already disagree.
let lastComments = []

async function render({ markdown, path, theme, preview, rail }) {
  const token = ++renderToken
  lastSource = markdown ?? ''
  docDir = path ? path.slice(0, path.lastIndexOf('/')) || '/' : '/'
  slugCounts.clear()

  // The very first render carries the theme and the preview flag — without this
  // the page keeps the defaults from index.html until something calls the
  // setters, and in Quick Look those calls arrive before the page exists.
  if (theme) document.documentElement.dataset.theme = theme
  if (preview) document.documentElement.dataset.preview = 'true'
  // 'left' in the preview panel, 'right' in a window where the sidebar already
  // owns the left edge. Absent means no rail at all.
  if (rail) document.documentElement.dataset.rail = rail
  else delete document.documentElement.dataset.rail

  const { data, body, offset } = splitFrontMatter(markdown ?? '')
  lineOffset = offset
  const root = content()
  const previousScroll = window.scrollY

  // Taken out before parsing so the blocks can never show up as document text,
  // and blanked rather than deleted so the line map stays honest.
  const { body: clean, comments } = extractComments(body, offset)
  lastComments = comments

  root.innerHTML = clean.trim()
    ? renderFrontMatter(data) + md.render(clean)
    : `${renderFrontMatter(data)}<p class="empty">This file is empty</p>`
  if (token !== renderToken) return

  const notes = attachComments(root, comments)
  restoreNoteState()
  bridge({ type: 'comments', count: notes.length, reviewing: isReviewing(), items: notes })

  // The highlight elements went out with the old DOM.
  matches = []
  matchIndex = -1

  addCopyButtons(root)
  // After the notes are attached, never before: a commented block is wrapped in
  // a holder, so the elements a piece of the file stands for are not the ones
  // that were there a moment ago. Held rather than derived on demand because
  // the margin control looks this up on every mousemove.
  lastSegments = editableSegments()
  // A drag cannot survive the document being rebuilt under it: the element it
  // was carrying is detached and its line numbers describe a file that no
  // longer exists. dragend normally clears this, and normally is not a
  // guarantee — a commit re-renders without one, and a stale drag would then
  // drop a range from the previous version of the document into this one.
  dragging = null
  clearDropMarks()
  renderMath(root)
  activeHeadings = buildToc(root)
  buildRail(root)
  // After the outline rail, never before: the marks are placed against its
  // ticks, and ticks that do not exist yet put every note at the top.
  buildNoteRail()
  await renderMermaid(root, theme)
  if (token !== renderToken) return

  const words = root.textContent.trim().split(/\s+/).filter(Boolean).length
  bridge({ type: 'meta', words, minutes: Math.max(1, Math.round(words / 220)) })

  // Swift resolves these against the filesystem and tells us which ones are
  // dead, so the renderer never has to know where notes live.
  const targets = [...root.querySelectorAll('a.wikilink')].map((a) => a.dataset.wikilink)
  if (targets.length) bridge({ type: 'wikilinks', targets: [...new Set(targets)] })

  window.scrollTo(0, Math.min(previousScroll, document.body.scrollHeight))
  updateActiveHeading()
  bridge({ type: 'rendered' })
}

/* --------------------------------------------------------- scroll tracking */

let scrollQueued = false

function updateActiveHeading() {
  if (!activeHeadings.length) return
  let index = 0
  for (let i = 0; i < activeHeadings.length; i += 1) {
    if (activeHeadings[i].getBoundingClientRect().top <= 80) index = i
    else break
  }
  bridge({ type: 'active', id: activeHeadings[index].id })

  let block = 0
  for (let i = 0; i < railBlocks.length; i += 1) {
    if (railBlocks[i].getBoundingClientRect().top <= 90) block = i
    else break
  }
  // Headings sit on the even rows, gradations on the odd ones.
  railScrollIndex = block * 2
  paintRail()
}

window.addEventListener(
  'scroll',
  () => {
    if (scrollQueued) return
    scrollQueued = true
    requestAnimationFrame(() => {
      scrollQueued = false
      updateActiveHeading()
    })
  },
  { passive: true },
)

/* --------------------------------------------------------- source editing */

/// The line ranges of the blocks currently on screen, read back out of the
/// `data-line` the renderer stamped on them. Read from the DOM rather than kept
/// from the parse: what is on screen is the only thing the person can point at,
/// and a list held from the parse before would still look valid after an edit
/// while naming the wrong lines.
/// Every block of the document, in order.
///
/// Descends through anything that is not itself a block. A commented block is
/// wrapped in a note holder, so it stops being a child of the document and
/// becomes a grandchild — and reading only the top level means every block
/// somebody has commented on is invisible, which is exactly backwards. That has
/// now been the same bug twice, in two features, so there is one walk.
/// selectionInfo has stepped past the same wrapper since comments were built.
function documentBlocks() {
  const found = []
  const walk = (parent) => {
    for (const child of parent.children) {
      // A note's own card is not document text. It has no lines in the file,
      // and what it holds is a comment about the block, not the block.
      if (child.classList.contains('note-card')) continue
      if (lineRange(child)) found.push(child)
      else walk(child)
    }
  }
  walk(content())
  return found
}

function blockRanges() {
  return documentBlocks().map((block) => {
    const { start, end } = lineRange(block)
    return [start, end]
  })
}

/// Every piece of the document that can be opened as markdown.
export function editableSegments() {
  return segmentsOf(lastSource, blockRanges(), lastComments)
}

/// The pieces of the document as it currently stands, recomputed on each render
/// and read by the margin control.
let lastSegments = []

/// Whether this document may be changed in place at all.
///
/// Kept on the root element rather than in a variable, so the stylesheet can
/// answer most of the question on its own — a control that is never drawn needs
/// no code to explain why. The paths that write still check it themselves,
/// because a hidden button is a thing you cannot press and not a thing that
/// cannot happen: the delete key never had a button in the first place.
const editingAllowed = () =>
  document.documentElement.dataset.editing !== 'false'
  && document.documentElement.dataset.preview !== 'true'

/// The piece a point on screen belongs to.
///
/// A block is usually one piece, and then this is the piece the `+` is standing
/// beside. A list with a note written into the middle of it is two, inside one
/// `<ul>`, and which one you meant is decided by where the pointer is — the
/// only thing that can tell them apart, since they share a block.
function segmentAt(block, clientY) {
  const root = content()
  const within = lastSegments.filter(
    (piece) => piece.kind === 'content' && elementsFor(root, piece).some((el) => block.contains(el))
  )
  if (within.length < 2) return within[0] ?? null
  const under = within.find((piece) =>
    elementsFor(root, piece).some((el) => {
      const rect = el.getBoundingClientRect()
      return clientY >= rect.top && clientY <= rect.bottom
    })
  )
  // A pointer in the gap between two pieces of the same block belongs to
  // neither. The first is the better guess than nothing: it is the one the
  // control is drawn beside.
  return under ?? within[0]
}

/// Opening a note's own markdown, asked for from its card.
///
/// The card renders a note; this shows the lines it was rendered from, so a
/// mistyped quote or an attribute the composer does not offer can be corrected
/// in place. It is also the one edit that can break the thing it is editing,
/// which is why nothing gets written without validateCommit agreeing.
document.addEventListener('imark:editMarker', (event) => {
  const { line, button } = event.detail
  const piece = editableSegments().find(
    (segment) => segment.kind === 'marker' && segment.from === line
  )
  const card = button.closest('.note-card')
  // One editor at a time anywhere in the document, not just on this card.
  if (!piece || !card || !editingAllowed() || editorIsOpen()) return

  // The card's own rendering of the note goes; its controls stay. A way in that
  // disappears once you are through it leaves no way back out.
  const hide = [...card.children].filter((child) => !child.classList.contains('note-actions'))

  button.classList.add('is-on')
  openSourceEditor({
    segment: piece,
    hide,
    label: 'Markdown source for this note',
    place: (box) => card.insertBefore(box, card.querySelector('.note-actions')),
    sourceOf: (target) => textOf(lastSource, target),
    commit: commitSource,
    onClosed: () => {
      button.classList.remove('is-on')
      button.focus()
    },
  })
})

/* ---------------------------------------------------------- moving a block */

/// The lines a grab on the margin would move: the block, its section if it is a
/// heading, and the notes written about anything inside.
function unitUnderPointer(block) {
  const lines = lineRange(block)
  return lines ? unitFor(lastSource, lines.start, lines.end) : null
}

/// Puts a moved document on its way to Swift, once it is sure nothing was lost.
///
/// Checked against the set of notes rather than their positions: a move changes
/// where every note below it sits, so asking whether they stayed put would
/// refuse every move there is. What must hold is that the same notes are still
/// in the document.
function commitMove(unit, before) {
  const after = documentAfterMove(lastSource, unit, before)
  if (!after) return { ok: true, unchanged: true }

  const verdict = validateMove(lastSource, after)
  if (!verdict.ok) return verdict

  bridge({ type: 'moveBlock', document: after })
  return { ok: true }
}

/// Where a drop on this block would land, in lines: above it, or past
/// everything it carries.
const landingFor = (block, below) => {
  const unit = unitUnderPointer(block)
  return unit ? (below ? unit.to : unit.from) : null
}

/// Whether a landing line is a place this drag could actually go. A block
/// cannot be dropped inside itself, and a heading cannot be dropped inside its
/// own section — both ask for the lines to end up before themselves.
const canLand = (landing) => !!dragging && canMove(dragging.unit, landing)

/// The block a point belongs to, whether or not it is inside one.
///
/// blockAtHeight answers only for points inside a block's own rectangle, which
/// is right for the `+` — it appears beside something. A drop has to answer
/// everywhere, including the gaps between blocks, because a gap is what you aim
/// at when putting something between two things.
function blockNearest(clientY) {
  let best = null
  let nearest = Infinity
  for (const block of documentBlocks()) {
    const box = block.getBoundingClientRect()
    const away = clientY < box.top ? box.top - clientY
      : clientY > box.bottom ? clientY - box.bottom : 0
    if (away < nearest) {
      nearest = away
      best = block
    }
    if (away === 0) break
  }
  return best
}

let dragging = null

const clearDropMarks = () => {
  for (const el of content().querySelectorAll('.drop-above, .drop-below')) {
    el.classList.remove('drop-above', 'drop-below')
  }
}

/// Moves the block under the margin by one place, for people not using a mouse.
///
/// The same move the grip makes, reached the way the rest of the app is reached.
/// A drag is a gesture with no keyboard equivalent at all unless one is built,
/// and "reorder your document" is not a reasonable thing to need a pointer for.
function nudge(block, direction) {
  const unit = unitUnderPointer(block)
  if (!unit) return

  const units = documentBlocks().map(unitUnderPointer).filter(Boolean)

  // Nesting is the trap here, and it is worth reading neighbourUnit for why.
  const target = neighbourUnit(units, unit, direction)
  if (!target) return NSSoundBeep()

  const verdict = commitMove(unit, direction < 0 ? target.from : target.to)
  if (!verdict.ok) reportRefusal(verdict.reason)
}

/// There is no beep in a web view, and a silent nothing is indistinguishable
/// from a broken key. The margin flashes the block instead.
function NSSoundBeep() {
  const block = document.querySelector('.block-target')
  if (!block) return
  block.classList.add('block-refused')
  setTimeout(() => block.classList.remove('block-refused'), 300)
}

/// A refusal with nowhere to put itself. Moves have no box to write in the way
/// an editor does, so the message goes where the last one went — the status the
/// app already shows — rather than into an alert nobody asked for.
function reportRefusal(reason) {
  NSSoundBeep()
  bridge({ type: 'moveRefused', reason })
}

/// Deletes the block the margin controls are standing beside.
///
/// The block, not a selection: what the key acts on is the thing lit up on
/// screen, so there is never a question of what is about to go. If the pointer
/// is not beside anything, the key does what it has always done — nothing.
///
/// Guarded on where the keystroke came from, not on what it was. Delete inside
/// the source editor is deleting a character, delete inside the composer is
/// deleting a character, and a document-wide handler that did not check would
/// eat a paragraph while somebody was typing a note about it.
/// Alt and an arrow moves the block under the margin, one place at a time.
///
/// A drag has no keyboard equivalent unless one is built, and reordering a
/// document is not a reasonable thing to need a pointer for. Alt rather than a
/// bare arrow because the arrows already scroll the page, which is the more
/// common thing by a long way.
document.addEventListener('keydown', (event) => {
  if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
  if (event.metaKey || event.ctrlKey) return
  if (!editingAllowed() || editorIsOpen()) return

  const target = event.target
  if (target instanceof HTMLElement
      && (target.isContentEditable || target.closest('input, textarea'))) return

  const block = document.querySelector('.block-target')
  if (!block) return

  event.preventDefault()
  nudge(block, event.key === 'ArrowUp' ? -1 : 1)
})

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Backspace' && event.key !== 'Delete') return
  if (event.metaKey || event.ctrlKey || event.altKey) return
  if (!editingAllowed() || editorIsOpen()) return

  const target = event.target
  if (target instanceof HTMLElement
      && (target.isContentEditable || target.closest('input, textarea'))) return

  // A selection means the reader has words in mind, and the popover over them
  // is offering to comment on exactly those. Deleting the block under all that
  // would answer a question nobody asked.
  const selection = window.getSelection()
  if (selection && !selection.isCollapsed && selection.toString().trim()) return

  const block = document.querySelector('.block-target')
  if (!block) return

  const piece = segmentAt(block, lastPointerY)
  if (!piece) return

  event.preventDefault()
  bridge({ type: 'deleteBlock', from: piece.from, to: piece.to })
})

/// Checks an edit and, if it is safe, hands it to Swift to write.
///
/// Returns rather than throws, because the caller is a control in the page and
/// what it needs is something to say. Nothing is written until the whole
/// document has been spliced and re-parsed: an edit can split a paragraph in
/// two or promote a line to a heading, and boundaries never survive that.
export function commitSource(segment, text) {
  const after = spliceSegment(lastSource, segment, text)
  const verdict = validateCommit(lastSource, after, segment, text)
  if (!verdict.ok) return verdict

  // Unchanged is not an edit. Writing anyway would put a new timestamp on the
  // file, trip the watcher, and land an entry on the undo stack that undoes
  // nothing — three lies about a block somebody looked at and closed again.
  if (after === lastSource) return { ok: true, unchanged: true }

  bridge({ type: 'editSource', from: segment.from, to: segment.to, text })
  return { ok: true }
}

/* ------------------------------------------------------------- selection */

const lineRange = (el) => {
  const raw = el?.getAttribute?.('data-line')
  if (!raw) return null
  const [start, end] = raw.split(',').map(Number)
  return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null
}

function selectionInfo() {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null

  const text = selection.toString().trim()
  if (!text) return null

  const range = selection.getRangeAt(0)
  const root = content()
  if (!root.contains(range.commonAncestorContainer)) return null

  // Text inside a note is not document text: it has no line of its own, and
  // offering to comment on a comment is not a thing worth building.
  const within =
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement
  if (within?.closest('.note-card')) return null

  const rect = range.getBoundingClientRect()
  if (!rect.width && !rect.height) return null

  const start =
    range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer
      : range.startContainer.parentElement

  // Two ranges: the tightest element that knows its lines, and the top-level
  // block it belongs to. A comment is written after the block; the tighter one
  // is what a quote should be looked for in.
  let block = start
  while (block && block.parentElement !== root && block.parentElement) {
    // A commented block is wrapped, so the top-level element is one step
    // further out than it used to be.
    if (block.parentElement.classList.contains('note-holder')) break
    block = block.parentElement
  }

  return {
    type: 'selection',
    text,
    rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    inline: lineRange(start?.closest('[data-line]')),
    block: lineRange(block),
    // Which copy of these exact words inside the block this is. Written into
    // the note as nth= so two comments on the same word stay apart.
    occurrence: countBefore(block, range, text),
  }
}

/// How many times the selected text already appeared in this block before the
/// point where the selection starts, plus one.
function countBefore(block, range, text) {
  if (!block || !text) return 1
  const before = document.createRange()
  before.selectNodeContents(block)
  try {
    before.setEnd(range.startContainer, range.startOffset)
  } catch {
    return 1
  }
  return before.toString().split(text).length
}

/* ------------------------------------------------------ comment on a block */

/// The `+` in the margin. One button that follows the block under the pointer,
/// rather than one per paragraph: a document is thousands of blocks, and most
/// of them are never hovered.
///
/// It exists because commenting on a whole paragraph through a selection is
/// work pretending to be precision — you pick some words arbitrarily just to
/// have somewhere to hang the note. A block note has no `quote=` at all: the
/// note is written directly after the block, so its position already says which
/// one it is, and it can never come loose the way a quote can.
let plusButton = null
let plusTarget = null
/// Hiding is delayed, because the way to the button leads out of the text: the
/// pointer crosses the margin, which belongs to no block, and hiding on the
/// first frame outside meant the button vanished exactly as you reached for it.
let plusHideTimer = 0
/// Where the pointer last was, vertically. Read when the margin control is
/// pressed, to tell two pieces of one block apart.
let lastPointerY = 0

const cancelHide = () => clearTimeout(plusHideTimer)
const scheduleHide = () => {
  clearTimeout(plusHideTimer)
  plusHideTimer = setTimeout(hidePlus, 220)
}

/// The block on the same line as the pointer, whatever the pointer is actually
/// over. A reading column is centred and narrow, so most of the window beside a
/// paragraph belongs to nothing — and aiming at the words to reach a button
/// that lives in the margin is backwards.
///
/// Bounded rather than the whole width: the rails sit at the window edges and
/// have their own hover behaviour to answer for.
function blockAtHeight(clientX, clientY) {
  const root = content()
  const box = root.getBoundingClientRect()
  // Never into the outer strip, whatever the reach works out to: the rails live
  // there and answer to the pointer themselves. On a narrow window this is what
  // decides, and the reach never comes into it.
  const from = Math.max(box.left - PLUS_REACH, RAIL_GUTTER)
  const to = Math.min(box.right + PLUS_REACH, window.innerWidth - RAIL_GUTTER)
  if (clientX < from || clientX > to) return null
  for (const child of root.children) {
    if (!lineRange(child)) continue
    const rect = child.getBoundingClientRect()
    if (clientY >= rect.top && clientY <= rect.bottom) return child
  }
  return null
}

/// How far past the text column the `+` still answers, in points.
const PLUS_REACH = 120
/// And how much of each edge it never touches, because the rails are there.
const RAIL_GUTTER = 56

const topLevelBlock = (node) => {
  const root = content()
  let block = node
  while (block && block.parentElement !== root && block.parentElement) {
    if (block.parentElement.classList.contains('note-holder')) break
    block = block.parentElement
  }
  return block?.parentElement === root || block?.parentElement?.classList.contains('note-holder')
    ? block
    : null
}

/// The second button in the margin: the way into the block's markdown.
///
/// It travels with the `+` rather than living inside the block, and the two are
/// positioned from the same rectangle in the same call, which is the only way
/// they stay level. Parented to the block instead, it was measured from that
/// element's own left edge — 24px further right on a list item than on a
/// paragraph — and inside a `<table>` it was never painted at all, because an
/// absolutely positioned non-table child is folded into the anonymous table box
/// and dropped. Nothing about a table is special here now; it is just another
/// rectangle to sit beside.
let sourceButton = null
let gripButton = null

/// Six dots, the shape every draggable handle on every platform has been for
/// twenty years. Recognised without a label, which is the only reason a control
/// this small can carry a gesture at all.
const ICON_GRIP = '<svg viewBox="0 0 16 16" aria-hidden="true">'
  + [4, 8, 12].map((y) => `<circle cx="6" cy="${y}" r="1.15" fill="currentColor"/>`
    + `<circle cx="10" cy="${y}" r="1.15" fill="currentColor"/>`).join('')
  + '</svg>'
/// While an editor is open the margin stops offering another one. Two open at
/// once is two unsaved edits to the same file, and the second to be committed
/// would be spliced against lines the first had already moved.
///
/// Asked of the document rather than remembered in a variable, and that is the
/// whole point. A flag has to be cleared by whoever closes the editor — and the
/// commonest way an editor ends is not being closed at all: the edit is written,
/// Swift re-renders from the file, and the box goes out with the old DOM without
/// anything running. The flag stayed set, the margin stopped offering the
/// control, and the feature vanished for the rest of the session after the first
/// successful edit. Nothing to keep in step means nothing to leave stale.
const editorIsOpen = () => !!content().querySelector('.source-box')

/// Where the two margin buttons sit, as offsets from the block's left edge. The
/// `+` keeps the 34 it has always had; source sits outside it. Both are clamped
/// so a narrow window pushes them into the gutter rather than off the page.
/// Where the margin controls sit: one column, out from the block's left edge,
/// stacked in the order you meet them — comment, then source, then move.
///
/// One column rather than a row and a stack. The source control used to sit
/// outside the `+` and the grip under it, which put two of the three on one
/// line and the third below, and read as a control that had come loose rather
/// than a set of three.
const PLUS_OFFSET = 34
/// Each control is 22 tall; this is that plus the gap between them.
const STACK_STEP = 26

function hidePlus() {
  plusTarget?.classList.remove('block-target', 'block-armed')
  plusTarget = null
  if (plusButton) plusButton.style.display = 'none'
  if (sourceButton) sourceButton.style.display = 'none'
  if (gripButton) gripButton.style.display = 'none'
}

function showPlus(block) {
  if (!plusButton) return
  if (plusTarget === block) return
  plusTarget?.classList.remove('block-target', 'block-armed')
  plusTarget = block
  // Lit as soon as the button appears, not only once the pointer reaches it.
  // Waiting meant the highlight never showed at all if you never got there.
  block.classList.add('block-target')

  const rect = block.getBoundingClientRect()
  plusButton.style.display = 'flex'
  plusButton.style.top = `${rect.top + 1}px`
  plusButton.style.left = `${Math.max(4, rect.left - PLUS_OFFSET)}px`

  if (!sourceButton) return
  // Only where there is something to open. A block with no piece of its own —
  // the front matter card, which is drawn from the header and has no lines of
  // the document behind it — gets the `+` and not this.
  const piece = lastSegments.some(
    (segment) => segment.kind === 'content'
      && elementsFor(content(), segment).some((el) => block.contains(el))
  )
  const column = `${Math.max(4, rect.left - PLUS_OFFSET)}px`
  const editable = editingAllowed() && !editorIsOpen()

  sourceButton.style.display = piece && editable ? 'flex' : 'none'
  sourceButton.style.top = `${rect.top + 1 + STACK_STEP}px`
  sourceButton.style.left = column

  if (!gripButton) return
  gripButton.style.display = editable ? 'flex' : 'none'
  gripButton.style.top = `${rect.top + 1 + STACK_STEP * 2}px`
  gripButton.style.left = column
}

function setUpBlockPlus() {
  plusButton = document.createElement('button')
  plusButton.type = 'button'
  plusButton.className = 'block-plus'
  plusButton.textContent = '+'
  plusButton.setAttribute('aria-label', 'Comment on this block')
  plusButton.style.display = 'none'
  document.body.appendChild(plusButton)

  sourceButton = document.createElement('button')
  sourceButton.type = 'button'
  sourceButton.className = 'source-toggle'
  sourceButton.innerHTML = ICON_SOURCE
  sourceButton.title = 'Edit this block as markdown'
  sourceButton.setAttribute('aria-label', 'Edit this block as markdown')
  sourceButton.style.display = 'none'
  document.body.appendChild(sourceButton)

  for (const button of [plusButton, sourceButton]) {
    button.addEventListener('mouseenter', () => {
      cancelHide()
      plusTarget?.classList.add('block-armed')
    })
    button.addEventListener('mouseleave', () => {
      plusTarget?.classList.remove('block-armed')
      scheduleHide()
    })
  }

  gripButton = document.createElement('button')
  gripButton.type = 'button'
  gripButton.className = 'block-grip'
  gripButton.innerHTML = ICON_GRIP
  gripButton.title = 'Drag to move this block. Alt + up or down to move it by keyboard.'
  gripButton.setAttribute('aria-label', 'Move this block')
  // Only the grip. A draggable block steals every drag that starts inside it,
  // and a drag that starts inside a paragraph is somebody selecting the words
  // they want to comment on — which is the whole product.
  gripButton.draggable = true
  gripButton.style.display = 'none'
  document.body.appendChild(gripButton)

  for (const event of ['mouseenter', 'mouseleave']) {
    gripButton.addEventListener(event, () => {
      if (event === 'mouseenter') cancelHide()
      else scheduleHide()
      plusTarget?.classList.toggle('block-armed', event === 'mouseenter')
    })
  }

  gripButton.addEventListener('dragstart', (event) => {
    const block = plusTarget
    const unit = block && unitUnderPointer(block)
    if (!unit) return event.preventDefault()
    dragging = { unit, block }
    event.dataTransfer.effectAllowed = 'move'
    // Firefox and Safari both refuse to start a drag with nothing on it.
    event.dataTransfer.setData('text/plain', String(unit.from))
    event.dataTransfer.setDragImage(block, 12, 12)
    block.classList.add('is-moving')
  })

  gripButton.addEventListener('dragend', () => {
    dragging?.block.classList.remove('is-moving')
    dragging = null
    clearDropMarks()
  })

  // A drop only happens where dragover called preventDefault, and the first
  // version of this returned early three different ways before reaching it —
  // over a gap between two blocks, over a note card, over your own block. The
  // gaps are exactly where you aim when putting something between two things,
  // so the whole column flickered between live and dead as the pointer crossed
  // them. It worked often enough to look like bad luck rather than a rule.
  //
  // So the pointer no longer has to be inside anything. Anywhere over the
  // document is a drop, and the block it refers to is the nearest one
  // vertically — the same answer the `+` gives for the same reason.
  const dropTarget = (event) => {
    const block = blockNearest(event.clientY)
    if (!block) return null
    const box = block.getBoundingClientRect()
    const below = event.clientY > box.top + box.height / 2
    const landing = landingFor(block, below)
    return landing === null ? null : { block, below, landing }
  }

  for (const name of ['dragenter', 'dragover']) {
    content().addEventListener(name, (event) => {
      if (!dragging) return
      // Unconditionally, so the drop is never refused by the browser before it
      // reaches us. Whether it is a landing we will act on is our question, and
      // it is answered by whether a line is drawn.
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'

      const target = dropTarget(event)
      clearDropMarks()
      if (!target || !canLand(target.landing)) return
      target.block.classList.add(target.below ? 'drop-below' : 'drop-above')
    })
  }

  content().addEventListener('dragleave', (event) => {
    // Only when the pointer has actually left the document, not when it crosses
    // between two blocks inside it — dragleave fires on every boundary.
    if (dragging && !content().contains(event.relatedTarget)) clearDropMarks()
  })

  content().addEventListener('drop', (event) => {
    if (!dragging) return
    event.preventDefault()
    const target = dropTarget(event)
    clearDropMarks()
    // Dropped on itself, which is not a move. Nothing to say about it: the
    // absence of a line was already saying so.
    if (!target || !canLand(target.landing)) return

    const verdict = commitMove(dragging.unit, target.landing)
    if (!verdict.ok) reportRefusal(verdict.reason)
  })

  sourceButton.addEventListener('click', () => {
    const block = plusTarget
    if (!block || !editingAllowed() || editorIsOpen()) return
    const piece = segmentAt(block, lastPointerY)
    if (!piece) return

    const found = elementsFor(content(), piece)
    if (!found.length) return
    const anchor = found[0]
    const elements = withEmptyAncestors(found, block)

    hidePlus()
    openSourceEditor({
      segment: piece,
      hide: elements,
      label: 'Markdown source for this block',
      place: (box) => anchor.parentElement.insertBefore(box, anchor),
      sourceOf: (target) => textOf(lastSource, target),
      commit: commitSource,
      // The margin control follows the pointer and hides while this is open, so
      // the editor has to carry its own way back.
      showBack: true,
    })
  })

  plusButton.addEventListener('click', () => {
    const block = plusTarget
    const lines = lineRange(block)
    if (!block || !lines) return
    const rect = block.getBoundingClientRect()
    block.classList.add('block-target')
    // The same message a selection sends, with no text. Everything downstream
    // already carries the quote through as a string; empty means "the block".
    bridge({
      type: 'selection',
      text: '',
      rect: { x: rect.left, y: rect.top, width: rect.width, height: Math.min(rect.height, 24) },
      inline: lines,
      block: lines,
      occurrence: 1,
    })
  })

  document.addEventListener('mousemove', (event) => {
    // The Quick Look panel renders with the same bundle and cannot write to
    // anything. Existing notes still show — that is reading — but offering a
    // way to add one there is offering something that cannot happen.
    if (document.documentElement.dataset.preview === 'true') return hidePlus()
    if (event.target === plusButton || sourceButton?.contains(event.target)
        || gripButton?.contains(event.target)) return cancelHide()
    // Kept because the block under the pointer is not always one piece: a list
    // with a note written into it is two, and only the pointer can say which.
    lastPointerY = event.clientY
    // Not while a selection is live: the popover is already open on words the
    // reader chose, and a second way in would fight it.
    if (hadSelection) return hidePlus()
    // By line first, so the whole width of the reading area answers; the
    // element under the pointer only decides it when the two disagree, which
    // is inside a note card or a holder.
    const onText = content().contains(event.target) ? topLevelBlock(event.target) : null
    const block = onText ?? blockAtHeight(event.clientX, event.clientY)
    if (!block || !lineRange(block)) return scheduleHide()
    cancelHide()
    showPlus(block)
  })

  // Fixed positioning against a rect taken once — scrolling moves the block out
  // from under it, so it goes away and comes back on the next move.
  document.addEventListener('scroll', hidePlus, true)
}

function clearBlockTarget() {
  document.querySelectorAll('.block-target').forEach((el) => el.classList.remove('block-target'))
  hidePlus()
}

let selectionTimer = 0
let hadSelection = false

document.addEventListener('selectionchange', () => {
  clearTimeout(selectionTimer)
  // Debounced: a drag fires this on every pixel, and the popover should appear
  // when the hand stops, not chase it across the paragraph.
  selectionTimer = setTimeout(() => {
    const info = selectionInfo()
    if (info) {
      hadSelection = true
      bridge(info)
    } else if (hadSelection) {
      hadSelection = false
      bridge({ type: 'selectionCleared' })
    }
  }, 180)
})

/* ----------------------------------------------------------- link routing */

document.addEventListener('click', (event) => {
  const anchorEl = event.target.closest('a')
  if (!anchorEl) return

  const wiki = anchorEl.dataset.wikilink
  if (wiki) {
    event.preventDefault()
    bridge({ type: 'openWiki', target: wiki })
    return
  }

  const href = anchorEl.getAttribute('href') ?? ''
  if (href.startsWith('#')) {
    event.preventDefault()
    scrollToAnchor(href.slice(1))
    return
  }

  event.preventDefault()
  if (href.startsWith('margin://file')) {
    const path = decodeURIComponent(href.replace('margin://file', ''))
    bridge({ type: 'openLocal', path })
  } else if (isExternal(href)) {
    bridge({ type: 'openExternal', url: href })
  }
})

function scrollToAnchor(id) {
  const target = document.getElementById(id)
  if (!target) return
  glideTo(target.getBoundingClientRect().top + window.scrollY - 24)
}

/* ------------------------------------------------------------------ find */

let matches = []
let matchIndex = -1

function clearFind() {
  for (const hit of [...document.querySelectorAll('mark.find')]) {
    const parent = hit.parentNode
    if (!parent) continue
    parent.replaceChild(document.createTextNode(hit.textContent), hit)
    parent.normalize()
  }
  matches = []
  matchIndex = -1
}

function runFind(query) {
  clearFind()
  const needle = (query ?? '').toLowerCase()
  if (needle.length === 0) return report()

  const root = content()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT
      const tag = node.parentElement?.tagName
      return tag === 'SCRIPT' || tag === 'STYLE'
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT
    },
  })

  // Collected up front: splitting text nodes while walking invalidates it.
  const nodes = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node)

  for (const node of nodes) {
    const text = node.nodeValue
    const lower = text.toLowerCase()
    let at = lower.indexOf(needle)
    if (at < 0) continue

    const fragment = document.createDocumentFragment()
    let from = 0
    while (at >= 0) {
      fragment.appendChild(document.createTextNode(text.slice(from, at)))
      const hit = document.createElement('mark')
      hit.className = 'find'
      hit.textContent = text.slice(at, at + needle.length)
      fragment.appendChild(hit)
      matches.push(hit)
      from = at + needle.length
      at = lower.indexOf(needle, from)
    }
    fragment.appendChild(document.createTextNode(text.slice(from)))
    node.parentNode?.replaceChild(fragment, node)
  }

  if (matches.length) step(0)
  return report()
}

function step(delta) {
  if (!matches.length) return report()
  matches[matchIndex]?.classList.remove('is-active')
  matchIndex = (matchIndex + delta + matches.length) % matches.length
  if (matchIndex < 0) matchIndex = 0
  const hit = matches[matchIndex]
  hit.classList.add('is-active')
  hit.scrollIntoView({ block: 'center', behavior: 'smooth' })
  return report()
}

function report() {
  bridge({ type: 'find', count: matches.length, index: matches.length ? matchIndex + 1 : 0 })
}

/* ------------------------------------------------------------------- api */

window.imark = {
  render,
  scrollToAnchor,
  setTheme(theme) {
    document.documentElement.dataset.theme = theme
    const blocks = document.querySelectorAll('.mermaid-block')
    if (blocks.length) renderMermaid(content(), theme)
  },
  setWidth(width) {
    document.documentElement.dataset.width = width
  },
  setPreview(on) {
    document.documentElement.dataset.preview = on ? 'true' : 'false'
  },
  /// Whether the document may be changed in place. Turning it off closes
  /// anything already open: leaving an editor on screen that can no longer
  /// write would be a box that swallows what you type.
  setEditing(on) {
    document.documentElement.dataset.editing = on ? 'true' : 'false'
    if (!on) {
      for (const box of document.querySelectorAll('.source-box')) box.remove()
      for (const hidden of document.querySelectorAll('.is-source-hidden')) {
        hidden.classList.remove('is-source-hidden')
      }
      for (const lit of document.querySelectorAll('.note-action.is-on')) {
        lit.classList.remove('is-on')
      }
      hidePlus()
    }
  },
  setRail(side) {
    if (side) document.documentElement.dataset.rail = side
    else delete document.documentElement.dataset.rail
    buildRail(content())
    buildNoteRail()
  },
  find: runFind,
  findStep: step,
  findClear: clearFind,
  setTextScale(scale) {
    document.documentElement.style.setProperty('--size-body', `${scale}px`)
  },
  /// How much of the top of the page the toolbar is standing on. Everything
  /// pinned to the viewport has to start below it, not just the prose — a rail
  /// that runs to the top edge runs under the toolbar.
  setTopInset(points) {
    document.documentElement.style.setProperty('--top-inset', `${points}px`)
    buildNoteRail()
  },
  clearSelection() {
    window.getSelection()?.removeAllRanges()
    // The block lit up by the `+` is not a selection and would otherwise stay
    // lit after the popover closed.
    clearBlockTarget()
  },
  markMissing(targets) {
    const dead = new Set(targets)
    for (const link of document.querySelectorAll('a.wikilink')) {
      if (dead.has(link.dataset.wikilink)) link.dataset.missing = 'true'
    }
  },
  setReviewing(on) {
    applyReviewing(on)
    // The notes have to go with it. Announcing a count and no items left the
    // app believing the document had none: the status bar read zero, every
    // comment command greyed out, and the switch that had just been turned on
    // could not be turned off again.
    const items = attachedNotes()
    bridge({ type: 'comments', count: items.length, reviewing: on, items })
  },
  stepNote,
  editableSegments,
  commitSource,
  sourceOf: (segment) => textOf(lastSource, segment),
  exportComments: () => toVisibleText(lastSource),
  /// Opens the note that was just written, so a comment lands visibly rather
  /// than silently changing a file.
  revealNote(index) {
    const dots = [...document.querySelectorAll('.note-dot')]
    const dot = dots[index] ?? dots[dots.length - 1]
    if (!dot) return
    dot.scrollIntoView({ block: 'center', behavior: 'smooth' })
    dot.click()
  },
}

installCommentHandlers()
setUpBlockPlus()

// KaTeX is imported for its side-effect-free API; keep a reference so the
// bundler cannot tree-shake the font-bearing CSS away.
window.imark.katexVersion = katex.version

bridge({ type: 'ready' })
