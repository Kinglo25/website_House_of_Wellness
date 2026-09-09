import { h, esc, posterUrl, percent } from './util.js'

// One poster tile. Used by the home shelves, discover grid, search and library.
export function metaCard (meta, { progress = 0, ribbon = '', sub = '' } = {}) {
  const title = meta.name || meta.title || 'Untitled'
  const subtitle = sub || [meta.releaseInfo || meta.year, meta.type].filter(Boolean).join(' · ')
  const card = h(`
    <div class="card" role="button" tabindex="0">
      <div class="poster">
        <img loading="lazy" alt="${esc(title)}" src="${esc(posterUrl(meta))}">
        ${ribbon ? `<span class="ribbon">${esc(ribbon)}</span>` : ''}
        ${progress > 0 ? `<div class="progress-bar"><i style="width:${percent(progress)}"></i></div>` : ''}
      </div>
      <div class="title">${esc(title)}</div>
      <div class="sub">${esc(subtitle)}</div>
    </div>`)

  const img = card.querySelector('img')
  img.addEventListener('error', () => {
    img.src = posterUrl({ name: title })
  }, { once: true })

  const open = () => {
    location.hash = `#/detail/${encodeURIComponent(meta.type || 'movie')}/${encodeURIComponent(meta.id)}`
  }
  card.addEventListener('click', open)
  card.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      open()
    }
  })
  return card
}

export function shelf ({ title, source = '', moreHref = '' }) {
  const node = h(`
    <div class="shelf">
      <div class="shelf-head">
        <h2>${esc(title)}</h2>
        ${source ? `<span class="src">${esc(source)}</span>` : ''}
        ${moreHref ? `<a href="${esc(moreHref)}">See all →</a>` : ''}
      </div>
      <div class="strip"></div>
    </div>`)
  node.strip = node.querySelector('.strip')
  return node
}

export function skeletonStrip (count = 7) {
  const strip = h('<div class="strip"></div>')
  for (let index = 0; index < count; index += 1) {
    strip.append(h('<div class="card"><div class="poster skeleton"></div></div>'))
  }
  return strip
}

export function emptyState ({ title, message, action = '', href = '' }) {
  return h(`
    <div class="empty">
      <h2>${esc(title)}</h2>
      <p>${message}</p>
      ${action ? `<a class="btn primary" href="${esc(href)}">${esc(action)}</a>` : ''}
    </div>`)
}

export function errorBox (message) {
  return h(`<div class="error-box">${esc(message)}</div>`)
}
