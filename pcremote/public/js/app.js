import { api, token, setToken } from './api.js'
import { setupTouchpad } from './touchpad.js'

const $ = id => document.getElementById(id)
const state = { timerAction: 'shutdown', system: null, poll: null }

/* --------------------------------------------------------------- toasts */

function toast (message, kind = '') {
  const node = document.createElement('div')
  node.className = `toast ${kind}`
  node.textContent = message
  $('toasts').append(node)
  setTimeout(() => node.remove(), 3200)
}

/* -------------------------------------------------------------- pairing */

let pin = ''

function drawPin () {
  $('pin-display').innerHTML = ''
  for (let i = 0; i < 6; i += 1) {
    const dot = document.createElement('div')
    dot.className = `pin-dot ${i < pin.length ? 'filled' : ''}`
    dot.textContent = i < pin.length ? '•' : ''
    $('pin-display').append(dot)
  }
}

function buildKeypad () {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back']
  $('keypad').innerHTML = ''
  for (const key of keys) {
    const button = document.createElement('button')
    button.textContent = key === 'clear' ? '✕' : key === 'back' ? '⌫' : key
    button.addEventListener('click', async () => {
      try { navigator.vibrate?.(8) } catch { /* not supported */ }
      if (key === 'clear') pin = ''
      else if (key === 'back') pin = pin.slice(0, -1)
      else if (pin.length < 6) pin += key
      drawPin()
      if (pin.length === 6) await submitPin()
    })
    $('keypad').append(button)
  }
  drawPin()
}

async function submitPin () {
  $('pair-error').hidden = true
  try {
    const result = await api.pair(pin, navigator.userAgent.includes('iPhone') ? 'iPhone' : 'phone')
    setToken(result.token)
    pin = ''
    drawPin()
    await enterApp()
  } catch (err) {
    pin = ''
    drawPin()
    $('pair-error').textContent = err.message
    $('pair-error').hidden = false
    try { navigator.vibrate?.([40, 60, 40]) } catch { /* not supported */ }
  }
}

function showPairing () {
  $('main').hidden = true
  $('pair').hidden = false
  clearInterval(state.poll)
}

window.addEventListener('needs-pairing', showPairing)

/* ----------------------------------------------------------------- tabs */

function showPage (name) {
  for (const page of ['pad', 'keys', 'media', 'timer', 'power']) {
    $(`page-${page}`).hidden = page !== name
  }
  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.page === name)
  })
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => showPage(tab.dataset.page))
})

/* ------------------------------------------------------------- controls */

document.querySelectorAll('[data-click]').forEach(button => {
  button.addEventListener('click', () => {
    api.click(button.dataset.click).catch(err => toast(err.message, 'err'))
  })
})

document.querySelectorAll('[data-key]').forEach(button => {
  button.addEventListener('click', () => {
    api.key(button.dataset.key).catch(err => toast(err.message, 'err'))
  })
})

document.querySelectorAll('[data-combo]').forEach(button => {
  button.addEventListener('click', () => {
    api.combo(button.dataset.combo.split(',')).catch(err => toast(err.message, 'err'))
  })
})

document.querySelectorAll('[data-media]').forEach(button => {
  button.addEventListener('click', () => {
    api.media(button.dataset.media).catch(err => toast(err.message, 'err'))
  })
})

// Typing is sent as it happens, so the PC keeps up with the phone keyboard.
const typeInput = $('type-input')
typeInput.addEventListener('input', () => {
  const text = typeInput.value
  if (!text) return
  typeInput.value = ''
  api.type(text).catch(err => toast(err.message, 'err'))
})
typeInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault()
    api.key('Enter').catch(err => toast(err.message, 'err'))
  }
  if (event.key === 'Backspace' && !typeInput.value) {
    event.preventDefault()
    api.key('Backspace').catch(err => toast(err.message, 'err'))
  }
})

/* ---------------------------------------------------------------- power */

const POWER_LABELS = {
  shutdown: 'Shut down the computer?',
  restart: 'Restart the computer?',
  sleep: 'Put the computer to sleep?',
  lock: 'Lock the screen?',
  logoff: 'Sign out?'
}

document.querySelectorAll('[data-power]').forEach(button => {
  button.addEventListener('click', async () => {
    const action = button.dataset.power
    const confirmed = await sheet({
      title: POWER_LABELS[action],
      note: action === 'shutdown' || action === 'restart'
        ? 'Anything unsaved on the computer will be lost.'
        : '',
      confirmLabel: button.textContent.trim(),
      danger: action === 'shutdown' || action === 'restart'
    })
    if (!confirmed) return
    try {
      await api.power(action)
      toast(`${action} sent`, 'ok')
    } catch (err) {
      // A shutdown kills the connection as it happens; that is not a failure.
      if (/Failed to fetch|NetworkError|load failed/i.test(err.message)) toast(`${action} sent`, 'ok')
      else toast(err.message, 'err')
    }
  })
})

/* ------------------------------------------------------------ bed timer */

const PRESETS = [15, 30, 45, 60, 90, 120]

function buildTimerControls () {
  const actions = { shutdown: '⏻ Shut down', sleep: '🌙 Sleep', lock: '🔒 Lock', pause: '⏸ Pause playback' }
  $('timer-actions').innerHTML = ''
  for (const [key, label] of Object.entries(actions)) {
    const chip = document.createElement('button')
    chip.className = `chip ${key === state.timerAction ? 'active' : ''}`
    chip.textContent = label
    chip.addEventListener('click', () => {
      state.timerAction = key
      buildTimerControls()
    })
    $('timer-actions').append(chip)
  }

  $('timer-presets').innerHTML = ''
  for (const minutes of PRESETS) {
    const button = document.createElement('button')
    button.className = 'preset'
    button.textContent = minutes >= 60 ? `${minutes / 60} hr${minutes >= 120 ? 's' : ''}` : `${minutes} min`
    button.addEventListener('click', () => startTimer(minutes))
    $('timer-presets').append(button)
  }
}

async function startTimer (minutes) {
  try {
    const status = await api.startTimer(minutes, state.timerAction)
    renderTimer(status)
    toast(`${status.actionLabel} in ${minutes} minutes`, 'ok')
  } catch (err) {
    toast(err.message, 'err')
  }
}

$('timer-start').addEventListener('click', () => {
  const minutes = Number($('timer-custom').value)
  if (!minutes) return toast('Enter how many minutes', 'err')
  $('timer-custom').value = ''
  $('timer-custom').blur()
  startTimer(minutes)
})

document.querySelectorAll('[data-timer]').forEach(button => {
  button.addEventListener('click', async () => {
    try {
      const status = button.dataset.timer === 'cancel'
        ? await api.cancelTimer()
        : await api.extendTimer(10)
      renderTimer(status)
      toast(button.dataset.timer === 'cancel' ? 'Timer cancelled' : '10 minutes added', 'ok')
    } catch (err) {
      toast(err.message, 'err')
    }
  })
})

function clock (seconds) {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = n => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

function renderTimer (status) {
  const active = Boolean(status?.active)
  $('countdown').hidden = !active
  $('timer-setup').hidden = active
  $('timer-banner').hidden = !active
  if (!active) return

  const remaining = clock(status.remainingSeconds)
  $('countdown-time').textContent = remaining
  $('countdown-what').textContent = `then: ${status.actionLabel.toLowerCase()}`
  $('timer-banner-text').textContent = `${status.actionLabel} in ${remaining}`
}

/* ---------------------------------------------------------------- sheet */

function sheet ({ title, note = '', confirmLabel = 'Confirm', danger = false }) {
  return new Promise(resolve => {
    const backdrop = document.createElement('div')
    backdrop.className = 'sheet-backdrop'
    backdrop.innerHTML = `
      <div class="sheet">
        <h2></h2>
        ${note ? '<p class="tiny muted note"></p>' : ''}
        <button class="btn ${danger ? 'danger' : 'primary'}" data-act="ok"></button>
        <button class="btn" data-act="cancel">Cancel</button>
      </div>`
    backdrop.querySelector('h2').textContent = title
    if (note) backdrop.querySelector('.note').textContent = note
    backdrop.querySelector('[data-act="ok"]').textContent = confirmLabel

    backdrop.addEventListener('click', event => {
      const act = event.target.dataset?.act
      if (event.target === backdrop || act === 'cancel') {
        backdrop.remove()
        resolve(false)
      }
      if (act === 'ok') {
        backdrop.remove()
        resolve(true)
      }
    })
    $('sheet-root').append(backdrop)
  })
}

/* ------------------------------------------------------------- settings */

$('settings-btn').addEventListener('click', async () => {
  const system = state.system || {}
  const confirmed = await sheet({
    title: `${system.hostname || 'This computer'}`,
    note: [
      `${system.platformName} · input via ${system.tool || 'unknown'}`,
      system.note || '',
      'Unpair to make this phone ask for the PIN again.'
    ].filter(Boolean).join('\n'),
    confirmLabel: 'Unpair this phone',
    danger: true
  })
  if (!confirmed) return
  setToken(null)
  showPairing()
})

/* ----------------------------------------------------------------- boot */

async function enterApp () {
  $('pair').hidden = true
  $('main').hidden = false

  try {
    state.system = await api.system()
    $('host-name').textContent = state.system.hostname
    $('host-os').textContent = `${state.system.platformName} · ${state.system.tool || 'no input tool'}`
    state.timerAction = state.system.defaultTimerAction || 'shutdown'
    if (!state.system.pointer) {
      $('pad-hint').innerHTML = `Pointer control is unavailable.<br><span class="tiny">${state.system.note || ''}</span>`
    }
    if (state.system.platform === 'darwin') {
      $('media-note').textContent = 'Play, next and previous control Spotify or Music.'
    }
  } catch (err) {
    if (!/Pair this device/.test(err.message)) toast(err.message, 'err')
    return
  }

  buildTimerControls()
  renderTimer(await api.timer().catch(() => null))

  clearInterval(state.poll)
  state.poll = setInterval(async () => {
    if (document.hidden) return
    try {
      renderTimer(await api.timer())
    } catch { /* transient */ }
  }, 1000)
}

setupTouchpad($('pad'))
buildKeypad()

if (token) enterApp()
else showPairing()
