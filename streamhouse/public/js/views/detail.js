import { api } from '../api.js'
import { h, esc, toast, bytes, confirmDialog, posterUrl, percent } from '../util.js'
import { errorBox, skeletonStrip, resumeHref } from '../components.js'
import { castButton } from '../cast.js'
import { upNext, episodeOrder, isReleased, episodeLabel } from '../watching.js'

// Title page: metadata, episode picker for series, and the list of streams the
// add-ons return — each one playable in the browser or downloadable to disk.
//
// Like Netflix and Stremio, it knows where you are: a series opens on the
// episode you are up to, and the big button says what it will do — resume,
// play the next one, or when the next one airs.
export default async function detail ({ params, query = {}, container }) {
  const { type, id } = params
  container.innerHTML = '<div id="detail"></div>'
  const root = container.querySelector('#detail')
  root.append(h('<div class="hero" style="min-height:320px"><div class="poster-lg skeleton"></div><div class="info"><div class="skeleton" style="height:38px;width:320px"></div></div></div>'))

  let meta
  // Neither of these is worth failing the page over.
  const progressLoad = api.progress().catch(() => ({}))
  const libraryLoad = api.library().catch(() => [])
  const downloadsLoad = api.torrents().then(data => data.torrents.filter(torrent => torrent.mode === 'download')).catch(() => [])
  try {
    meta = await api.meta(type, id)
  } catch (err) {
    root.innerHTML = '<div class="pad"></div>'
    return root.querySelector('.pad').append(errorBox(err.message))
  }
  const [progress, library, downloads] = await Promise.all([progressLoad, libraryLoad, downloadsLoad])
  // What was downloaded for a given film or episode, most complete first.
  const onDisk = videoId => downloads
    .filter(torrent => torrent.meta?.videoId === videoId && torrent.status !== 'error')
    .sort((a, b) => b.progress - a.progress)
  root.innerHTML = ''

  const state = {
    videoId: id,          // what we ask add-ons for streams about
    season: null,
    episode: null,
    label: meta.name,
    streamsFor: null      // the video the stream list below was loaded for
  }

  const isSeries = type === 'series' && Array.isArray(meta.videos) && meta.videos.length > 0
  const next = isSeries ? upNext(meta.videos, progress) : null
  // An episode not out yet has no streams to list: show the latest one that is.
  if (next) choose(state, next.action === 'upcoming' ? episodeOrder(meta.videos).filter(video => isReleased(video)).pop() : next.video)
  let primary = primaryAction({ meta, next, progress, id })

  const streamsSection = h('<div></div>')
  let episodes = null
  const heroNode = hero(meta, {
    inLibrary: library.some(item => item.id === meta.id),
    primary,
    play: async ({ fromStart = false } = {}) => {
      const action = primary
      state.fromStart = fromStart
      if (action.href && !fromStart) return (location.hash = action.href)
      if (action.video && state.streamsFor !== action.video.id) {
        episodes?.select(action.video)
        await loadStreams()
      }
      const first = streamsSection.querySelector('.stream-list .stream:not([hidden]) [data-act="play"]')
      if (first) first.click()
      else toast('No stream is available yet for this title')
    }
  })
  root.append(heroNode)

  const body = h('<div class="pad"></div>')
  root.append(body)

  if (isSeries) {
    // A tick set by hand moves the big button on, as it does on Netflix.
    episodes = renderEpisodes(meta, state, progress, onDisk, () => loadStreams(), () => {
      primary = primaryAction({ meta, next: upNext(meta.videos, progress), progress, id })
      heroNode.setPrimary(primary)
    })
    body.append(episodes.node)
  }

  body.append(streamsSection)
  await loadStreams()

  // Arrived from the home billboard's Play: start what the big button offers.
  // The hint comes off the address first, or coming back from the player
  // would start it all over again.
  if (query.play === '1') {
    history.replaceState(null, '', `#/detail/${encodeURIComponent(type)}/${encodeURIComponent(id)}`)
    if (!primary.disabled && location.hash.startsWith('#/detail/')) heroNode.querySelector('[data-act="play"]').click()
  }

  if (Array.isArray(meta.videos) && !meta.videos.length && meta.trailers?.length) {
    body.append(h('<p class="muted tiny">This title has trailers only.</p>'))
  }

  async function loadStreams () {
    const videoId = state.videoId
    state.streamsFor = videoId
    streamsSection.innerHTML = ''
    streamsSection.append(h(`<div class="section-title"><h2>Streams</h2><span class="count">${esc(state.label || meta.name)}</span></div>`))
    const loading = skeletonStrip(1)
    streamsSection.append(loading)
    try {
      const streams = await api.streams(type, videoId)
      // Another episode was picked while these were on their way.
      if (state.streamsFor !== videoId) return
      loading.remove()
      if (!streams.length) {
        const local = localRows(onDisk(videoId), state)
        if (local) return streamsSection.append(local)
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
      // The server ranked them; say so, so the order does not look arbitrary.
      const counted = streamsSection.querySelector('.count')
      const rejected = streams.filter(stream => stream.rejections?.length).length
      if (counted && streams[0]?.profile) {
        counted.innerHTML = `${esc(state.label || meta.name)} · best first for your <a href="#/settings">${esc(streams[0].profile)}</a> profile${rejected ? ` · ${rejected} below the line` : ''}`
      }
      const list = h('<div class="stream-list"></div>')
      streams.forEach(stream => list.append(streamRow(stream, { type, meta, state })))
      const local = localRows(onDisk(videoId), state)
      if (local) streamsSection.append(local)
      const { bar, more } = narrowing(streams, list)
      streamsSection.append(bar, list, more)
    } catch (err) {
      if (state.streamsFor !== videoId) return
      loading.remove()
      streamsSection.append(errorBox(err.message))
    }
  }
}

// Point the page at one episode: the streams below are for it from now on.
function choose (state, video) {
  state.videoId = video.id
  state.season = video.season
  state.episode = video.episode
  state.label = `S${video.season}E${video.episode} · ${video.name || video.title || ''}`
}

const minutesLeft = entry => entry.duration > 0 ? Math.max(1, Math.round((entry.duration - entry.time) / 60)) : 0
const airDate = video => new Date(video.released).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

// What the big button does, and says. `href` resumes the exact file that was
// playing; `video` plays the best stream for that episode.
function primaryAction ({ meta, next, progress, id }) {
  if (!next) {
    if (meta.type === 'series' && meta.videos?.length) return { label: 'Nothing has aired yet', disabled: true }
    const entry = progress[id] || progress[meta.imdb_id]
    if (entry?.time > 0) {
      const left = minutesLeft(entry)
      return {
        label: `▶ Resume${left ? ` · ${left} min left` : ''}`,
        href: entry.meta?.playback ? resumeHref(entry) : null,
        resume: true
      }
    }
    return { label: entry?.watched ? '▶ Watch again' : '▶ Play' }
  }
  const label = episodeLabel(next.video)
  if (next.action === 'resume') {
    const left = minutesLeft(next.entry)
    return {
      label: `▶ Resume ${label}${left ? ` · ${left} min left` : ''}`,
      href: next.entry.meta?.playback ? resumeHref(next.entry) : null,
      video: next.video,
      resume: true
    }
  }
  if (next.action === 'upcoming') return { label: `${label} airs ${airDate(next.video)}`, disabled: true }
  if (next.action === 'again') return { label: `▶ Watch again from ${label}`, video: next.video }
  return { label: `▶ Play ${label}`, video: next.video }
}

// A trailer, where the add-on gave one: YouTube ids, in either of the two
// shapes Stremio's metadata uses.
function trailerId (meta) {
  const fromStreams = (meta.trailerStreams || []).find(trailer => trailer?.ytId)?.ytId
  const fromTrailers = (meta.trailers || []).find(trailer => trailer?.source && (!trailer.type || trailer.type === 'Trailer'))?.source
  const found = fromStreams || fromTrailers || ''
  return /^[\w-]{6,20}$/.test(found) ? found : ''
}

/* ------------------------------------------------------------------- hero */

function hero (meta, { inLibrary, primary, play }) {
  const background = meta.background || meta.poster || ''
  const facts = [
    meta.releaseInfo || meta.year,
    meta.runtime,
    meta.genres?.slice(0, 3).join(', '),
    meta.country
  ].filter(Boolean)
  const trailer = trailerId(meta)

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
          <button class="btn primary" data-act="play" ${primary.disabled ? 'disabled' : ''}>${esc(primary.label)}</button>
          <button class="btn" data-act="restart" ${primary.resume ? '' : 'hidden'} title="Play from the beginning">↺ Start over</button>
          <button class="btn" data-act="save">${inLibrary ? '✓ In library' : '＋ Add to library'}</button>
          ${trailer ? `<a class="btn ghost" target="_blank" rel="noreferrer" href="https://www.youtube.com/watch?v=${esc(trailer)}">Trailer</a>` : ''}
          ${meta.imdb_id ? `<a class="btn ghost" target="_blank" rel="noreferrer" href="https://www.imdb.com/title/${esc(meta.imdb_id)}/">IMDb</a>` : ''}
        </div>
      </div>
    </div>`)

  const playButton = node.querySelector('[data-act="play"]')
  playButton.addEventListener('click', () => play())
  // Netflix's "Play from beginning", beside a resume.
  const restartButton = node.querySelector('[data-act="restart"]')
  restartButton.addEventListener('click', () => play({ fromStart: true }))
  node.setPrimary = action => {
    playButton.textContent = action.label
    playButton.disabled = Boolean(action.disabled)
    restartButton.hidden = !action.resume
  }

  // A toggle, as My List is: the button says whether it is saved, and undoes.
  const save = node.querySelector('[data-act="save"]')
  save.addEventListener('click', async () => {
    save.disabled = true
    try {
      if (inLibrary) {
        await api.removeFromLibrary(meta.id)
        toast(`${meta.name} removed from your library`, 'ok')
      } else {
        await api.addToLibrary({
          id: meta.id,
          type: meta.type,
          name: meta.name,
          poster: meta.poster,
          background: meta.background,
          releaseInfo: meta.releaseInfo || meta.year
        })
        toast(`${meta.name} added to your library`, 'ok')
      }
      inLibrary = !inLibrary
      save.textContent = inLibrary ? '✓ In library' : '＋ Add to library'
    } catch (err) {
      toast(err.message, 'err')
    } finally {
      save.disabled = false
    }
  })

  return node
}

/* --------------------------------------------------------------- episodes */

// The episode list, Netflix-style: a tick on what has been watched, a bar on
// what is part-way through, the air date on what is not out yet — and a way
// to mark an episode watched by hand, as Stremio has.
function renderEpisodes (meta, state, progress, onDisk, onPick, onWatched) {
  const wrap = h('<div></div>')
  const videos = episodeOrder(meta.videos)
  const seasons = [...new Set(videos.map(video => video.season))]

  if (state.season === null || !seasons.includes(state.season)) state.season = seasons[0]
  const seasonRow = h('<div class="row wrap" style="margin:18px 0 6px"></div>')
  const list = h('<div class="stream-list episodes"></div>')

  function drawEpisodes () {
    list.innerHTML = ''
    videos.filter(video => video.season === state.season).forEach(video => {
      const active = state.videoId === video.id
      const entry = progress[video.id]
      const aired = isReleased(video)
      const watched = Boolean(entry?.watched)
      const partway = entry?.time > 0 && entry.duration > 0 ? entry.time / entry.duration : 0
      const when = video.released ? (aired ? new Date(video.released).toLocaleDateString() : `Airs ${airDate(video)}`) : ''
      const row = h(`
        <div class="stream episode${active ? ' active' : ''}${aired ? '' : ' unaired'}">
          <div class="tag">${watched ? '✓ ' : ''}E${esc(video.episode)}</div>
          <div class="body">
            <div class="name">${esc(video.name || video.title || `Episode ${video.episode}`)}</div>
            <div class="detail">${onDisk(video.id).some(torrent => torrent.progress >= 1) ? '<span class="on-disk">⭳ On disk</span> ' : ''}${esc(when)}${video.overview ? ` — ${esc(video.overview.slice(0, 160))}` : ''}</div>
            ${partway ? `<div class="ep-progress"><i style="width:${percent(partway)}"></i></div>` : ''}
          </div>
          <div class="actions">
            ${aired ? `<button class="btn small ghost" data-act="watched" title="${watched ? 'Mark as not watched' : 'Mark as watched'}">${watched ? '✓ Watched' : 'Mark watched'}</button>` : ''}
            <button class="btn small ${active ? 'primary' : ''}" data-act="pick" ${aired ? '' : 'disabled'}>${active ? 'Selected' : 'Streams'}</button>
          </div>
        </div>`)
      row.querySelector('[data-act="pick"]').addEventListener('click', () => select(video))
      row.querySelector('[data-act="watched"]')?.addEventListener('click', async event => {
        const button = event.currentTarget
        button.disabled = true
        try {
          record(await api.setWatched({ id: video.id, watched: !watched, meta: episodeMeta(video) }))
          drawSeasons()
          drawEpisodes()
          onWatched()
        } catch (err) {
          toast(err.message, 'err')
          button.disabled = false
        }
      })
      list.append(row)
    })
  }

  // What an episode's progress entry carries, so continue watching can name it.
  function episodeMeta (video) {
    return {
      title: `${meta.name} S${video.season}E${video.episode}`,
      name: `${meta.name} S${video.season}E${video.episode}`,
      poster: meta.poster,
      type: 'series',
      id: meta.imdb_id || meta.id,
      imdbId: meta.imdb_id || meta.id,
      videoId: video.id,
      season: video.season,
      episode: video.episode
    }
  }
  function record (result) {
    if (result.cleared) delete progress[result.id]
    else progress[result.id] = result
  }
  const airedIn = season => videos.filter(video => video.season === season && isReleased(video))
  const seasonDone = season => airedIn(season).length > 0 && airedIn(season).every(video => progress[video.id]?.watched)

  function drawSeasons () {
    seasonRow.innerHTML = ''
    seasons.forEach(season => {
      const chip = h(`<button class="chip ${season === state.season ? 'active' : ''}">${seasonDone(season) ? '✓ ' : ''}${season === 0 ? 'Specials' : `Season ${season}`}</button>`)
      chip.addEventListener('click', () => {
        state.season = season
        drawSeasons()
        drawEpisodes()
      })
      seasonRow.append(chip)
    })
    // Stremio's "mark season as watched", and its undo once it is.
    const done = seasonDone(state.season)
    if (!airedIn(state.season).length) return
    const toggle = h(`<button class="btn small ghost season-mark">${done ? 'Mark season unwatched' : 'Mark season watched'}</button>`)
    toggle.addEventListener('click', async () => {
      toggle.disabled = true
      try {
        const results = await api.setWatched({
          watched: !done,
          items: airedIn(state.season).map(video => ({ id: video.id, meta: episodeMeta(video) }))
        })
        results.forEach(record)
        drawSeasons()
        drawEpisodes()
        onWatched()
      } catch (err) {
        toast(err.message, 'err')
        toggle.disabled = false
      }
    })
    seasonRow.append(toggle)
  }

  function select (video, { load = true } = {}) {
    choose(state, video)
    drawSeasons()
    drawEpisodes()
    if (load) onPick()
  }

  wrap.append(h('<div class="section-title"><h2>Episodes</h2></div>'), seasonRow, list)
  drawSeasons()
  drawEpisodes()
  return { node: wrap, select: video => select(video, { load: false }) }
}

/* ---------------------------------------------------------------- streams */

// Copies already downloaded, above the add-ons' streams — the big Play button
// takes the first row, so a finished download is what plays, as Netflix plays
// a downloaded episode rather than streaming it again. One still downloading
// can be watched while it finishes.
function localRows (copies, state) {
  if (!copies.length) return null
  const list = h('<div class="stream-list local-list"></div>')
  for (const copy of copies.slice(0, 2)) {
    const done = copy.progress >= 1
    const fileIdx = copy.fileIdx ?? copy.playableIndex ?? ''
    const row = h(`
      <div class="stream best local">
        <div class="tag">${done ? 'On disk' : esc(`${Math.floor(copy.progress * 100)}%`)}</div>
        <div class="body">
          <div class="name">${esc(copy.name)}</div>
          <div class="detail">${done ? 'Downloaded to this computer — plays without the internet' : 'Downloading — plays while it finishes'} · ${esc(bytes(copy.length))}</div>
        </div>
        <div class="actions"><button class="btn primary small" data-act="play">▶ Play</button></div>
      </div>`)
    row.querySelector('[data-act="play"]').addEventListener('click', () => {
      const from = state.fromStart ? '&from=start' : ''
      state.fromStart = false
      location.hash = `#/player/torrent/${encodeURIComponent(copy.id)}?fileIdx=${fileIdx}&meta=${encodeURIComponent(JSON.stringify(copy.meta || {}))}${from}`
    })
    list.append(row)
  }
  return list
}

const FIRST_STREAMS = 10
const RESOLUTION_ORDER = ['2160p', '1440p', '1080p', '720p', '576p', '480p', '360p']

// A stream add-on can answer with fifty rows. As Stremio does, they can be
// narrowed to one resolution, and only the best ten show until asked — the
// list is ranked, so the rest are the ones least likely to be wanted, and a
// TV remote should not have to scroll past them.
function narrowing (streams, list) {
  const rows = [...list.children]
  const resolutionOf = stream => stream.quality?.resolution || ''
  const present = [...new Set(streams.map(resolutionOf).filter(Boolean))]
    .sort((a, b) => (RESOLUTION_ORDER.indexOf(a) + 1 || 99) - (RESOLUTION_ORDER.indexOf(b) + 1 || 99))
  const bar = h('<div class="row wrap stream-filters"></div>')
  const view = { resolution: '', all: false }
  const more = h('<button class="btn small ghost show-all"></button>')

  function apply () {
    let shown = 0
    let matching = 0
    rows.forEach((row, index) => {
      const fits = !view.resolution || resolutionOf(streams[index]) === view.resolution
      if (fits) matching += 1
      const show = fits && (view.all || shown < FIRST_STREAMS)
      if (show) shown += 1
      row.hidden = !show
    })
    more.hidden = view.all || matching <= FIRST_STREAMS
    more.textContent = `Show all ${matching} streams`
    bar.querySelectorAll('.chip').forEach(chip => chip.classList.toggle('active', chip.dataset.resolution === view.resolution))
  }

  if (present.length > 1) {
    for (const resolution of ['', ...present]) {
      const count = resolution ? streams.filter(stream => resolutionOf(stream) === resolution).length : streams.length
      const chip = h(`<button class="chip" data-resolution="${esc(resolution)}">${esc(resolution || 'All')} <span class="muted tiny">${count}</span></button>`)
      chip.addEventListener('click', () => { view.resolution = resolution; view.all = false; apply() })
      bar.append(chip)
    }
  }
  more.addEventListener('click', () => { view.all = true; apply() })
  apply()
  return { bar, more }
}

// What the parser found, as chips. Only what it is sure about: an add-on that
// says nothing useful gets no badges rather than a row of "unknown".
function badges (quality) {
  const list = []
  if (quality.sourceLabel) list.push({ text: quality.sourceLabel, kind: quality.source === 'cam' ? 'bad' : '' })
  if (quality.codecLabel) list.push({ text: quality.codecLabel })
  if (quality.dynamicRange) list.push({ text: quality.dynamicRange.toUpperCase() })
  if (quality.audioLabel) list.push({ text: `${quality.audioLabel}${quality.channels ? ` ${quality.channels}` : ''}` })
  if (quality.proper) list.push({ text: 'PROPER', kind: 'good' })
  if (quality.repack) list.push({ text: 'REPACK', kind: 'good' })
  if (quality.edition) list.push({ text: quality.edition })
  if (quality.seasonPack) list.push({ text: 'Season pack' })
  if (quality.size) list.push({ text: bytes(quality.size) })
  if (quality.seeders != null) list.push({ text: `${quality.seeders} seeders`, kind: quality.seeders > 0 ? 'good' : 'bad' })
  if (quality.group) list.push({ text: quality.group, kind: 'ghost' })
  return list
}

// The server has already parsed the release name and sorted the list, so a row
// is mostly about showing what it found: quality first, then the details that
// decide whether the thing will actually play.
function streamRow (stream, { type, meta, state }) {
  const label = stream.name || stream.title || stream.description || 'Stream'
  const lines = String(stream.title || stream.description || '').split('\n').filter(Boolean)
  const quality = stream.quality || {}
  const rejected = stream.rejections?.length ? stream.rejections[0] : ''
  const tag = quality.resolution || quality.sourceLabel || (stream.name || '').split('\n')[0] || (stream.torrent ? 'Torrent' : 'Direct')
  const chips = badges(quality)

  const row = h(`
    <div class="stream ${stream.best ? 'best' : ''} ${rejected ? 'rejected' : ''}">
      <div class="tag">${esc(tag.slice(0, 12))}</div>
      <div class="body">
        <div class="name">${stream.best ? '<span class="pick">★ Best</span> ' : ''}${esc(lines[0] || label)}</div>
        ${chips.length ? `<div class="badges">${chips.map(badge => `<span class="badge ${esc(badge.kind || '')}">${esc(badge.text)}</span>`).join('')}</div>` : ''}
        <div class="detail">${rejected ? `<span class="warn">${esc(rejected)}</span> · ` : ''}${esc(stream.addonName || lines.slice(1).join(' · '))}</div>
      </div>
      <div class="actions">
        <button class="btn primary small" data-act="play">▶ Play</button>
        ${stream.downloadable ? '<button class="btn small" data-act="download">⭳ Download</button>' : ''}
        <span data-slot="cast"></span>
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

  // Casting needs the torrent running locally first, so the TV has something
  // to pull from; adding it is idempotent.
  row.querySelector('[data-slot="cast"]').append(castButton(async () => {
    if (stream.infoHash) {
      const record = await api.addTorrent({
        infoHash: stream.infoHash,
        sources: stream.sources || [],
        fileIdx: stream.fileIdx ?? null,
        mode: 'stream',
        meta: playbackMeta
      })
      return { torrentId: record.id, fileIdx: stream.fileIdx ?? null, title: playbackMeta.title }
    }
    return { url: stream.url, title: playbackMeta.title }
  }))

  // Asked for once, by the Start over button, then forgotten.
  const fromStart = () => {
    const asked = state.fromStart
    state.fromStart = false
    return asked ? '&from=start' : ''
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
        location.hash = `#/player/torrent/${record.id}?fileIdx=${stream.fileIdx ?? ''}&meta=${encodeURIComponent(JSON.stringify(playbackMeta))}${fromStart()}`
      } else if (stream.url) {
        location.hash = `#/player/direct/x?src=${encodeURIComponent(stream.url)}&meta=${encodeURIComponent(JSON.stringify(playbackMeta))}${fromStart()}`
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
    // The score breakdown: why this row sits where it does, rather than a
    // number the user is expected to take on faith.
    const reasons = (stream.scoreReasons || [])
      .map(reason => `<div class="row" style="justify-content:space-between"><span>${esc(reason.label)}</span><b class="${reason.delta > 0 ? 'up' : 'down'}">${reason.delta > 0 ? '+' : ''}${esc(reason.delta)}</b></div>`)
      .join('')

    await confirmDialog({
      title: 'Stream details',
      confirmLabel: 'Close',
      body: `
        <div><b>Source</b><div class="muted tiny">${esc(stream.addonName || 'unknown add-on')}</div></div>
        ${stream.quality ? `<div><b>Parsed as</b><div class="muted tiny">${esc(stream.quality.label)}${stream.quality.group ? ` · ${esc(stream.quality.group)}` : ''}${stream.quality.provider ? ` · ${esc(stream.quality.provider)}` : ''}</div></div>` : ''}
        ${reasons ? `<div><b>Ranking (${esc(stream.profile || '')} profile) — score ${esc(stream.score)}</b><div class="tiny score-breakdown">${reasons}</div></div>` : ''}
        ${stream.rejections?.length ? `<div><b>Why it is at the bottom</b><div class="muted tiny">${esc(stream.rejections.join(' · '))}</div></div>` : ''}
        <div><b>Description</b><div class="muted tiny" style="white-space:pre-wrap">${esc(stream.title || stream.name || '')}</div></div>
        ${magnet ? `<div><b>Magnet</b><textarea class="field mono tiny" rows="3" readonly>${esc(magnet)}</textarea></div>` : ''}
        ${localUrl ? `<div><b>Play in VLC / another player</b><textarea class="field mono tiny" rows="2" readonly>${esc(localUrl)}</textarea></div>` : ''}
        ${stream.behaviorHints?.videoSize ? `<div class="muted tiny">Size: ${esc(bytes(stream.behaviorHints.videoSize))}</div>` : ''}`
    })
  })

  return row
}
