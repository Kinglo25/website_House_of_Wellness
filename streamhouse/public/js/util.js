/* Small helpers shared by every view. */

export function h (html) {
  const template = document.createElement('template')
  template.innerHTML = html.trim()
  return template.content.firstElementChild
}

export function esc (value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]))
}

export function bytes (value, perSecond = false) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return perSecond ? '0 B/s' : '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  const scaled = n / Math.pow(1024, index)
  const text = `${scaled.toFixed(scaled >= 100 || index === 0 ? 0 : 1)} ${units[index]}`
  return perSecond ? `${text}/s` : text
}

export function duration (ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '∞'
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

export function clock (seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const s = Math.floor(seconds % 60)
  const m = Math.floor((seconds / 60) % 60)
  const hrs = Math.floor(seconds / 3600)
  const pad = value => String(value).padStart(2, '0')
  return hrs ? `${hrs}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

export function percent (value) {
  return `${Math.round((Number(value) || 0) * 100)}%`
}

export function toast (message, kind = '') {
  const node = h(`<div class="toast ${kind}">${esc(message)}</div>`)
  document.getElementById('toasts').append(node)
  setTimeout(() => {
    node.style.opacity = '0'
    node.style.transition = 'opacity .3s'
    setTimeout(() => node.remove(), 300)
  }, 4200)
}

export function confirmDialog ({ title, body, confirmLabel = 'Confirm', danger = false }) {
  return new Promise(resolve => {
    const backdrop = h(`
      <div class="modal-backdrop">
        <div class="modal">
          <header><h2>${esc(title)}</h2></header>
          <div class="content">${body}</div>
          <footer>
            <button class="btn ghost" data-act="cancel">Cancel</button>
            <button class="btn ${danger ? 'danger' : 'primary'}" data-act="ok">${esc(confirmLabel)}</button>
          </footer>
        </div>
      </div>`)
    const close = value => {
      backdrop.remove()
      resolve(value)
    }
    backdrop.addEventListener('click', event => {
      if (event.target === backdrop || event.target.dataset.act === 'cancel') close(false)
      if (event.target.dataset.act === 'ok') {
        const inputs = {}
        backdrop.querySelectorAll('[name]').forEach(input => {
          inputs[input.name] = input.type === 'checkbox' ? input.checked : input.value
        })
        close(Object.keys(inputs).length ? inputs : true)
      }
    })
    document.getElementById('modal-root').append(backdrop)
    backdrop.querySelector('input, select, textarea')?.focus()
  })
}

export function debounce (fn, wait = 300) {
  let timer
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), wait)
  }
}

// Posters from add-ons occasionally 404; fall back to a generated tile so the
// grid never shows a broken image icon.
export function posterUrl (meta) {
  return meta?.poster || meta?.logo || placeholder(meta?.name || meta?.title || '?')
}

export function placeholder (text) {
  const letter = String(text).trim().charAt(0).toUpperCase() || '?'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300">
    <rect width="200" height="300" fill="#14142b"/>
    <text x="100" y="165" font-size="86" font-family="sans-serif" fill="#3a3a5f" text-anchor="middle">${letter}</text>
  </svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
