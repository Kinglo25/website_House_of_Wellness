import { h, esc, posterUrl, percent } from './util.js'

// One poster tile. Used by the home shelves, discover grid, search and library.
// `open` overrides where the tile goes: continue-watching tiles resume the file
// instead of opening the title page.
export function metaCard (meta, { progress = 0, ribbon = '', sub = '', open = '' } = {}) {
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

  const go = () => {
    location.hash = open || detailHref(meta)
  }
  card.addEventListener('click', go)
  card.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      go()
    }
  })
  return card
}

export function detailHref (meta) {
  return `#/detail/${encodeURIComponent(meta?.type || 'movie')}/${encodeURIComponent(meta?.id ?? '')}`
}

// Where a saved position should take you: back into the exact file that was
// playing, at the second it stopped. Entries saved before the player knew how
// to record that — or by a cast session — fall back to the title page, where a
// stream can be picked again.
export function resumeHref (entry) {
  const { playback, ...meta } = entry.meta || {}
  const time = Math.max(0, Math.floor(Number(entry.time) || 0))
  const query = new URLSearchParams({ t: String(time), meta: JSON.stringify(meta) })

  if (playback?.infoHash) {
    if (playback.fileIdx !== null && playback.fileIdx !== undefined) query.set('fileIdx', String(playback.fileIdx))
    return `#/player/torrent/${encodeURIComponent(playback.infoHash)}?${query}`
  }
  if (playback?.url) {
    query.set('src', playback.url)
    return `#/player/direct/x?${query}`
  }
  return detailHref(meta.id ? meta : { ...meta, id: entry.id })
}

// A "Continue watching" tile: how far in it is, how much is left, and a click
// that resumes rather than starting the title over.
export function continueCard (entry) {
  const meta = entry.meta || { name: entry.id, id: entry.id, type: 'movie' }
  const ratio = entry.duration > 0 ? entry.time / entry.duration : 0
  const left = entry.duration > 0 ? Math.round((entry.duration - entry.time) / 60) : 0
  return metaCard(meta, {
    progress: ratio,
    sub: left > 0 ? `${left} min left` : 'Resume',
    open: resumeHref(entry)
  })
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
