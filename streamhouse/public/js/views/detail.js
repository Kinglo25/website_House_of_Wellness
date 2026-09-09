import { api } from '../api.js'
import { h, esc, toast, bytes, confirmDialog, posterUrl } from '../util.js'
import { errorBox, skeletonStrip } from '../components.js'

// Title page: metadata, episode picker for series, and the list of streams the
// add-ons return — each one playable in the browser or downloadable to disk.
export default async function detail ({ params, container }) {
  const { type, id } = params
  container.innerHTML = '<div id="detail"></div>'
  const root = container.querySelector('#detail')
  root.append(h('<div class="hero" style="min-height:320px"><div class="poster-lg skeleton"></div><div class="info"><div class="skeleton" style="height:38px;width:320px"></div></div></div>'))

  let meta
  try {
    meta = await api.meta(type, id)
  } catch (err) {
    root.innerHTML = '<div class="pad"></div>'
    return root.querySelector('.pad').append(errorBox(err.message))
  }
  root.innerHTML = ''

  const state = {
    videoId: id,          // what we ask add-ons for streams about
    season: null,
    episode: null,
    label: meta.name
  }

  root.append(hero(meta, state))

  const body = h('<div class="pad"></div>')
  root.append(body)

  const streamsSection = h('<div></div>')

  if (type === 'series' && Array.isArray(meta.videos) && meta.videos.length) {
    const episodes = renderEpisodes(meta, state, () => loadStreams())
    body.append(episodes)
  }

  body.append(streamsSection)
  await loadStreams()

  if (Array.isArray(meta.videos) && !meta.videos.length && meta.trailers?.length) {
    body.append(h('<p class="muted tiny">This title has trailers only.</p>'))
  }

  async function loadStreams () {
    streamsSection.innerHTML = ''
    streamsSection.append(h(`<div class="section-title"><h2>Streams</h2><span class="count">${esc(state.label || meta.name)}</span></div>`))
    const loading = skeletonStrip(1)
    streamsSection.append(loading)
    try {
      const streams = await api.streams(type, state.videoId)
      loading.remove()
      if (!streams.length) {
        streamsSection.append(h(`
          <div class="empty" style="padding:36px">
            <h2>No streams</h2>
            <p>None of your installed add-ons returned a source for this title.<br>
            Stream add-ons are what supply sources — install one, or paste a magnet link on the
            <a href="#/downloads" style="color:#a48dff">Downloads</a> page.</p>
            <a class="btn primary" href="#/addons">Manage add-ons</a>
          </div>`))
        return
      }
      const list = h('<div class="stream-list"></div>')
      streams.forEach(stream => list.append(streamRow(stream, { type, meta, state })))
      streamsSection.append(list)
    } catch (err) {
      loading.remove()
      streamsSection.append(errorBox(err.message))
    }
  }
}

/* ------------------------------------------------------------------- hero */

function hero (meta, state) {
  const background = meta.background || meta.poster || ''
  const facts = [
    meta.releaseInfo || meta.year,
    meta.runtime,
    meta.genres?.slice(0, 3).join(', '),
    meta.country
  ].filter(Boolean)

  const node = h(`
    <div class="hero" style="${background ? `background-image:url('${esc(background)}')` : ''}">
      <div class="poster-lg" style="background-image:url('${esc(posterUrl(meta))}')"></div>
      <div class="info">
        <h1>${esc(meta.name)}</h1>
        <div class="facts">
          ${meta.imdbRating ? `<span class="rating">★ ${esc(meta.imdbRating)}</span>` : ''}
          ${facts.map(fact => `<span>${esc(fact)}</span>`).join('<span>·</span>')}
        </div>
        <p class="desc">${esc(meta.description || 'No description available.')}</p>
        ${meta.cast?.length ? `<p class="tiny muted">Cast: ${esc(meta.cast.slice(0, 5).join(', '))}</p>` : ''}
        ${meta.director?.length ? `<p class="tiny muted">Director: ${esc([].concat(meta.director).slice(0, 3).join(', '))}</p>` : ''}
        <div class="cta">
          <button class="btn primary" data-act="play">▶ Play</button>
          <button class="btn" data-act="save">＋ Add to library</button>
          ${meta.imdb_id ? `<a class="btn ghost" target="_blank" rel="noreferrer" href="https://www.imdb.com/title/${esc(meta.imdb_id)}/">IMDb</a>` : ''}
        </div>
      </div>
    </div>`)

  // "Play" on the hero is a shortcut for the first stream in the list.
  node.querySelector('[data-act="play"]').addEventListener('click', () => {
    const first = document.querySelector('.stream-list .stream [data-act="play"]')
    if (first) first.click()
    else toast('No stream is available yet for this title')
  })

  node.querySelector('[data-act="save"]').addEventListener('click', async event => {
    try {
      await api.addToLibrary({
        id: meta.id,
        type: meta.type,
        name: meta.name,
        poster: meta.poster,
        background: meta.background,
        releaseInfo: meta.releaseInfo || meta.year
      })
      event.target.textContent = '✓ In library'
      event.target.disabled = true
      toast(`${meta.name} added to your library`, 'ok')
    } catch (err) {
      toast(err.message, 'err')
    }
  })

  return node
}

/* --------------------------------------------------------------- episodes */

function renderEpisodes (meta, state, onPick) {
  const wrap = h('<div></div>')
  const videos = meta.videos.filter(video => video.season !== 0 || meta.videos.every(entry => entry.season === 0))
  const seasons = [...new Set(videos.map(video => video.season))].sort((a, b) => a - b)

  state.season = seasons[0]
  const seasonRow = h('<div class="row wrap" style="margin:18px 0 6px"></div>')
  const list = h('<div class="stream-list"></div>')

  function drawEpisodes () {
    list.innerHTML = ''
    videos.filter(video => video.season === state.season).forEach(video => {
      const active = state.videoId === video.id
      const row = h(`
        <div class="stream" style="${active ? 'border-color:rgba(123,91,245,.6);background:rgba(123,91,245,.08)' : ''}">
          <div class="tag">E${esc(video.episode)}</div>
          <div class="body">
            <div class="name">${esc(video.name || video.title || `Episode ${video.episode}`)}</div>
            <div class="detail">${esc(video.released ? new Date(video.released).toLocaleDateString() : '')}${video.overview ? ` — ${esc(video.overview.slice(0, 160))}` : ''}</div>
          </div>
          <div class="actions"><button class="btn small ${active ? 'primary' : ''}">${active ? 'Selected' : 'Streams'}</button></div>
        </div>`)
      row.querySelector('button').addEventListener('click', () => {
        state.videoId = video.id
        state.season = video.season
        state.episode = video.episode
        state.label = `S${video.season}E${video.episode} · ${video.name || ''}`
        drawEpisodes()
        onPick()
      })
      list.append(row)
    })
  }

  function drawSeasons () {
    seasonRow.innerHTML = ''
    seasons.forEach(season => {
      const chip = h(`<button class="chip ${season === state.season ? 'active' : ''}">${season === 0 ? 'Specials' : `Season ${season}`}</button>`)
      chip.addEventListener('click', () => {
        state.season = season
        drawSeasons()
        drawEpisodes()
      })
      seasonRow.append(chip)
    })
  }

  wrap.append(h('<div class="section-title"><h2>Episodes</h2></div>'), seasonRow, list)
  drawSeasons()
  drawEpisodes()
  return wrap
}

/* ---------------------------------------------------------------- streams */

// Add-ons put the human-readable source description in `title` (or `name`);
// the quality tag is the first line, the rest is seeds / size / group info.
function streamRow (stream, { type, meta, state }) {
  const label = stream.name || stream.title || stream.description || 'Stream'
  const lines = String(stream.title || stream.description || '').split('\n').filter(Boolean)
  const tag = (stream.name || '').split('\n')[0] || (stream.torrent ? 'Torrent' : 'Direct')

  const row = h(`
    <div class="stream">
      <div class="tag">${esc(tag.slice(0, 12))}</div>
      <div class="body">
        <div class="name">${esc(lines[0] || label)}</div>
        <div class="detail">${esc(lines.slice(1).join(' · ') || stream.addonName || '')}</div>
      </div>
      <div class="actions">
        <button class="btn primary small" data-act="play">▶ Play</button>
        ${stream.downloadable ? '<button class="btn small" data-act="download">⭳ Download</button>' : ''}
        <button class="btn small icon ghost" data-act="more" title="More">⋯</button>
      </div>
    </div>`)

  const playbackMeta = {
    title: `${meta.name}${state.episode ? ` S${state.season}E${state.episode}` : ''}`,
    poster: meta.poster,
    type,
    imdbId: meta.imdb_id || meta.id,
    videoId: state.videoId,
    season: state.season,
    episode: state.episode
  }

  row.querySelector('[data-act="play"]').addEventListener('click', async event => {
    const button = event.currentTarget
    button.disabled = true
    button.textContent = 'Starting…'
    try {
      if (stream.infoHash) {
        const record = await api.addTorrent({
          infoHash: stream.infoHash,
          sources: stream.sources || [],
          fileIdx: stream.fileIdx ?? null,
          mode: 'stream',
          meta: playbackMeta
        })
        location.hash = `#/player/torrent/${record.id}?fileIdx=${stream.fileIdx ?? ''}&meta=${encodeURIComponent(JSON.stringify(playbackMeta))}`
      } else if (stream.url) {
        location.hash = `#/player/direct/x?src=${encodeURIComponent(stream.url)}&meta=${encodeURIComponent(JSON.stringify(playbackMeta))}`
      } else if (stream.externalUrl) {
        window.open(stream.externalUrl, '_blank', 'noreferrer')
      } else {
        toast('This stream has nothing playable attached', 'err')
      }
    } catch (err) {
      toast(err.message, 'err')
    } finally {
      button.disabled = false
      button.textContent = '▶ Play'
    }
  })

  row.querySelector('[data-act="download"]')?.addEventListener('click', async event => {
    const button = event.currentTarget
    button.disabled = true
    button.textContent = 'Queued'
    try {
      await api.addTorrent({
        infoHash: stream.infoHash,
        sources: stream.sources || [],
        fileIdx: stream.fileIdx ?? null,
        mode: 'download',
        meta: playbackMeta
      })
      toast(`Downloading “${playbackMeta.title}” — see the Downloads tab`, 'ok')
    } catch (err) {
      toast(err.message, 'err')
      button.disabled = false
      button.textContent = '⭳ Download'
    }
  })

  row.querySelector('[data-act="more"]').addEventListener('click', async () => {
    const magnet = stream.infoHash
      ? `magnet:?xt=urn:btih:${stream.infoHash}${(stream.sources || []).filter(source => source.startsWith('tracker:')).map(source => `&tr=${encodeURIComponent(source.slice(8))}`).join('')}`
      : ''
    const localUrl = stream.infoHash ? `${location.origin}/api/stream/${stream.infoHash}${stream.fileIdx != null ? `/${stream.fileIdx}` : ''}` : stream.url || ''
    await confirmDialog({
      title: 'Stream details',
      confirmLabel: 'Close',
      body: `
        <div><b>Source</b><div class="muted tiny">${esc(stream.addonName || 'unknown add-on')}</div></div>
        <div><b>Description</b><div class="muted tiny" style="white-space:pre-wrap">${esc(stream.title || stream.name || '')}</div></div>
        ${magnet ? `<div><b>Magnet</b><textarea class="field mono tiny" rows="3" readonly>${esc(magnet)}</textarea></div>` : ''}
        ${localUrl ? `<div><b>Play in VLC / another player</b><textarea class="field mono tiny" rows="2" readonly>${esc(localUrl)}</textarea></div>` : ''}
        ${stream.behaviorHints?.videoSize ? `<div class="muted tiny">Size: ${esc(bytes(stream.behaviorHints.videoSize))}</div>` : ''}`
    })
  })

  return row
}
