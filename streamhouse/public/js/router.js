/* Hash router: #/board, #/detail/movie/tt0111161, #/player/<hash>/<idx> … */

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
    container.scrollTop = 0
    current = await entry.view({ params, query, container }) || null
    highlight(pathname)
    return
  }

  document.getElementById('view').innerHTML = `
    <div class="empty"><h2>Page not found</h2><p>Nothing lives at <code>${path}</code>.</p>
    <a class="btn primary" href="#/board">Back home</a></div>`
}

function highlight (pathname) {
  const section = pathname.split('/')[1] || 'board'
  document.querySelectorAll('nav.rail a.item').forEach(link => {
    link.classList.toggle('active', link.dataset.route === section)
  })
}

export function startRouter () {
  window.addEventListener('hashchange', render)
  render()
}
