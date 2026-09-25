/* Hash router: #/board, #/detail/movie/tt0111161, #/player/<hash>/<idx> … */

import { esc } from './util.js'

const routes = []
let current = null

export function route (pattern, view) {
  // "/detail/:type/:id" -> /^#?\/detail\/([^/]+)\/([^/]+)$/
  const names = []
  const source = pattern.replace(/:([A-Za-z0-9_]+)/g, (_, name) => {
    names.push(name)
    return '([^/]+)'
  })
  routes.push({ regex: new RegExp(`^${source}$`), names, view })
}

export function navigate (path, { replace = false } = {}) {
  const hash = `#${path}`
  if (location.hash === hash) return render()
  if (replace) history.replaceState(null, '', hash)
  else location.hash = hash
  if (replace) render()
}

export function currentPath () {
  return location.hash.slice(1) || '/board'
}

export async function render () {
  const path = currentPath()
  const [pathname, queryString] = path.split('?')
  const query = Object.fromEntries(new URLSearchParams(queryString || ''))

  for (const entry of routes) {
    const match = entry.regex.exec(pathname)
    if (!match) continue
    const params = {}
    entry.names.forEach((name, index) => {
      params[name] = decodeURIComponent(match[index + 1])
    })
    if (current?.destroy) current.destroy()
    const container = document.getElementById('view')
    const saved = history.state?.scroll || 0
    container.scrollTop = 0
    current = await entry.view({ params, query, container }) || null
    highlight(pathname)
    if (saved) restoreScroll(container, saved)
    return
  }

  document.getElementById('view').innerHTML = `
    <div class="empty"><h2>Page not found</h2><p>Nothing lives at <code>${esc(path)}</code>.</p>
    <a class="btn primary" href="#/board">Back home</a></div>`
}

function highlight (pathname) {
  const section = pathname.split('/')[1] || 'board'
  document.querySelectorAll('nav.rail a.item').forEach(link => {
    link.classList.toggle('active', link.dataset.route === section)
  })
}

// Back to a page you scrolled down returns you where you were, as a browser
// does for ordinary pages. Each history entry keeps its own position; a page
// reached afresh starts at the top.
function rememberScroll (container) {
  let timer = null
  container.addEventListener('scroll', () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      history.replaceState({ ...history.state, scroll: container.scrollTop }, '')
    }, 150)
  }, { passive: true })
}

// Rows fill in after the page has rendered, so the position may not exist yet:
// keep trying while the page grows, and give up the moment the user scrolls.
function restoreScroll (container, target) {
  const started = Date.now()
  let settled = false
  const stop = () => { settled = true }
  container.addEventListener('wheel', stop, { once: true, passive: true })
  container.addEventListener('touchstart', stop, { once: true, passive: true })
  window.addEventListener('keydown', stop, { once: true })
  const attempt = () => {
    if (settled) return
    container.scrollTop = target
    if (Math.abs(container.scrollTop - target) < 2 || Date.now() - started > 3000) return stop()
    setTimeout(attempt, 100)
  }
  attempt()
}

export function startRouter () {
  window.addEventListener('hashchange', render)
  rememberScroll(document.getElementById('view'))
  render()
}
