// Opening one block as its own markdown, and putting it back.
//
// The point of the feature is that fixing a typo costs a keystroke instead of
// opening the whole file in an editor and losing your place. Everything here
// follows from that: the control is small, it is attached to the block it acts
// on, and closing it is one key.
//
// Two rules are worth stating because breaking either is easy and quiet.
//
// The control is a button of its own, sitting beside the block — never the
// block itself, and never a gesture on it. Selection is the whole product in
// this app: it is how a comment finds the words it is about, and anything that
// captures a drag over prose takes that away. Nothing here is draggable.
//
// A block is hidden with `display: none`, not the `hidden` attribute. `hidden`
// is the lowest-specificity rule there is and loses to any author rule that
// sets `display` — which the stylesheet does, for nearly every block in a
// document. It fails by leaving the element visible, or worse, invisible and
// still taking clicks.

const ICON_SOURCE
  = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" '
  + 'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" '
  + 'd="M6 4 2.5 8 6 12M10 4l3.5 4-3.5 4"/></svg>'

const ICON_RENDERED
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
function elementsFor(root, segment) {
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

/// Attaches a way into the source of every piece of the document.
///
/// `commit` hands back `{ ok }` or `{ ok: false, reason }`. A refusal keeps the
/// editor open with the reason under it: the text somebody just typed is the
/// only copy of it, and closing the box would throw it away to make room for a
/// message about why it could not be saved.
export function installSourceEditors(root, { segments, sourceOf, commit }) {
  for (const segment of segments) {
    if (segment.kind !== 'content') continue

    const elements = elementsFor(root, segment)
    if (!elements.length) continue

    const anchor = elements[0]
    anchor.classList.add('has-source-toggle')

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'source-toggle'
    button.innerHTML = ICON_SOURCE
    // Both of these say which way it goes. "Source" on its own names where you
    // would end up and not whether you are going there or coming back, which is
    // the one thing somebody looking at a lit-up button needs to know.
    button.title = 'Edit this block as markdown'
    button.setAttribute('aria-label', 'Edit this block as markdown')
    anchor.appendChild(button)

    // One handler that knows which way it is going. Two — an opener bound once
    // and a closer assigned later — both fire on the same press, so the block
    // opened and shut again in a single click and looked like a dead button.
    const state = { close: null }
    button.addEventListener('click', () => {
      if (state.close) state.close()
      else state.close = open(segment, elements, anchor, button, state)
    })
  }

  function open(segment, elements, anchor, button, state) {
    const box = document.createElement('div')
    box.className = 'source-box'

    const area = document.createElement('textarea')
    area.className = 'source-text'
    area.value = sourceOf(segment)
    area.rows = Math.max(2, area.value.split('\n').length + 1)
    area.setAttribute('aria-label', 'Markdown source for this block')
    area.spellcheck = false

    const message = document.createElement('p')
    message.className = 'source-error'
    message.hidden = true
    // `hidden` is honoured here only because nothing sets `display` on this
    // element. Everywhere a document's own blocks are hidden, below, it is
    // display:none — see the note at the top of this file.
    message.setAttribute('role', 'alert')

    box.append(area, message)
    anchor.parentElement.insertBefore(box, anchor)
    for (const element of elements) element.classList.add('is-source-hidden')

    button.classList.add('is-on')
    button.innerHTML = ICON_RENDERED
    button.title = 'Back to the rendered block'
    button.setAttribute('aria-label', 'Back to the rendered block')
    // Moved onto the editor so it is still there, and still says which way it
    // goes, while the block it belongs to is out of sight.
    box.appendChild(button)

    let closing = false
    const close = () => {
      if (closing) return
      closing = true
      state.close = null
      box.remove()
      for (const element of elements) element.classList.remove('is-source-hidden')
      anchor.appendChild(button)
      button.classList.remove('is-on')
      button.innerHTML = ICON_SOURCE
      button.title = 'Edit this block as markdown'
      button.setAttribute('aria-label', 'Edit this block as markdown')
      button.focus()
    }

    const save = () => {
      if (closing) return
      const verdict = commit(segment, area.value)
      if (verdict.ok) {
        // A change re-renders the whole document from the file a moment later,
        // which takes this editor with it. An unchanged block never went to
        // disk, so it has to put itself away.
        if (verdict.unchanged) close()
        return
      }
      message.textContent = verdict.reason
      message.hidden = false
      area.focus()
    }

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
    // Clicking away saves, the way every inline edit in a document does — but
    // not onto the button that closes it, which would save and then close and
    // read as the same press doing two things.
    area.addEventListener('blur', (event) => {
      if (box.contains(event.relatedTarget)) return
      save()
    })

    area.focus()
    return close
  }
}
