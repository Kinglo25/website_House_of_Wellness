import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'

/* Settings and the pairing PIN.
 *
 * This app can shut the machine down and type into whatever window has focus,
 * so it is not left open: a PIN is generated on first run and every request
 * needs a token exchanged for it. */

const DATA_DIR = process.env.PCREMOTE_DIR
  ? path.resolve(process.env.PCREMOTE_DIR)
  : path.join(os.homedir(), '.pcremote')

const FILE = path.join(DATA_DIR, 'config.json')

const DEFAULTS = {
  port: Number(process.env.PORT) || 11480,
  host: process.env.HOST || '0.0.0.0',   // useless from a phone otherwise
  pin: null,                             // generated on first run
  tokens: [],                            // paired devices
  pointerSpeed: 1.6,
  naturalScroll: false,
  defaultTimerMinutes: 30,
  defaultTimerAction: 'shutdown'
}

function load () {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  let stored = {}
  try {
    stored = JSON.parse(fs.readFileSync(FILE, 'utf8'))
  } catch { /* first run */ }
  const merged = { ...DEFAULTS, ...stored }
  if (!merged.pin) merged.pin = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
  return merged
}

let state = load()

function persist () {
  const tmp = `${FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, FILE)
}
persist()

export const config = {
  get: () => state,

  update (patch) {
    for (const [key, value] of Object.entries(patch || {})) {
      if (!(key in DEFAULTS) || key === 'pin' || key === 'tokens') continue
      if (typeof DEFAULTS[key] === 'number') {
        const num = Number(value)
        if (Number.isFinite(num)) state[key] = num
      } else if (typeof DEFAULTS[key] === 'boolean') {
        state[key] = Boolean(value)
      } else if (typeof value === 'string' && value.trim()) {
        state[key] = value.trim()
      }
    }
    persist()
    return state
  },

  resetPin () {
    state.pin = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
    state.tokens = []
    persist()
    return state.pin
  },

  addToken (label) {
    const token = crypto.randomBytes(24).toString('hex')
    state.tokens.push({ token, label: label || 'phone', pairedAt: Date.now() })
    if (state.tokens.length > 20) state.tokens = state.tokens.slice(-20)
    persist()
    return token
  },

  hasToken (token) {
    if (!token) return false
    // Constant-time comparison so a token cannot be guessed by timing.
    const candidate = Buffer.from(String(token))
    return state.tokens.some(entry => {
      const known = Buffer.from(entry.token)
      return known.length === candidate.length && crypto.timingSafeEqual(known, candidate)
    })
  },

  checkPin (pin) {
    const given = Buffer.from(String(pin || ''))
    const known = Buffer.from(String(state.pin))
    return given.length === known.length && crypto.timingSafeEqual(given, known)
  },

  forgetDevices () {
    state.tokens = []
    persist()
  },

  dataDir: DATA_DIR
}
