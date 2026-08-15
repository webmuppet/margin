// Opening one block as its own markdown, and putting it back.
//
// The point of the feature is that fixing a typo costs a keystroke instead of
// opening the whole file in an editor and losing your place. Everything here
// follows from that: the control is small, it sits beside the block it acts on,
// and closing it is one key.
//
// Three rules are worth stating because breaking any of them is easy and quiet.
//
// The control is a button of its own, sitting beside the block — never the
// block itself, and never a gesture on it. Selection is the whole product in
// this app: it is how a comment finds the words it is about, and anything that
// captures a drag over prose takes that away. Nothing here is draggable.
//
// The button does not live inside the block it acts on. It floats in the
// margin, positioned from the block's rectangle, exactly the way the `+` does —
// and for two reasons that only showed up in a browser. A button parented to
// the block is positioned from *that* element's left edge, so it sat 24px
// further right on a list item than on a paragraph and the margin looked
// ragged. And a `position: absolute` child of a `<table>` is folded into the
// anonymous table box and never painted at all: correct rectangle, opacity 1,
// nothing on screen and nothing to click. Tables had no way in whatsoever.
//
// A block is hidden with `display: none`, not the `hidden` attribute. `hidden`
// is the lowest-specificity rule there is and loses to any author rule that
// sets `display` — which the stylesheet does, for nearly every block in a
// document. It fails by leaving the element visible, or worse, invisible and
// still taking clicks.

export const ICON_SOURCE
  = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" '
  + 'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" '
  + 'd="M6 4 2.5 8 6 12M10 4l3.5 4-3.5 4"/></svg>'

export const ICON_RENDERED
  = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" '
  + 'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" '
  + 'd="M1.5 8S3.9 3.5 8 3.5 14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z"/>'
  + '<circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>'

const range = (el) => {
  const raw = el.getAttribute('data-line')
  if (!raw) return null
  const [from, to] = raw.split(',').map(Number)
  return Number.isFinite(from) && Number.isFinite(to) ? [from, to] : null
}

/// The elements that stand for a piece of the file, outermost first.
///
/// Usually one: a paragraph is a `<p>` whose lines are exactly the piece's. A
/// list with a note written into the middle of it is the case that needs more
/// than one — markdown-it renders a single `<ul>` spanning the note as well, so
/// the piece before the note is a couple of `<li>`s rather than anything with a
/// tag of its own. Taking the outermost elements that fit inside the piece
/// gives the right answer for both without a special case for either.
export function elementsFor(root, segment) {
  const inside = []
  const walk = (parent) => {
    for (const child of parent.children) {
      const lines = range(child)
      if (lines && lines[0] >= segment.from && lines[1] <= segment.to) {
        inside.push(child)
        continue
      }
      walk(child)
    }
  }
  walk(root)
  return inside
}

/// The elements to hide, plus any container they leave standing empty.
///
/// A list item whose note sits inside it spans the note's lines too, so the
/// piece being edited matches the paragraph inside the `<li>` and not the `<li>`
/// itself. Hiding just the paragraph takes the words away and leaves the bullet
/// behind: an empty marker floating between the editor and the next item, which
/// reads as a rendering fault. Anything left with no visible content of its own
/// goes with it, up to but never past the block.
export function withEmptyAncestors(elements, boundary) {
  const all = new Set(elements)

  const blank = (element) => {
    for (const child of element.childNodes) {
      if (child.nodeType === Node.TEXT_NODE && child.textContent.trim()) return false
      if (child.nodeType === Node.ELEMENT_NODE && !all.has(child)) return false
    }
    return true
  }

  for (const element of elements) {
    let parent = element.parentElement
    while (parent && parent !== boundary && boundary.contains(parent) && blank(parent)) {
      all.add(parent)
      parent = parent.parentElement
    }
  }
  return [...all]
}

/// Opens one piece of the file as text, and puts it away again.
///
/// Shared by the two ways in, because they differ only in what gets hidden and
/// where the box goes. A block hides itself and the box takes its place in the
/// document. A note hides the card's rendering of it — the byline, the orphan
/// warning, the text — and the box goes inside the card, so what you are
/// editing stays where you were reading it.
///
/// `commit` hands back `{ ok }` or `{ ok: false, reason }`. A refusal keeps the
/// editor open with the reason under it: the text somebody just typed is the
/// only copy of it, and closing the box would throw it away to make room for a
/// message about why it could not be saved.
export function openSourceEditor({
  segment, hide, place, label, sourceOf, commit, onClosed, showBack = false,
}) {
  const box = document.createElement('div')
  box.className = 'source-box'

  const area = document.createElement('textarea')
  area.className = 'source-text'
  area.value = sourceOf(segment)
  area.rows = 2
  area.setAttribute('aria-label', label)
  area.spellcheck = false

  // Sized to what is in it, measured rather than counted. Counting newlines is
  // right in the document's own column and wrong inside a note card, which is a
  // third of the width: three lines of marker wrap to six and the box opened
  // already scrolled, hiding the closing `-->` — the one line somebody editing
  // a note most needs to see.
  const fit = () => {
    area.style.height = 'auto'
    // scrollHeight is the content and its padding; under border-box the height
    // has to carry the borders as well. Left out, every editor opens two pixels
    // short and the last line is clipped just enough to look like a rendering
    // fault rather than a measurement one.
    const borders = area.offsetHeight - area.clientHeight
    area.style.height = `${area.scrollHeight + borders}px`
  }
  area.addEventListener('input', fit)

  const message = document.createElement('p')
  message.className = 'source-error'
  message.hidden = true
  // `hidden` is honoured on this one because nothing sets `display` on it. What
  // hides a document's own blocks is a class, for the reason at the top.
  message.setAttribute('role', 'alert')

  box.append(area, message)

  // The way back out, for the ways in that do not keep one of their own.
  //
  // The margin control cannot be it: it follows the block under the pointer,
  // and the block it belongs to is the one thing on screen that is no longer
  // there. So it hides while an editor is open, and without this the only way
  // back would be a key nobody was told about. A note's card keeps its own lit
  // control and passes showBack: false.
  let back = null
  if (showBack) {
    back = document.createElement('button')
    back.type = 'button'
    back.className = 'source-back'
    back.innerHTML = `${ICON_RENDERED}<span>Done</span>`
    back.title = 'Back to the rendered block'
    back.setAttribute('aria-label', 'Back to the rendered block')
    box.appendChild(back)
  }

  place(box)
  for (const element of hide) element.classList.add('is-source-hidden')
  // After it is in the document and after the block it replaces is out of the
  // way: scrollHeight is zero for an element with no layout, and measuring
  // before either would size every editor to nothing.
  fit()

  let closing = false
  const close = () => {
    if (closing) return
    closing = true
    box.remove()
    for (const element of hide) element.classList.remove('is-source-hidden')
    onClosed?.()
  }

  /// True if the edit was accepted. Callers need the answer: a refusal has to
  /// leave the editor open, because what was typed is the only copy of it.
  const save = () => {
    if (closing) return true
    const verdict = commit(segment, area.value)
    if (verdict.ok) {
      // A change re-renders the whole document from the file a moment later,
      // which takes this editor with it. An unchanged piece never went to disk,
      // so it has to put itself away.
      if (verdict.unchanged) close()
      return true
    }
    message.textContent = verdict.reason
    message.hidden = false
    area.focus()
    return false
  }

  // Saves on the way out, the same as clicking anywhere else away from the box.
  // A button that discarded what you had typed while every other way of leaving
  // kept it would be the one that lost somebody's work.
  back?.addEventListener('click', () => {
    // Only if it was accepted. Closing over a refusal would throw away what
    // somebody typed and leave the message about why on screen for a moment,
    // attached to nothing.
    if (save()) close()
  })

  area.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      save()
    }
  })
  // Clicking away saves, the way every inline edit in a document does — but not
  // onto a control inside the editor, which would save and then act and read as
  // one press doing two things.
  area.addEventListener('blur', (event) => {
    if (box.contains(event.relatedTarget)) return
    save()
  })

  area.focus()
  return close
}

