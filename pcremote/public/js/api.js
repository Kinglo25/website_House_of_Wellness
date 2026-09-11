const TOKEN_KEY = 'pcremote-token'

export let token = localStorage.getItem(TOKEN_KEY) || null

export function setToken (value) {
  token = value
  if (value) localStorage.setItem(TOKEN_KEY, value)
  else localStorage.removeItem(TOKEN_KEY)
}

async function request (url, { method = 'POST', body, keepalive = false } = {}) {
  const res = await fetch(url, {
    method,
    keepalive,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  // A 401 while pairing means the PIN was wrong; anywhere else it means this
  // phone's token is no longer good, so send it back to the PIN screen.
  if (res.status === 401 && !url.endsWith('/api/pair')) {
    setToken(null)
    window.dispatchEvent(new CustomEvent('needs-pairing'))
    throw new Error('Pair this device again')
  }
  if (res.status === 204) return null
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`)
  return data
}

export const api = {
  pair: (pin, label) => request('/api/pair', { body: { pin, label } }),
  system: () => request('/api/system', { method: 'GET' }),
  saveSettings: patch => request('/api/settings', { body: patch }),

  move: (dx, dy) => request('/api/input/move', { body: { dx, dy } }),
  click: (button = 'left', double = false) => request('/api/input/click', { body: { button, double } }),
  button: (button, state) => request('/api/input/button', { body: { button, state } }),
  scroll: dy => request('/api/input/scroll', { body: { dy } }),
  type: text => request('/api/input/type', { body: { text } }),
  key: key => request('/api/input/key', { body: { key } }),
  combo: keys => request('/api/input/combo', { body: { keys } }),
  media: action => request(`/api/media/${action}`),

  power: action => request(`/api/power/${action}`, { body: { confirm: true }, keepalive: true }),

  timer: () => request('/api/timer', { method: 'GET' }),
  startTimer: (minutes, action) => request('/api/timer', { body: { minutes, action } }),
  extendTimer: (minutes = 10) => request('/api/timer/extend', { body: { minutes } }),
  cancelTimer: () => request('/api/timer/cancel')
}
