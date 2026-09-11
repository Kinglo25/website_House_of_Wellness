import { api } from './api.js'

/* Trackpad gestures.
 *
 * Movement is accumulated and flushed on an animation frame with only one
 * request in flight at a time. Without that, a fast swipe queues hundreds of
 * requests and the pointer keeps drifting after the finger stops. */

const TAP_MS = 250          // touch shorter than this, with little movement, is a click
const TAP_SLOP = 12         // pixels of wobble still counted as a tap
const HOLD_MS = 500         // hold after a tap starts a drag

export function setupTouchpad (element, { onFeedback } = {}) {
  let pending = { dx: 0, dy: 0 }
  let inFlight = false
  let frame = null

  let startedAt = 0
  let startPoint = null
  let moved = 0
  let fingers = 0
  let maxFingers = 0
  let scrollAccum = 0
  let lastScrollAt = 0
  let dragging = false
  let holdTimer = null
  let lastTapAt = 0

  const flush = () => {
    frame = null
    if (inFlight || (!pending.dx && !pending.dy)) return
    const { dx, dy } = pending
    pending = { dx: 0, dy: 0 }
    inFlight = true
    api.move(dx, dy)
      .catch(() => {})
      .finally(() => {
        inFlight = false
        // Anything that piled up while the request was out goes next frame.
        if (pending.dx || pending.dy) schedule()
      })
  }

  const schedule = () => {
    if (frame == null) frame = requestAnimationFrame(flush)
  }

  const queueMove = (dx, dy) => {
    pending.dx += dx
    pending.dy += dy
    schedule()
  }

  const buzz = ms => {
    try { navigator.vibrate?.(ms) } catch { /* not supported */ }
  }

  element.addEventListener('touchstart', event => {
    event.preventDefault()
    fingers = event.touches.length
    maxFingers = Math.max(maxFingers, fingers)
    element.classList.add('active')

    if (fingers === 1) {
      startedAt = Date.now()
      startPoint = { x: event.touches[0].clientX, y: event.touches[0].clientY }
      moved = 0
      // A second tap that stays down turns into a drag, like a laptop trackpad.
      if (Date.now() - lastTapAt < 300) {
        holdTimer = setTimeout(() => {
          dragging = true
          buzz(20)
          api.button('left', 'down').catch(() => {})
          onFeedback?.('drag')
        }, 60)
      } else {
        holdTimer = setTimeout(() => {
          dragging = true
          buzz(20)
          api.button('left', 'down').catch(() => {})
          onFeedback?.('drag')
        }, HOLD_MS)
      }
    }
  }, { passive: false })

  element.addEventListener('touchmove', event => {
    event.preventDefault()
    const touch = event.touches[0]
    if (!touch || !startPoint) return

    const dx = touch.clientX - startPoint.x
    const dy = touch.clientY - startPoint.y
    moved += Math.abs(dx) + Math.abs(dy)
    startPoint = { x: touch.clientX, y: touch.clientY }

    if (moved > TAP_SLOP && holdTimer) {
      clearTimeout(holdTimer)
      holdTimer = null
    }

    if (event.touches.length >= 2) {
      // Two fingers scroll; batch into wheel-sized notches.
      scrollAccum += dy
      if (Math.abs(scrollAccum) >= 18 && Date.now() - lastScrollAt > 40) {
        api.scroll(-scrollAccum).catch(() => {})
        scrollAccum = 0
        lastScrollAt = Date.now()
      }
      return
    }

    queueMove(dx, dy)
  }, { passive: false })

  const finish = event => {
    event.preventDefault()
    clearTimeout(holdTimer)
    holdTimer = null
    element.classList.remove('active')

    const heldFor = Date.now() - startedAt
    const wasTap = heldFor < TAP_MS && moved <= TAP_SLOP

    if (dragging) {
      dragging = false
      api.button('left', 'up').catch(() => {})
    } else if (wasTap && maxFingers >= 2) {
      buzz(12)
      api.click('right').catch(() => {})
      onFeedback?.('right')
    } else if (wasTap && maxFingers === 1) {
      buzz(8)
      api.click('left').catch(() => {})
      onFeedback?.('left')
      lastTapAt = Date.now()
    }

    if (event.touches.length === 0) {
      fingers = 0
      maxFingers = 0
      startPoint = null
      scrollAccum = 0
    }
  }

  element.addEventListener('touchend', finish, { passive: false })
  element.addEventListener('touchcancel', finish, { passive: false })

  // Mouse fallback, so the remote is usable from a laptop too.
  let mouseDown = false
  element.addEventListener('mousedown', event => {
    mouseDown = true
    startPoint = { x: event.clientX, y: event.clientY }
    startedAt = Date.now()
    moved = 0
  })
  window.addEventListener('mousemove', event => {
    if (!mouseDown || !startPoint) return
    queueMove(event.clientX - startPoint.x, event.clientY - startPoint.y)
    moved += Math.abs(event.clientX - startPoint.x) + Math.abs(event.clientY - startPoint.y)
    startPoint = { x: event.clientX, y: event.clientY }
  })
  window.addEventListener('mouseup', () => {
    if (!mouseDown) return
    mouseDown = false
    if (Date.now() - startedAt < TAP_MS && moved <= TAP_SLOP) api.click('left').catch(() => {})
    startPoint = null
  })

  element.addEventListener('wheel', event => {
    event.preventDefault()
    api.scroll(event.deltaY).catch(() => {})
  }, { passive: false })
}
