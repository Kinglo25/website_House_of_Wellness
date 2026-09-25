import { h, esc, posterUrl, percent } from './util.js'

// One poster tile. Used by the home shelves, discover grid, search and library.
// `open` overrides where the tile goes: continue-watching tiles resume the file
// instead of opening the title page.
//
// `onRemove` puts a visible × on the tile — Netflix's "Remove from row" — which
// a phone or a TV remote can reach, unlike a right-click.
export const KINDS = { movie: 'Film', series: 'Series', channel: 'Channel', tv: 'TV' }

export function metaCard (meta, { progress = 0, ribbon = '', sub = '', open = '', onRemove = null, removeLabel = 'Remove from row' } = {}) {
  const title = meta.name || meta.title || 'Untitled'
  // Year and genre, as Netflix and Stremio label a tile; the kind only when the
  // add-on gives no genre ("Film", not the raw "movie").
  const subtitle = sub || [meta.releaseInfo || meta.year, meta.genres?.[0] || KINDS[meta.type] || meta.type].filter(Boolean).join(' · ')
  const card = h(`
    <div class="card" role="button" tabindex="0">
      <div class="poster">
        <img loading="lazy" alt="${esc(title)}" src="${esc(posterUrl(meta))}">
        ${ribbon ? `<span class="ribbon">${esc(ribbon)}</span>` : ''}
        ${progress > 0 ? `<div class="progress-bar"><i style="width:${percent(progress)}"></i></div>` : ''}
        ${onRemove ? `<button class="remove" type="button" title="${esc(removeLabel)}" aria-label="${esc(removeLabel)}">✕</button>` : ''}
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
  card.querySelector('.remove')?.addEventListener('click', async event => {
    event.stopPropagation()
    const button = event.currentTarget
    button.disabled = true
    if (await onRemove() === false) return (button.disabled = false)
    const strip = card.parentElement
    const neighbour = card.nextElementSibling || card.previousElementSibling
    card.remove()
    // On a TV the remote needs somewhere to be: the tile beside it.
    if (document.documentElement.classList.contains('tv')) neighbour?.focus({ preventScroll: true })
    // The last tile gone: a row with nothing in it goes too.
    if (strip && !strip.querySelector('.card:not(.see-all)')) strip.closest('.shelf')?.setAttribute('hidden', '')
  })
  card.addEventListener('click', go)
  card.addEventListener('keydown', event => {
    if (event.target !== card) return
    // A TV remote's OK is handled in tv.js, on release, so holding it can arm
    // the tile's × instead.
    if (document.documentElement.classList.contains('tv')) return
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
export function continueCard (entry, { onRemove = null } = {}) {
  const meta = entry.meta || { name: entry.id, id: entry.id, type: 'movie' }
  const ratio = entry.duration > 0 ? entry.time / entry.duration : 0
  const left = entry.duration > 0 ? Math.ceil((entry.duration - entry.time) / 60) : 0
  // A show is named as a show, with the episode underneath, as on Netflix.
  const episode = meta.season != null && meta.episode != null ? `S${meta.season}:E${meta.episode}` : ''
  const card = metaCard({ ...meta, name: episode ? String(meta.title || meta.name || '').replace(/\s+S\d+E\d+$/, '') : meta.name }, {
    progress: ratio,
    sub: [episode, left > 0 ? `${left} min left` : 'Resume'].filter(Boolean).join(' · '),
    open: resumeHref(entry),
    onRemove
  })
  return card
}

// An "Up next" tile: the episode after the one just finished. It opens the
// series page, which has that episode picked and its streams listed.
export function upNextCard (series, video, { onRemove = null } = {}) {
  const label = video.season != null && video.episode != null ? `S${video.season}:E${video.episode}` : 'Next episode'
  return metaCard(series, {
    ribbon: 'Up next',
    sub: `${label}${video.name || video.title ? ` · ${video.name || video.title}` : ''}`,
    open: detailHref(series),
    onRemove
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
  node.moreHref = moreHref
  addRowArrows(node)
  return node
}

// The last tile of a row on a TV: "See all", where the remote already is at
// the end of the row — the heading's link is out of the D-pad's way. Shown in
// TV mode only (see style.css).
export function seeAllCard (href) {
  return h(`<a class="card see-all" href="${esc(href)}"><div class="poster"><span>See all</span></div></a>`)
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

// Netflix's ‹ › at the ends of a row, for a mouse, which cannot scroll a row
// sideways on its own; each moves the row most of a screen. They show on
// hover, and only towards more — see style.css. The strip is looked up when
// used: the home page swaps its placeholder strip for the real one.
function addRowArrows (node) {
  const prev = h('<button class="strip-nav prev" type="button" aria-label="Scroll left" tabindex="-1">‹</button>')
  const next = h('<button class="strip-nav next" type="button" aria-label="Scroll right" tabindex="-1">›</button>')
  const strip = () => node.querySelector('.strip')
  const update = () => {
    const row = strip()
    if (!row) return
    prev.hidden = row.scrollLeft < 8
    next.hidden = row.scrollLeft + row.clientWidth >= row.scrollWidth - 8
  }
  const move = direction => {
    const row = strip()
    row?.scrollBy({ left: direction * row.clientWidth * 0.85, behavior: 'smooth' })
  }
  prev.addEventListener('click', () => move(-1))
  next.addEventListener('click', () => move(1))
  // A row's scroll does not bubble; listening while it travels down does.
  node.addEventListener('scroll', update, true)
  node.addEventListener('mouseenter', update)
  prev.hidden = true
  next.hidden = true
  node.append(prev, next)
}

// An episode's progress entry, filled in from its show when it was saved
// without a name or poster — the TV app's own player sends neither — so its
// tile shows the show rather than a bare id. `show` is the show's metadata,
// or null when it could not be fetched.
export function withShowDetails (entry, series, show) {
  const [, season, episode] = /:(\d+):(\d+)$/.exec(entry.id) || []
  return {
    ...entry,
    meta: {
      ...entry.meta,
      type: 'series', id: series, imdbId: series, videoId: entry.id,
      name: show?.name || series, title: show?.name || series, poster: show?.poster,
      season: season ? Number(season) : undefined, episode: episode ? Number(episode) : undefined
    }
  }
}
