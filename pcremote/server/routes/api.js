import express from 'express'
import { config } from '../config.js'
import { getBackend, getCapabilities } from '../platform/index.js'
import * as bedtime from '../timer.js'

const router = express.Router()
const wrap = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)

/* ------------------------------------------------------------------ auth */

// Wrong PINs are slowed down, so a six-digit code cannot simply be guessed by
// a script sitting on the same network.
const attempts = new Map()
const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 60_000

function throttle (ip) {
  const entry = attempts.get(ip)
  if (!entry) return null
  if (entry.lockedUntil > Date.now()) return Math.ceil((entry.lockedUntil - Date.now()) / 1000)
  if (entry.lockedUntil && entry.lockedUntil <= Date.now()) attempts.delete(ip)
  return null
}

function recordFailure (ip) {
  const entry = attempts.get(ip) || { count: 0, lockedUntil: 0 }
  entry.count += 1
  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_MS
    entry.count = 0
  }
  attempts.set(ip, entry)
}

router.post('/pair', (req, res) => {
  const ip = req.ip
  const waitSeconds = throttle(ip)
  if (waitSeconds) {
    return res.status(429).json({ error: `Too many wrong PINs. Try again in ${waitSeconds}s.` })
  }
  if (!config.checkPin(req.body?.pin)) {
    recordFailure(ip)
    return res.status(401).json({ error: 'That PIN is not right' })
  }
  attempts.delete(ip)
  const token = config.addToken(req.body?.label)
  res.json({ token, hostname: (req.body?.label || 'phone') })
})

// Everything below this line needs a paired device.
router.use((req, res, next) => {
  const header = req.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token
  if (!config.hasToken(token)) return res.status(401).json({ error: 'Pair this device first' })
  next()
})

/* --------------------------------------------------------------- system */

router.get('/system', wrap(async (req, res) => {
  const capabilities = await getCapabilities()
  const settings = config.get()
  res.json({
    ...capabilities,
    pointerSpeed: settings.pointerSpeed,
    naturalScroll: settings.naturalScroll,
    defaultTimerMinutes: settings.defaultTimerMinutes,
    defaultTimerAction: settings.defaultTimerAction
  })
}))

router.post('/settings', (req, res) => {
  const next = config.update(req.body)
  res.json({ pointerSpeed: next.pointerSpeed, naturalScroll: next.naturalScroll, defaultTimerMinutes: next.defaultTimerMinutes, defaultTimerAction: next.defaultTimerAction })
})

router.post('/forget-devices', (req, res) => {
  config.forgetDevices()
  res.json({ ok: true })
})

/* ---------------------------------------------------------------- input */

// Pointer moves arrive continuously while a finger is down; they are fire and
// forget, so they answer 204 without waiting on the OS.
router.post('/input/move', wrap(async (req, res) => {
  const backend = await getBackend()
  const speed = config.get().pointerSpeed
  backend.moveRelative((Number(req.body?.dx) || 0) * speed, (Number(req.body?.dy) || 0) * speed)
  res.sendStatus(204)
}))

router.post('/input/click', wrap(async (req, res) => {
  const backend = await getBackend()
  await backend.click(req.body?.button || 'left', Boolean(req.body?.double))
  res.sendStatus(204)
}))

router.post('/input/button', wrap(async (req, res) => {
  const backend = await getBackend()
  if (req.body?.state === 'down') await backend.buttonDown(req.body?.button || 'left')
  else await backend.buttonUp(req.body?.button || 'left')
  res.sendStatus(204)
}))

router.post('/input/scroll', wrap(async (req, res) => {
  const backend = await getBackend()
  const dy = Number(req.body?.dy) || 0
  await backend.scroll(config.get().naturalScroll ? -dy : dy)
  res.sendStatus(204)
}))

router.post('/input/type', wrap(async (req, res) => {
  const text = String(req.body?.text ?? '')
  if (!text) return res.sendStatus(204)
  if (text.length > 2000) return res.status(413).json({ error: 'That is too much text to send at once' })
  const backend = await getBackend()
  await backend.type(text)
  res.sendStatus(204)
}))

router.post('/input/key', wrap(async (req, res) => {
  const backend = await getBackend()
  await backend.key(req.body?.key)
  res.sendStatus(204)
}))

router.post('/input/combo', wrap(async (req, res) => {
  const keys = Array.isArray(req.body?.keys) ? req.body.keys : []
  if (!keys.length) return res.status(400).json({ error: 'No keys given' })
  const backend = await getBackend()
  await backend.combo(keys)
  res.sendStatus(204)
}))

router.post('/media/:action', wrap(async (req, res) => {
  const backend = await getBackend()
  await backend.media(req.params.action)
  res.sendStatus(204)
}))

/* ---------------------------------------------------------------- power */

const POWER_ACTIONS = new Set(['shutdown', 'restart', 'sleep', 'lock', 'logoff'])

router.post('/power/:action', wrap(async (req, res) => {
  const action = req.params.action
  if (!POWER_ACTIONS.has(action)) return res.status(400).json({ error: `Unknown power action: ${action}` })
  // The phone has to say it means it, so a stray tap cannot end the session.
  if (req.body?.confirm !== true) return res.status(400).json({ error: 'Confirm this action first' })

  const backend = await getBackend()
  // Answer before pulling the rug: shutdown kills the connection mid-response.
  res.json({ ok: true, action })
  setTimeout(() => {
    backend.power(action).catch(err => console.error(`[power] ${action} failed:`, err.message))
  }, 250).unref?.()
}))

/* ------------------------------------------------------------ bed timer */

router.get('/timer', (req, res) => res.json(bedtime.status()))

router.post('/timer', wrap(async (req, res) => {
  res.json(bedtime.start(req.body?.minutes, req.body?.action || 'shutdown'))
}))

router.post('/timer/extend', (req, res) => res.json(bedtime.extend(req.body?.minutes ?? 10)))

router.post('/timer/cancel', (req, res) => {
  const wasActive = bedtime.cancel()
  res.json({ cancelled: wasActive, ...bedtime.status() })
})

export default router
