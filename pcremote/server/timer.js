import { getBackend } from './platform/index.js'

/* The bedtime timer.
 *
 * It lives on the server, not in the phone: you set it, put the phone down and
 * fall asleep, and it still fires with the screen off, the browser closed or
 * the phone out of range. */

export const ACTIONS = {
  shutdown: 'Shut down',
  sleep: 'Sleep',
  lock: 'Lock the screen',
  pause: 'Pause whatever is playing'
}

let timer = null
let state = { active: false }
const log = []

export function status () {
  if (!state.active) return { active: false, actions: ACTIONS, log: log.slice(-5) }
  const remainingMs = Math.max(0, state.endsAt - Date.now())
  return {
    active: true,
    action: state.action,
    actionLabel: ACTIONS[state.action],
    endsAt: state.endsAt,
    startedAt: state.startedAt,
    totalMinutes: state.totalMinutes,
    remainingMs,
    remainingSeconds: Math.round(remainingMs / 1000),
    actions: ACTIONS,
    log: log.slice(-5)
  }
}

export function start (minutes, action = 'shutdown') {
  const mins = Number(minutes)
  if (!Number.isFinite(mins) || mins <= 0) throw new Error('Give the timer a length in minutes')
  if (mins > 12 * 60) throw new Error('The longest timer is 12 hours')
  if (!ACTIONS[action]) throw new Error(`Unknown timer action: ${action}`)

  cancel()
  const ms = Math.round(mins * 60 * 1000)
  state = {
    active: true,
    action,
    totalMinutes: mins,
    startedAt: Date.now(),
    endsAt: Date.now() + ms
  }
  timer = setTimeout(fire, ms)
  return status()
}

export function extend (minutes) {
  if (!state.active) throw new Error('No timer is running')
  const mins = Number(minutes) || 0
  state.endsAt += Math.round(mins * 60 * 1000)
  state.totalMinutes += mins
  clearTimeout(timer)
  timer = setTimeout(fire, Math.max(0, state.endsAt - Date.now()))
  return status()
}

export function cancel () {
  clearTimeout(timer)
  timer = null
  const wasActive = state.active
  state = { active: false }
  return wasActive
}

async function fire () {
  const action = state.action
  state = { active: false }
  timer = null
  try {
    const backend = await getBackend()
    if (action === 'pause') await backend.media('playpause')
    else await backend.power(action)
    log.push({ at: Date.now(), action, ok: true })
  } catch (err) {
    log.push({ at: Date.now(), action, ok: false, error: err.message })
    console.error(`[timer] ${action} failed:`, err.message)
  }
}

// Exposed so the tests can run the timer without waiting for real minutes.
export const _internals = { fire, get state () { return state } }
