/* Ten-foot mode: makes the whole UI usable with a TV remote.
 *
 * Smart-TV browsers send the D-pad as ordinary arrow keys and OK as Enter, but
 * nothing moves focus on its own — the page has to work out which element sits
 * in the direction pressed. That is what this module does, plus the vendor
 * "back" key codes, which differ per platform. */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

// Vendor back buttons: Tizen (Samsung), webOS (LG), plus the usual keys.
const BACK_KEYS = new Set(['Backspace', 'Escape', 'BrowserBack', 'XF86Back', 'GoBack'])
const BACK_CODES = new Set([10009, 461, 166, 27, 8])

const TV_AGENTS = /tizen|web0s|webos|smart-?tv|smarttv|hbbtv|netcast|viera|bravia|aft[bmst]|android\s?tv|googletv|crkey|philipstv|netrange|dtv|roku/i

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
  document.documentElement.classList.toggle('tv', on)
  if (on) setTimeout(() => focusFirst(), 60)
}

function visible (el) {
  if (el.hidden || el.closest('[hidden]')) return false
  const rect = el.getBoundingClientRect()
  if (rect.width < 4 || rect.height < 4) return false
  const style = getComputedStyle(el)
  return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0'
}

function candidates () {
  // A modal owns the focus while it is open.
  const scope = document.querySelector('.modal-backdrop') || document.querySelector('.player-wrap') || document
  // A tile's × is not a stop on the way along a row — only on a tile armed by
  // holding OK, see below. Otherwise every other press would land on one.
  return [...scope.querySelectorAll(FOCUSABLE)]
    .filter(el => !el.matches('.card .remove') || el.closest('.card.armed'))
    .filter(visible)
}

function centre (el) {
  const rect = el.getBoundingClientRect()
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, rect }
}

// Pick the nearest element in the pressed direction: distance along the axis of
// travel, plus a penalty for drifting sideways, so a grid steps row by row.
function nearest (from, direction) {
  const origin = centre(from)
  let best = null
  let bestScore = Infinity

  for (const el of candidates()) {
    if (el === from) continue
    const target = centre(el)
    const dx = target.x - origin.x
    const dy = target.y - origin.y

    let along
    let across
    if (direction === 'ArrowLeft') { along = -dx; across = Math.abs(dy) }
    else if (direction === 'ArrowRight') { along = dx; across = Math.abs(dy) }
    else if (direction === 'ArrowUp') { along = -dy; across = Math.abs(dx) }
    else { along = dy; across = Math.abs(dx) }

    if (along <= 6) continue                       // not in that direction
    // Overlapping on the cross axis means "same row/column" — strongly preferred.
    const overlaps = direction === 'ArrowLeft' || direction === 'ArrowRight'
      ? origin.rect.bottom > target.rect.top + 4 && origin.rect.top < target.rect.bottom - 4
      : origin.rect.right > target.rect.left + 4 && origin.rect.left < target.rect.right - 4

    // Left and right stay in the row, as on Android TV: at the end of a row
    // nothing happens, rather than a jump to whatever sits diagonally.
    if (!overlaps && (direction === 'ArrowLeft' || direction === 'ArrowRight') && from.closest('.strip, .grid')) continue
    const score = along + across * (overlaps ? 0.1 : 3)
    if (score < bestScore) {
      bestScore = score
      best = el
    }
  }
  return best
}

export function focusFirst () {
  // The page itself first — the billboard's Play, a title's big button — not
  // the search box above it.
  const all = candidates()
  const first = all.find(el => el.closest('#view')) || all.find(el => !el.closest('nav.rail')) || all[0]
  first?.focus({ preventScroll: true })
  if (first) scrollIntoView(first)
}

function scrollIntoView (el) {
  el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
}

function onKeyDown (event) {
  if (!document.documentElement.classList.contains('tv')) return

  const key = event.key
  const code = event.keyCode

  if (BACK_KEYS.has(key) || BACK_CODES.has(code)) {
    const modal = document.querySelector('.modal-backdrop')
    if (modal) {
      event.preventDefault()
      const cancel = modal.querySelector('[data-act="cancel"]')
      if (cancel) cancel.click()
      else modal.remove()
      return
    }
    // Let a text field keep Backspace for editing.
    if (key === 'Backspace' && event.target.matches('input, textarea')) return
    event.preventDefault()
    history.back()
    return
  }

  if (key === 'Enter' && document.activeElement && document.activeElement !== document.body) {
    const active = document.activeElement
    if (active.matches('input, textarea, select')) return
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
  if (event.target.matches('input[type="range"], select, textarea')) return
  if (event.target.matches('input') && (key === 'ArrowLeft' || key === 'ArrowRight')) return

  // In the player, left/right belong to seeking — the player handles those.
  const inPlayer = Boolean(document.querySelector('.player-wrap'))
  if (inPlayer && (key === 'ArrowLeft' || key === 'ArrowRight')) return

  const active = document.activeElement && document.activeElement !== document.body
    ? document.activeElement
    : null
  if (!active) {
    event.preventDefault()
    focusFirst()
    return
  }

  const next = nearest(active, key)
  if (!next) return
  event.preventDefault()
  next.focus({ preventScroll: true })
  scrollIntoView(next)
}

let pendingClick = null

function onKeyUp (event) {
  if (!document.documentElement.classList.contains('tv') || event.key !== 'Enter') return
  const target = pendingClick
  pendingClick = null
  if (target && target === document.activeElement) target.click()
}

export function initTvMode () {
  if (isTvDevice()) document.documentElement.classList.add('tv')
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('keyup', onKeyUp, true)
  // Moving off an armed tile puts its × away again.
  document.addEventListener('focusin', event => {
    for (const card of document.querySelectorAll('.card.armed')) {
      if (!card.contains(event.target)) card.classList.remove('armed')
    }
  })
  // The first page, too, starts with something focused.
  setTimeout(() => {
    if (!document.documentElement.classList.contains('tv')) return
    const active = document.activeElement
    if (!active || active === document.body) focusFirst()
  }, 800)

  // Every route change lands focus somewhere sensible, or the remote has
  // nothing to move from.
  window.addEventListener('hashchange', () => {
    if (!document.documentElement.classList.contains('tv')) return
    setTimeout(() => {
      const active = document.activeElement
      if (!active || active === document.body || !visible(active)) focusFirst()
    }, 250)
  })

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
