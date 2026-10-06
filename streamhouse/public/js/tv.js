/* Ten-foot mode: makes the whole UI usable with a TV remote.
 *
 * Smart-TV browsers send the D-pad as ordinary arrow keys and OK as Enter, but
 * nothing moves focus on its own — the page has to work out which element sits
 * in the direction pressed. That is what this module does, plus the vendor
 * "back" key codes, which differ per platform.
 *
 * It also makes the page behave like a TV app rather than a web page:
 *
 * - a text box brings up the on-screen keyboard when OK is pressed on it, not
 *   whenever the highlight passes over it;
 * - a menu (<select>) opens as a list on the page, which the remote works like
 *   everything else;
 * - a row keeps its highlighted tile in place and slides under it, and the row
 *   with the remote on it sits near the top of the screen, as on Android TV;
 * - Back closes whatever is open before it leaves the page. The Android app
 *   asks the page first, through window.StreamHouseBack. */

import { h, esc } from './util.js'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

// What brings up the on-screen keyboard.
const TEXT_FIELD = ['input:not([type])', 'textarea',
  ...['text', 'search', 'email', 'password', 'number', 'url', 'tel'].map(type => `input[type="${type}"]`)].join(',')

// Vendor back buttons: Tizen (Samsung), webOS (LG), plus the usual keys.
const BACK_KEYS = new Set(['Backspace', 'Escape', 'BrowserBack', 'XF86Back', 'GoBack'])
const BACK_CODES = new Set([10009, 461, 166, 27, 8])

// Keep in step with the check at the top of index.html.
const TV_AGENTS = /tizen|web0s|webos|smart-?tv|smarttv|hbbtv|netcast|viera|bravia|aft[bmst]|android\s?tv|googletv|crkey|philipstv|netrange|dtv|roku/i
const PAGE_VIEWPORT = 'width=device-width, initial-scale=1, viewport-fit=cover'
const TV_VIEWPORT = 'width=1920'

// Where the row the remote is on sits: this far below the top of the screen.
const ROW_TOP = 40

const tvOn = () => document.documentElement.classList.contains('tv')

export function isTvDevice () {
  const params = new URLSearchParams(location.search)
  if (params.get('tv') === '1') return true
  if (params.get('tv') === '0') return false
  const stored = localStorage.getItem('sh-tv-mode')
  if (stored === 'on') return true
  if (stored === 'off') return false
  if (TV_AGENTS.test(navigator.userAgent)) return true
  // A big screen driven by something that is not a mouse is almost always a TV.
  return window.matchMedia?.('(min-width: 1600px) and (pointer: coarse)').matches === true
}

export function setTvMode (on) {
  localStorage.setItem('sh-tv-mode', on ? 'on' : 'off')
  applyTvMode(on)
  if (on) setTimeout(() => focusFirst(), 60)
}

function applyTvMode (on) {
  const was = tvOn()
  document.documentElement.classList.toggle('tv', on)
  // The canvas a TV draws the page on; see index.html.
  document.querySelector('meta[name="viewport"]')?.setAttribute('content', on ? TV_VIEWPORT : PAGE_VIEWPORT)
  document.querySelectorAll(TEXT_FIELD).forEach(on ? lock : release)
  if (on !== was) window.dispatchEvent(new CustomEvent('tvmodechange', { detail: on }))
}

/* --------------------------------------------------------- what can be focused */

// Somewhere the remote can stop: on screen, and not a link in a sentence — on
// a TV it is the tiles, buttons and boxes that count, and every such link has
// a button going to the same place.
function usable (el) {
  if (el.hidden || el.closest('[hidden]')) return false
  // A tile's × is not a stop on the way along a row — only on a tile armed by
  // holding OK, see below. Otherwise every other press would land on one.
  if (el.matches('.card .remove') && !el.closest('.card.armed')) return false
  const rect = el.getBoundingClientRect()
  if (rect.width < 4 || rect.height < 4) return false
  const style = getComputedStyle(el)
  if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return false
  return !(el.localName === 'a' && style.display === 'inline')
}

// What is open over the page — a dialog, the profile picker, the player — owns
// the remote while it is there.
function topLayer () {
  return [...document.querySelectorAll('.modal-backdrop')].pop() || document.querySelector('.who') || document.querySelector('.player-wrap')
}

function candidates () {
  return [...(topLayer() || document).querySelectorAll(FOCUSABLE)].filter(usable)
}

const inRail = el => Boolean(el?.closest?.('nav.rail'))
const isTextField = el => Boolean(el?.matches?.(TEXT_FIELD))
const editing = el => el?.dataset?.tvEditing === '1'

// Where an element sits on the page, in terms that survive the page being
// drawn again: which row and which tile in it, or else its place in the list.
function addressOf (el) {
  const view = document.getElementById('view')
  if (!view?.contains(el)) return null
  const shelf = el.closest('.shelf')
  if (shelf && el.matches('.card')) {
    return { shelf: [...view.querySelectorAll('.shelf')].indexOf(shelf), card: [...shelf.querySelectorAll('.card')].indexOf(el) }
  }
  return { index: [...view.querySelectorAll(FOCUSABLE)].indexOf(el) }
}

function elementAt (address) {
  const view = document.getElementById('view')
  const el = address.shelf != null
    ? view.querySelectorAll('.shelf')[address.shelf]?.querySelectorAll('.card')[address.card]
    : view.querySelectorAll(FOCUSABLE)[address.index]
  // A row still showing its placeholders has tiles that cannot take focus yet.
  return el && el.matches(FOCUSABLE) && usable(el) ? el : null
}

/* ------------------------------------------------------------------- moving */

/* Which element is next in a direction: Android's own rule (FocusFinder), so
 * the remote moves as it does in every other Android TV app. Something in line
 * with the highlight — its "beam" — wins; out of line, nearness in the
 * direction pressed counts thirteen times over nearness sideways, so down
 * goes to the next row even when that row's button is over at the right. */

const sidewaysKey = key => key === 'ArrowLeft' || key === 'ArrowRight'

// Lies that way: beyond the highlight's edge, or at least reaching further.
function isCandidate (key, from, rect) {
  switch (key) {
    case 'ArrowLeft': return (from.right > rect.right || from.left >= rect.right) && from.left > rect.left
    case 'ArrowRight': return (from.left < rect.left || from.right <= rect.left) && from.right < rect.right
    case 'ArrowUp': return (from.bottom > rect.bottom || from.top >= rect.bottom) && from.top > rect.top
    default: return (from.top < rect.top || from.bottom <= rect.top) && from.bottom < rect.bottom
  }
}

function inBeam (key, from, rect) {
  return sidewaysKey(key)
    ? rect.bottom > from.top && rect.top < from.bottom
    : rect.right > from.left && rect.left < from.right
}

function whollyBeyond (key, from, rect) {
  switch (key) {
    case 'ArrowLeft': return from.left >= rect.right
    case 'ArrowRight': return from.right <= rect.left
    case 'ArrowUp': return from.top >= rect.bottom
    default: return from.bottom <= rect.top
  }
}

// How far away, in the direction pressed: to the near edge, and to the far one.
function gap (key, from, rect) {
  switch (key) {
    case 'ArrowLeft': return Math.max(0, from.left - rect.right)
    case 'ArrowRight': return Math.max(0, rect.left - from.right)
    case 'ArrowUp': return Math.max(0, from.top - rect.bottom)
    default: return Math.max(0, rect.top - from.bottom)
  }
}

function reach (key, from, rect) {
  switch (key) {
    case 'ArrowLeft': return Math.max(1, from.left - rect.left)
    case 'ArrowRight': return Math.max(1, rect.right - from.right)
    case 'ArrowUp': return Math.max(1, from.top - rect.top)
    default: return Math.max(1, rect.bottom - from.bottom)
  }
}

function drift (key, from, rect) {
  return sidewaysKey(key)
    ? Math.abs(from.top + from.height / 2 - (rect.top + rect.height / 2))
    : Math.abs(from.left + from.width / 2 - (rect.left + rect.width / 2))
}

// `a` in the beam and `b` not: `a` wins, except that going up or down, `b`
// wins when it lies entirely nearer than `a` begins.
function beamBeats (key, from, a, b) {
  if (inBeam(key, from, b) || !inBeam(key, from, a)) return false
  if (!whollyBeyond(key, from, b) || sidewaysKey(key)) return true
  return gap(key, from, a) < reach(key, from, b)
}

const distance = (key, from, rect) => 13 * gap(key, from, rect) ** 2 + drift(key, from, rect) ** 2

function better (key, from, a, b) {
  if (beamBeats(key, from, a, b)) return true
  if (beamBeats(key, from, b, a)) return false
  return distance(key, from, a) < distance(key, from, b)
}

// The next element in the direction pressed. `allowed` narrows the choice.
function nearest (from, key, allowed = null) {
  const origin = from.getBoundingClientRect()
  // Left and right stay level, as on Android TV: at the end of a row nothing
  // happens, rather than a jump to whatever sits diagonally up or down the page.
  const level = sidewaysKey(key)
  let best = null
  let bestRect = null
  for (const el of candidates()) {
    if (el === from || (allowed && !allowed(el))) continue
    const rect = el.getBoundingClientRect()
    if (!isCandidate(key, origin, rect) || (level && !inBeam(key, origin, rect))) continue
    if (!best || better(key, origin, rect, bestRect)) {
      best = el
      bestRect = rect
    }
  }
  return best
}

// The last thing the remote was on in the page itself, to go back to from the menu.
let lastOnPage = null
// …and where that was, to find it again when the page draws that part afresh.
let lastAddress = null

// Into the menu from the page: onto the section you are in, as on Google TV.
function railEntry () {
  const items = [...document.querySelectorAll('nav.rail a.item, nav.rail .who-button')].filter(usable)
  return items.find(item => item.classList.contains('active')) || items[0] || null
}

// Where the remote starts on a page: its first control, but not a text box when
// there is anything else — a box is only ever passed over on the way in. The
// search page's own box, when its page has nothing yet.
function firstOnPage () {
  const all = candidates()
  const onPage = all.filter(el => el.closest('#view'))
  return onPage.find(el => !isTextField(el)) || onPage[0] || all.find(el => el.closest('.topbar')) || null
}

function target (from, key) {
  if (inRail(from)) {
    // Out of the menu: back to where you were on the page.
    if (key === 'ArrowRight') return (lastOnPage?.isConnected && usable(lastOnPage) && lastOnPage) || firstOnPage()
    // Up and down stay in the menu.
    return nearest(from, key, inRail)
  }
  if (sidewaysKey(key)) {
    // Along a row that slides, the next tile is the next one in it, however
    // far off screen it has slid — not the menu, which may be nearer on screen.
    const row = from.closest('.strip, .discover-filters .row')
    const along = (row && nearest(from, key, el => row.contains(el))) || nearest(from, key, el => !inRail(el))
    if (along) return along
    // Nothing further left on the page: into the menu.
    return key === 'ArrowLeft' && !topLayer() ? railEntry() : null
  }
  // Up and down never wander into the menu.
  return nearest(from, key, el => !inRail(el))
}

/* --------------------------------------------------------------- scrolling */

const motion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'

function scroller (el, axis) {
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node)
    if (!/(auto|scroll)/.test(axis === 'x' ? style.overflowX : style.overflowY)) continue
    if (axis === 'x' ? node.scrollWidth > node.clientWidth + 1 : node.scrollHeight > node.clientHeight + 1) return node
  }
  return null
}

// Brings the highlight into view the way Android TV does. Along a row the tile
// keeps to the row's left edge and the row slides under it; the row itself goes
// near the top of the screen, with the next one peeking up below. Anything else
// scrolls only once it gets near an edge, and then to the middle. `gentle` only
// scrolls what is wholly off screen: for where the remote lands on a new page,
// which should open at its top.
function reveal (el, { gentle = false } = {}) {
  const behavior = motion()
  const box = el.getBoundingClientRect()

  const row = scroller(el, 'x')
  if (row) {
    const frame = row.getBoundingClientRect()
    const style = getComputedStyle(row)
    const start = parseFloat(style.paddingLeft) || 0
    const end = parseFloat(style.paddingRight) || 0
    let left = null
    if (row.matches('.strip') && !gentle) left = row.scrollLeft + box.left - frame.left - start
    else if (box.left < frame.left + start) left = row.scrollLeft + box.left - frame.left - start
    else if (box.right > frame.right - end) left = row.scrollLeft + box.right - frame.right + end
    if (left !== null) row.scrollTo({ left: Math.max(0, left), behavior })
  }

  const page = scroller(el, 'y')
  if (!page) return
  const frame = page.getBoundingClientRect()
  const shelf = el.closest('.shelf')
  let top
  if (shelf && page.id === 'view' && !gentle) {
    top = page.scrollTop + shelf.getBoundingClientRect().top - frame.top - ROW_TOP
  } else {
    if (gentle && box.bottom > frame.top && box.top < frame.bottom) return
    const margin = Math.min(frame.height * 0.15, 140)
    if (box.top >= frame.top + margin && box.bottom <= frame.bottom - margin) return
    const offset = page.scrollTop + box.top - frame.top
    // Near the top of the page: all the way up, so its heading shows again.
    top = offset + box.height < frame.height * 0.6 ? 0 : offset - (frame.height - box.height) / 2
  }
  page.scrollTo({ top: Math.max(0, top), behavior })
}

/* -------------------------------------------------------------- text boxes */

// While the highlight only passes over a text box it is read-only, which keeps
// the on-screen keyboard down: on a TV it covers half the screen. OK on the box
// makes it editable. A box its page made read-only is left as it is.
function lock (field) {
  if (field.readOnly && field.dataset.tvLocked !== '1') return
  field.dataset.tvLocked = '1'
  delete field.dataset.tvEditing
  field.readOnly = true
}

function release (field) {
  if (field.dataset.tvLocked !== '1') return
  delete field.dataset.tvLocked
  delete field.dataset.tvEditing
  field.readOnly = false
}

let refocusing = false

// Android brings the keyboard up for a box focused on a key press, so the box
// is focused afresh once it can take typing.
function edit (field) {
  field.dataset.tvEditing = '1'
  field.readOnly = false
  if (!field.hasAttribute('enterkeyhint')) field.setAttribute('enterkeyhint', field.type === 'search' ? 'search' : 'done')
  refocusing = true
  field.blur()
  field.focus({ preventScroll: true })
  refocusing = false
  try {
    const end = field.value.length
    field.setSelectionRange(end, end)
  } catch { /* a number or email box has no cursor to place */ }
}

/* -------------------------------------------------------------------- menus */

// A <select>, the TV way: its choices as a list over the page, worked by the
// remote like everything else, instead of the system's own list.
function choose (select) {
  const title = select.getAttribute('aria-label') || select.closest('.setting')?.querySelector('.label b')?.textContent || 'Choose'
  const layer = h(`
    <div class="modal-backdrop tv-picker">
      <div class="modal" role="dialog" aria-label="${esc(title)}">
        <header><h2>${esc(title)}</h2></header>
        <div class="content" role="listbox"></div>
        <button type="button" data-act="cancel" hidden></button>
      </div>
    </div>`)
  const list = layer.querySelector('.content')
  const address = addressOf(select)
  const close = () => {
    layer.remove()
    if (select.isConnected) select.focus({ preventScroll: true })
  }
  ;[...select.options].forEach((option, index) => {
    const item = h(`<button type="button" class="tv-option" role="option" aria-selected="${index === select.selectedIndex}">${esc(option.textContent)}</button>`)
    item.disabled = option.disabled
    item.addEventListener('click', () => {
      close()
      if (index === select.selectedIndex) return
      select.selectedIndex = index
      select.dispatchEvent(new Event('input', { bubbles: true }))
      select.dispatchEvent(new Event('change', { bubbles: true }))
      // A page that drew its menus again: onto the new one.
      if (!select.isConnected) (address && elementAt(address))?.focus({ preventScroll: true })
    })
    list.append(item)
  })
  layer.querySelector('[data-act="cancel"]').addEventListener('click', close)
  layer.addEventListener('click', event => { if (event.target === layer) close() })
  document.getElementById('modal-root').append(layer)
  const current = list.children[select.selectedIndex] || list.querySelector('.tv-option:not([disabled])')
  if (current) {
    current.focus({ preventScroll: true })
    reveal(current)
  }
}

/* --------------------------------------------------------------------- Back */

// Whatever is open closes first — a dialog, a menu's list, the profile picker,
// a tile's × — then the menu hands back to the page. True when that took the
// press; otherwise Back leaves the page.
function handleBack () {
  const active = document.activeElement
  // Done typing. The keyboard's own Back has put it away already, so this
  // press goes on to leave the page.
  if (isTextField(active) && editing(active)) lock(active)
  const dialog = [...document.querySelectorAll('.modal-backdrop')].pop()
  if (dialog) {
    const cancel = dialog.querySelector('[data-act="cancel"]')
    if (cancel) cancel.click()
    else dialog.remove()
    return true
  }
  const who = document.querySelector('.who')
  if (who) {
    if (who.dataset.cancellable !== 'true') return false
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    return true
  }
  const armed = document.querySelector('.card.armed')
  if (armed) {
    armed.classList.remove('armed')
    armed.focus({ preventScroll: true })
    return true
  }
  if (tvOn() && inRail(active)) {
    const back = (lastOnPage?.isConnected && usable(lastOnPage) && lastOnPage) || firstOnPage()
    if (back) {
      back.focus({ preventScroll: true })
      reveal(back, { gentle: true })
      return true
    }
  }
  return false
}

/* -------------------------------------------------------------------- keys */

let pendingClick = null

function onKeyDown (event) {
  // Only real presses: handleBack sends the profile picker a pretend Escape.
  if (!tvOn() || !event.isTrusted) return

  const key = event.key
  const code = event.keyCode
  const active = document.activeElement && document.activeElement !== document.body
    ? document.activeElement
    : null

  if (BACK_KEYS.has(key) || BACK_CODES.has(code)) {
    // Backspace deletes, in a box being typed in.
    if ((key === 'Backspace' || code === 8) && editing(active)) return
    event.preventDefault()
    if (!handleBack()) history.back()
    return
  }

  if (active && isTextField(active) && active.dataset.tvLocked === '1') {
    if (key === 'Enter') {
      if (!editing(active)) {
        // Only to start typing: the box's own Enter (install, add) is not pressed.
        event.preventDefault()
        event.stopPropagation()
        if (!event.repeat) edit(active)
        return
      }
      // OK, or the keyboard's own Done: the box does what Enter does there —
      // saves the setting, runs the search — then the keyboard goes away.
      if (!active.matches('textarea')) setTimeout(() => { if (editing(active)) lock(active) }, 0)
      return
    }
    // Typing on a keyboard, or a remote's number keys, starts typing.
    if (!editing(active) && key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      edit(active)
      return
    }
  }

  if (key === 'Enter' && active) {
    if (isTextField(active)) return
    // OK on a menu opens its list.
    if (active.matches('select')) {
      event.preventDefault()
      if (!event.repeat) choose(active)
      return
    }
    event.preventDefault()
    // Held down, OK repeats: one press is one click, never a burst of them.
    if (event.repeat) {
      // Held on a tile that can be removed: arm it, as holding OK on a
      // Netflix tile brings up its options. Its × takes the focus.
      if (active.matches('.card') && active.querySelector('.remove') && !active.classList.contains('armed')) {
        pendingClick = null
        active.classList.add('armed')
        active.querySelector('.remove').focus({ preventScroll: true })
      }
      return
    }
    // Acted on when released, so a hold can become the arm above instead.
    pendingClick = active
    return
  }

  if (!key?.startsWith('Arrow')) return
  if (event.target.matches?.('input[type="range"]')) return
  const sideways = key === 'ArrowLeft' || key === 'ArrowRight'
  // A box being typed in keeps left and right for its cursor — until the
  // cursor is at that end of the text, when the arrow moves on.
  if (isTextField(active) && !active.readOnly) {
    if (!sideways && active.matches('textarea')) return
    if (sideways) {
      let atEdge = true
      try {
        const end = active.value.length
        atEdge = active.selectionStart === active.selectionEnd &&
          (key === 'ArrowRight' ? active.selectionStart >= end : active.selectionStart <= 0)
      } catch { /* a field with no cursor, such as a number: always moves on */ }
      if (!atEdge) return
    }
  }
  // A closed menu does not keep the arrows either: on a TV, up and down moving
  // the choice meant a setting changed — and saved — just by passing it.

  // In the player, left/right belong to seeking — the player handles those.
  // …except inside one of its panels (subtitles, sleep timer), where they move
  // between the choices like anywhere else.
  const inPlayer = Boolean(document.querySelector('.player-wrap'))
  const inPanel = Boolean(event.target.closest?.('.sub-panel, .sleep-card, .shortcuts'))
  if (inPlayer && !inPanel && sideways) return

  if (!active) {
    event.preventDefault()
    focusFirst()
    return
  }

  const next = target(active, key)
  // Nothing that way. A row simply ends; up and down may still scroll a long page.
  if (!next) {
    if (sideways) event.preventDefault()
    return
  }
  event.preventDefault()
  next.focus({ preventScroll: true })
  reveal(next)
}

function onKeyUp (event) {
  if (!tvOn() || event.key !== 'Enter') return
  const target = pendingClick
  pendingClick = null
  if (target && target === document.activeElement) target.click()
}

/* ------------------------------------------------------------ landing focus */

// A new page: the remote goes back to the tile it left from, as on Netflix, or
// onto the page's first control once there is one — never into the menu, nor
// the search box, while the page is still on its way.
let routing = false

function land ({ restore = null } = {}) {
  routing = true
  const started = Date.now()
  const attempt = () => {
    if (!tvOn()) return (routing = false)
    const active = document.activeElement
    // Something has the remote already: the page chose, or the user moved.
    if (active && active !== document.body && usable(active) && !inRail(active)) return (routing = false)
    const waited = Date.now() - started
    const spot = restore && elementAt(restore)
    if (spot) {
      spot.focus({ preventScroll: true })
      reveal(spot)
      return (routing = false)
    }
    // Rows fill in after the page does: give the tile it left from a moment to exist.
    if (restore && waited < 3000) return setTimeout(attempt, 120)
    const first = topLayer() ? candidates()[0] : firstOnPage()
    if (first) {
      first.focus({ preventScroll: true })
      reveal(first, { gentle: true })
      return (routing = false)
    }
    if (waited < 8000) return setTimeout(attempt, 120)
    routing = false
    if (!document.activeElement || document.activeElement === document.body) railEntry()?.focus({ preventScroll: true })
  }
  setTimeout(attempt, 60)
}

export function focusFirst () {
  const first = topLayer() ? candidates()[0] : firstOnPage()
  if (!first) return land()
  first.focus({ preventScroll: true })
  reveal(first, { gentle: true })
}

// The remote never drops off the page. When what it was on goes — the
// downloads list is drawn afresh every second, a row of chips once one is
// picked, a dialog closes — it lands on whatever took its place, or back on
// what opened the dialog. A dialog, when it opens, takes the remote: onto its
// Cancel when saying yes would delete something.
let opener = null

function keepFocus () {
  if (!tvOn() || routing) return
  const active = document.activeElement
  const dialog = [...document.querySelectorAll('.modal-backdrop')].pop()
  if (dialog) {
    if (dialog.contains(active)) return
    if (active && active !== document.body) opener = active
    const start = (dialog.querySelector('[data-act="ok"].danger') && dialog.querySelector('[data-act="cancel"]:not([hidden])')) ||
      dialog.querySelector('[data-act="ok"]') || [...dialog.querySelectorAll(FOCUSABLE)].find(usable)
    start?.focus({ preventScroll: true })
    return
  }
  if (active && active !== document.body && active.isConnected) return
  if (document.querySelector('.who, .player-wrap')) return
  const back = (opener?.isConnected && usable(opener) && opener) || (lastAddress && elementAt(lastAddress))
  opener = null
  back?.focus({ preventScroll: true })
}

/* --------------------------------------------------------------------- setup */

export function initTvMode () {
  if (isTvDevice() && !tvOn()) applyTvMode(true)
  if (tvOn()) document.querySelectorAll(TEXT_FIELD).forEach(lock)

  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('keyup', onKeyUp, true)

  // The Android app's Back asks here first; see MainActivity.
  window.StreamHouseBack = handleBack

  document.addEventListener('focusin', event => {
    if (!tvOn()) return
    const el = event.target
    if (isTextField(el) && !editing(el)) lock(el)
    // Moving off an armed tile puts its × away again.
    for (const card of document.querySelectorAll('.card.armed')) {
      if (!card.contains(el)) card.classList.remove('armed')
    }
    // Into a dialog: what it came from is where the remote goes back to.
    if (el.closest('.modal-backdrop') && event.relatedTarget && !event.relatedTarget.closest('.modal-backdrop')) opener = event.relatedTarget
    const focus = addressOf(el)
    if (!focus) return
    lastOnPage = el
    lastAddress = focus
    // Back to this page puts the remote on this tile again.
    history.replaceState({ ...history.state, focus }, '')
  })
  document.addEventListener('focusout', event => {
    if (refocusing || !tvOn()) return
    if (isTextField(event.target) && editing(event.target)) lock(event.target)
  })

  // Boxes are read-only from the moment they appear, before anything can
  // focus them; and the remote keeps its place as the page changes.
  new MutationObserver(records => {
    if (!tvOn()) return
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue
        if (node.matches(TEXT_FIELD)) lock(node)
        node.querySelectorAll(TEXT_FIELD).forEach(lock)
      }
    }
    keepFocus()
  }).observe(document.body, { childList: true, subtree: true })

  // The menu's sections are places, not pages in a history: from one to
  // another, Back goes Home (and from Home, out), as in a TV app — not back
  // through every section visited on the way.
  document.querySelector('nav.rail')?.addEventListener('click', event => {
    if (!tvOn()) return
    const item = event.target.closest('a.item[href]')
    const section = location.hash.slice(2).split(/[/?]/)[0] || 'board'
    if (!item || section === 'board' || location.hash === item.getAttribute('href')) return
    event.preventDefault()
    location.replace(item.getAttribute('href'))
  })

  window.addEventListener('hashchange', () => {
    if (!tvOn()) return
    lastAddress = null
    land({ restore: history.state?.focus || null })
  })

  // The first page, too, starts with something focused.
  if (tvOn()) land()

  // Media keys on the remote, when a TV browser forwards them.
  window.addEventListener('keydown', event => {
    const video = document.querySelector('.player-wrap video')
    if (!video) return
    switch (event.keyCode) {
      case 415: video.play(); break                              // Play
      case 19: case 413: video.pause(); break                    // Pause / Stop
      case 179: video.paused ? video.play() : video.pause(); break
      case 417: video.currentTime += 30; break                   // Fast forward
      case 412: video.currentTime -= 10; break                   // Rewind
      default: return
    }
    event.preventDefault()
  })
}
