import { api } from '../api.js'
import { h, esc, clock, toast, bytes } from '../util.js'
import { castPicker } from '../cast.js'
import { nextEpisode, episodeHref } from '../playback.js'

// Full-screen video player. Torrent playback streams from the local engine
// over HTTP byte ranges, so seeking works while the file is still downloading.
export default async function player ({ params, query, container }) {
  container.innerHTML = ''
  const kind = params.kind
  let meta = {}
  try {
    meta = query.meta ? JSON.parse(query.meta) : {}
  } catch {
    // Older continue-watching links carried the bare progress id here rather
    // than the metadata object, so keep them working instead of losing both
    // the title and the position they point at.
    meta = query.meta ? { videoId: query.meta } : {}
  }
  if (!meta.title && query.title) meta.title = query.title

  // The title page to fall back to when the saved stream cannot be started
  // again — its sources may have gone away since it was watched.
  const detailId = meta.imdbId || meta.videoId || ''
  const detailHref = detailId
    ? `#/detail/${encodeURIComponent(meta.type || 'movie')}/${encodeURIComponent(detailId)}`
    : ''

  const root = h('<div class="player-wrap"><video playsinline></video></div>')
  const video = root.querySelector('video')
  document.getElementById('player-root').append(root)

  const overlayTop = h(`
    <div class="player-top">
      <button class="btn ghost icon" data-act="back" title="Back (Esc)">←</button>
      <div>
        <div style="font-weight:600" id="pl-title">${esc(meta.title || 'Playing')}</div>
        <div class="tiny muted" id="pl-sub"></div>
      </div>
      <div style="flex:1"></div>
      <button class="btn ghost small" data-act="next" hidden>⏭ Next episode</button>
      <button class="btn ghost small" data-act="cast">📺 Play on TV</button>
      <button class="btn ghost small" data-act="keep">⭳ Keep this file</button>
      <button class="btn ghost small" data-act="external">Open elsewhere</button>
    </div>`)

  const overlayBottom = h(`
    <div class="player-bottom">
      <div class="seek"><div class="buffered"></div><div class="played"></div><div class="knob" style="left:0"></div></div>
      <div class="player-controls">
        <button class="btn ghost icon" data-act="playpause">▶</button>
        <button class="btn ghost icon" data-act="back10" title="Back 10s">⟲</button>
        <button class="btn ghost icon" data-act="fwd30" title="Forward 30s">⟳</button>
        <span class="time"><span id="pl-cur">0:00</span> / <span id="pl-dur">0:00</span></span>
        <span class="grow"></span>
        <span class="tiny muted" id="pl-net"></span>
        <select class="field" id="pl-subs" style="width:auto;display:none"></select>
        <button class="btn ghost icon" data-act="mute">🔊</button>
        <input class="vol" type="range" min="0" max="1" step="0.05" value="1">
        <button class="btn ghost icon" data-act="fullscreen">⛶</button>
      </div>
    </div>`)

  const busy = h(`<div class="buffering"><div><div class="spinner"></div>
    <div id="pl-busy">${params.kind === 'torrent' ? 'Connecting to peers…' : 'Loading…'}</div></div></div>`)
  root.append(overlayTop, overlayBottom, busy)

  const state = { id: null, fileIdx: null, statsTimer: null, saveTimer: null, idleTimer: null, destroyed: false, leaving: false }

  // The on-screen furniture, as opposed to the picture behind it.
  const CHROME = '.player-top, .player-bottom, .upnext'

  /* -------------------------------------------------------- progress notes */

  // What continue watching needs to rebuild the tile: what this is, and which
  // file to reopen to carry on watching it.
  function progressMeta (key) {
    return {
      ...meta,
      name: meta.title || meta.name,
      id: meta.imdbId || meta.videoId || key,
      type: meta.type || 'movie',
      playback: state.id
        ? { infoHash: state.id, fileIdx: state.fileIdx }
        : (src ? { url: src } : null)
    }
  }

  // Record the entry before handing playback somewhere that only knows the id
  // it was given — the Android TV player posts a position back and nothing else,
  // so without this the shelf gets a nameless tile that resumes nothing.
  async function seedProgress (key, start, saved) {
    const duration = Number(saved?.duration) || 0
    if (duration > 0 && start / duration > 0.93) return
    try {
      await api.saveProgress({ id: key, time: Number(start) || 0, duration, meta: progressMeta(key) })
    } catch { /* progress saving is best-effort */ }
  }

  /* -------------------------------------------------------------- source */

  // Present only when running inside the StreamHouse Android TV app.
  const nativeTv = (() => {
    try {
      return window.StreamHouseTV?.isNativeTv?.() ? window.StreamHouseTV : null
    } catch {
      return null
    }
  })()

  let handedToNative = false
  let src = ''
  try {
    if (kind === 'torrent') {
      const info = await api.playback(params.id, query.fileIdx || undefined)
      state.id = info.id
      state.fileIdx = info.fileIdx
      src = info.streamUrl
      root.querySelector('#pl-title').textContent = meta.title || info.name
      root.querySelector('#pl-sub').textContent = `${info.name} · ${bytes(info.length)}`
      if (!info.browserPlayable) {
        toast('This file may not play in a browser — use “Open elsewhere” for VLC if it stalls')
      }
    } else {
      src = query.src || ''
      root.querySelector('#pl-sub').textContent = 'Direct stream'
    }
    if (!src) throw new Error('Nothing to play')

    // Inside the Android TV app, playback belongs to the native player:
    // ExoPlayer handles the MKV, H.265 and AC3 files a WebView will not touch.
    if (nativeTv) {
      const key = meta.videoId || meta.imdbId || state.id || src
      let saved = null
      try {
        saved = (await api.progress())[key] || null
      } catch { /* no saved position */ }
      const start = Number(query.t) || saved?.time || 0
      // The native player reports a bare id and position back, so write the
      // title, poster and stream down here — otherwise continue watching ends
      // up with an entry it can neither name nor resume.
      await seedProgress(key, start, saved)
      // The native player has no idea what a series is; note down what it was
      // handed so the page can queue the next episode when it comes back.
      try {
        sessionStorage.setItem('sh-native-playback', JSON.stringify(meta))
      } catch { /* private mode: no auto-advance, nothing worse */ }
      nativeTv.play(new URL(src, location.origin).toString(), meta.title || 'StreamHouse', start, String(key))
      handedToNative = true
    } else {
      video.src = src
    }
  } catch (err) {
    busy.innerHTML = `<div style="max-width:520px;text-align:center">
      <h2>Could not start playback</h2>
      <p class="muted">${esc(err.message)}</p>
      ${detailHref ? '<p class="muted tiny">The stream this was watched from may be gone. Pick another one and it will carry on from where it stopped.</p>' : ''}
      <div class="row" style="justify-content:center;margin-top:14px">
        <button class="btn" onclick="history.back()">Go back</button>
        ${detailHref ? `<a class="btn primary" href="${esc(detailHref)}">Pick another stream</a>` : ''}
      </div></div>`
    return { destroy: () => root.remove() }
  }

  // The native player took over: close this screen and go back to browsing.
  if (handedToNative) {
    root.remove()
    setTimeout(() => history.back(), 60)
    return { destroy () { root.remove() } }
  }

  /* ------------------------------------------------------------ playback */

  const progressKey = meta.videoId || meta.imdbId || state.id || src
  const resumeAt = Number(query.t) || 0
  let lastTime = -1

  const showBusy = () => { busy.hidden = false }
  // Once the file has failed to decode, `busy` holds that message rather than
  // the spinner, and nothing should take it away.
  const hideBusy = () => { if (!video.error) busy.hidden = true }

  video.volume = Number(localStorage.getItem('sh-volume') ?? 1)
  overlayBottom.querySelector('.vol').value = video.volume

  video.addEventListener('loadedmetadata', async () => {
    root.querySelector('#pl-dur').textContent = clock(video.duration)
    let start = resumeAt
    if (!start) {
      try {
        const all = await api.progress()
        const saved = all[progressKey]
        if (saved && saved.time > 30 && saved.time < (video.duration || Infinity) - 60) start = saved.time
      } catch { /* no saved position */ }
    }
    if (start) video.currentTime = start
    video.play().catch(() => {
      // Autoplay can be blocked; the play button still works.
      hideBusy()
    })
  })

  video.addEventListener('waiting', showBusy)
  video.addEventListener('playing', hideBusy)
  video.addEventListener('canplay', hideBusy)
  // A seek can fire `waiting` without ever stalling; `seeked` is the answer.
  video.addEventListener('seeked', hideBusy)
  video.addEventListener('play', () => { overlayBottom.querySelector('[data-act="playpause"]').textContent = '⏸' })
  video.addEventListener('pause', () => { overlayBottom.querySelector('[data-act="playpause"]').textContent = '▶' })

  video.addEventListener('error', () => {
    busy.hidden = false
    busy.innerHTML = `<div style="max-width:560px;text-align:center">
      <h2>This browser cannot decode the file</h2>
      <p class="muted">It is still downloading in the background. Copy the link below into VLC, IINA or MPV to watch it now — or open it from the Downloads folder once it finishes.</p>
      <textarea class="field mono tiny" rows="2" readonly>${esc(location.origin + src)}</textarea>
      <div class="row" style="justify-content:center;margin-top:14px">
        <button class="btn" id="pl-copy">Copy link</button>
        <a class="btn primary" href="#/downloads">Open downloads</a>
      </div></div>`
    busy.querySelector('#pl-copy')?.addEventListener('click', () => {
      navigator.clipboard.writeText(location.origin + src).then(() => toast('Link copied', 'ok'))
    })
  })

  video.addEventListener('timeupdate', () => {
    // Whatever the events claimed, a clock that is moving is a stream that is
    // playing — so the spinner never outstays the stall it was reporting.
    if (video.currentTime !== lastTime) {
      lastTime = video.currentTime
      if (!video.paused) hideBusy()
    }
    root.querySelector('#pl-cur').textContent = clock(video.currentTime)
    if (upNext && autoPlayNext && !upNextDismissed && Number.isFinite(video.duration) &&
        video.duration > 120 && video.duration - video.currentTime <= 45) {
      offerUpNext()
    }
    const played = video.duration ? video.currentTime / video.duration : 0
    overlayBottom.querySelector('.played').style.width = `${played * 100}%`
    overlayBottom.querySelector('.knob').style.left = `${played * 100}%`
    if (video.buffered.length) {
      const end = video.buffered.end(video.buffered.length - 1)
      overlayBottom.querySelector('.buffered').style.width = `${(end / (video.duration || 1)) * 100}%`
    }
  })

  video.addEventListener('ended', async () => {
    if (upNext && autoPlayNext) return playNext({ finished: true })
    await saveProgress(true)
    history.back()
  })

  /* ------------------------------------------------------------- up next */

  // What follows this episode, once an add-on has told us. Everything here is
  // best-effort: a series with no next episode, or no add-on that knows the
  // series, simply leaves the button and the panel out.
  let upNext = null
  let upNextDismissed = false
  const nextButton = overlayTop.querySelector('[data-act="next"]')

  // Carrying on by itself is a setting; offering the next episode at all is not,
  // so the button appears either way.
  let autoPlayNext = true
  api.getConfig().then(config => { autoPlayNext = config.autoPlayNextEpisode !== false }).catch(() => {})

  if (meta.type === 'series') {
    nextEpisode(meta).then(found => {
      if (!found || state.destroyed) return
      upNext = found
      nextButton.hidden = false
      nextButton.textContent = `⏭ Next: ${found.label}`
    }).catch(() => { /* nothing queued up, and that is fine */ })
  }

  const panel = h('<div class="upnext" hidden></div>')
  root.append(panel)
  let countdown = null

  function hideUpNext () {
    clearInterval(countdown)
    countdown = null
    panel.hidden = true
    panel.innerHTML = ''
  }

  // Offered near the end, and counted down so a series keeps playing on its
  // own — with a way out that is easy to hit from a sofa.
  function offerUpNext () {
    if (!upNext || countdown || state.leaving || !panel.hidden) return
    let left = 15
    panel.innerHTML = `
      <div class="tiny muted">Up next</div>
      <div class="upnext-title">${esc(upNext.label)} · ${esc(upNext.title)}</div>
      <div class="row" style="margin-top:12px">
        <button class="btn primary small" data-act="play-next">▶ Play now (<span id="pl-count">${left}</span>)</button>
        <button class="btn small" data-act="cancel-next">Not now</button>
      </div>`
    panel.hidden = false
    if (document.documentElement.classList.contains('tv')) {
      panel.querySelector('[data-act="play-next"]').focus({ preventScroll: true })
    }
    countdown = setInterval(() => {
      left -= 1
      const counter = panel.querySelector('#pl-count')
      if (counter) counter.textContent = String(left)
      if (left <= 0) playNext({ finished: true })
    }, 1000)
  }

  panel.addEventListener('click', event => {
    const act = event.target.closest('[data-act]')?.dataset.act
    if (act === 'play-next') playNext({ finished: true })
    if (act === 'cancel-next') {
      hideUpNext()
      upNextDismissed = true
    }
  })

  async function playNext ({ finished = false } = {}) {
    if (!upNext || state.leaving) return
    state.leaving = true
    hideUpNext()
    busy.hidden = false
    const label = root.querySelector('#pl-busy')
    if (label) label.textContent = `Finding a stream for ${upNext.label}…`
    try {
      await saveProgress(finished)
      location.hash = await episodeHref(upNext, meta)
    } catch (err) {
      state.leaving = false
      busy.hidden = true
      toast(err.message, 'err')
    }
  }

  /* -------------------------------------------------------------- saving */

  async function saveProgress (finished = false) {
    // A file the browser cannot measure yet — a torrent still filling in, or an
    // MKV with no duration in its header — reports an infinite duration. The
    // position is still worth keeping; only the percentage is unknown.
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0
    const time = Number.isFinite(video.currentTime) ? video.currentTime : 0
    if (!duration && !time) return
    try {
      // Watched to the end with no duration to compare against: the server
      // drops finished titles by ratio, so say so directly instead.
      if (finished && !duration) return await api.clearProgress(progressKey)
      await api.saveProgress({
        id: progressKey,
        time: finished ? duration : time,
        duration,
        meta: progressMeta(progressKey)
      })
    } catch { /* progress saving is best-effort */ }
  }
  state.saveTimer = setInterval(() => {
    if (!video.paused) saveProgress()
  }, 10000)

  /* -------------------------------------------------------------- extras */

  // Live transfer numbers for the file being watched.
  if (kind === 'torrent') {
    state.statsTimer = setInterval(async () => {
      try {
        const { torrents } = await api.torrents()
        const record = torrents.find(torrent => torrent.id === state.id)
        if (!record) return
        root.querySelector('#pl-net').textContent =
          `↓ ${bytes(record.downloadSpeed, true)} · ${record.numPeers} peers · ${Math.round(record.progress * 100)}% cached`
        if (busy.hidden === false && !video.error) {
          root.querySelector('#pl-busy') && (root.querySelector('#pl-busy').textContent =
            record.numPeers ? `Buffering… ${bytes(record.downloadSpeed, true)} from ${record.numPeers} peers` : 'Looking for peers…')
        }
      } catch { /* the list endpoint is optional here */ }
    }, 2000)
  }

  // Subtitles offered by add-ons for this exact video id.
  if (meta.videoId && meta.type) {
    api.subtitles(meta.type, meta.videoId).then(subs => {
      if (!subs.length) return
      const select = root.querySelector('#pl-subs')
      select.style.display = ''
      select.innerHTML = '<option value="">Subtitles: off</option>' +
        subs.slice(0, 40).map((sub, index) => `<option value="${index}">${esc(sub.lang || sub.id || `Track ${index + 1}`)}</option>`).join('')
      select.addEventListener('change', () => {
        ;[...video.querySelectorAll('track')].forEach(track => track.remove())
        const sub = subs[Number(select.value)]
        if (!sub) return
        const track = document.createElement('track')
        track.kind = 'subtitles'
        track.label = sub.lang || 'Subtitles'
        track.srclang = (sub.lang || 'en').slice(0, 2)
        track.src = api.subtitleUrl(sub.url)
        track.default = true
        video.append(track)
        video.textTracks[video.textTracks.length - 1].mode = 'showing'
      })
    }).catch(() => { /* no subtitle add-on installed */ })
  }

  /* ------------------------------------------------------------ controls */

  const seek = overlayBottom.querySelector('.seek')
  seek.addEventListener('click', event => {
    const rect = seek.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    if (video.duration) video.currentTime = ratio * video.duration
  })

  overlayBottom.addEventListener('click', event => {
    const act = event.target.closest('[data-act]')?.dataset.act
    if (act === 'playpause') video.paused ? video.play() : video.pause()
    if (act === 'back10') video.currentTime = Math.max(0, video.currentTime - 10)
    if (act === 'fwd30') video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 30)
    if (act === 'mute') {
      video.muted = !video.muted
      event.target.textContent = video.muted ? '🔇' : '🔊'
    }
    if (act === 'fullscreen') {
      if (document.fullscreenElement) document.exitFullscreen()
      else root.requestFullscreen?.()
    }
  })

  overlayBottom.querySelector('.vol').addEventListener('input', event => {
    video.volume = Number(event.target.value)
    video.muted = video.volume === 0
    localStorage.setItem('sh-volume', String(video.volume))
  })

  overlayTop.addEventListener('click', async event => {
    const act = event.target.closest('[data-act]')?.dataset.act
    if (act === 'back') history.back()
    if (act === 'external') {
      await navigator.clipboard.writeText(location.origin + src).catch(() => {})
      toast('Stream link copied — paste it into VLC, MPV or IINA', 'ok')
    }
    if (act === 'cast') {
      video.pause()
      castPicker({
        torrentId: kind === 'torrent' ? state.id : null,
        fileIdx: state.fileIdx,
        url: kind === 'torrent' ? null : src,
        title: meta.title || root.querySelector('#pl-title').textContent
      })
    }
    if (act === 'next') return playNext()
    if (act === 'keep') {
      if (kind !== 'torrent') return toast('Only torrent streams can be kept', 'err')
      try {
        await api.addTorrent({ infoHash: state.id, fileIdx: state.fileIdx, mode: 'download', meta })
        toast('Saving the whole file to your downloads folder', 'ok')
      } catch (err) {
        toast(err.message, 'err')
      }
    }
  })

  video.addEventListener('click', () => {
    video.paused ? video.play() : video.pause()
  })

  const onKey = event => {
    if (event.target.matches('input, select, textarea')) return
    // A remote press is the only "the viewer is still there" signal a TV gives,
    // so it brings the controls back exactly as moving a mouse does.
    wake()
    // TV mode steps through the on-screen controls with the D-pad; when it has
    // used the key for that, it is not also a seek.
    if (event.defaultPrevented) return
    switch (event.key) {
      case ' ': case 'k':
        event.preventDefault()
        video.paused ? video.play() : video.pause()
        break
      case 'ArrowLeft': video.currentTime -= 5; break
      case 'ArrowRight': video.currentTime += 5; break
      case 'ArrowUp':
      case 'ArrowDown': {
        // In TV mode up/down move focus between the on-screen controls; the
        // remote's own volume keys never reach the browser anyway.
        if (document.documentElement.classList.contains('tv')) return
        const step = event.key === 'ArrowUp' ? 0.1 : -0.1
        video.volume = Math.min(1, Math.max(0, video.volume + step))
        break
      }
      case 'f': document.fullscreenElement ? document.exitFullscreen() : root.requestFullscreen?.(); break
      case 'm': video.muted = !video.muted; break
      case 'Escape': if (!document.fullscreenElement) history.back(); break
    }
  }
  window.addEventListener('keydown', onKey)

  // Hide the chrome when nothing is happening — a rested mouse, or a remote
  // nobody has touched. On a TV the controls stay up longer: there is no
  // pointer to bring them straight back.
  function wake () {
    const tv = document.documentElement.classList.contains('tv')
    const wasIdle = root.classList.contains('idle')
    root.classList.remove('idle')
    // Coming back from idle with the D-pad, focus lands on play/pause rather
    // than wherever it was left, which may now be off screen.
    if (tv && wasIdle && !document.activeElement?.closest(CHROME)) {
      overlayBottom.querySelector('[data-act="playpause"]').focus({ preventScroll: true })
    }
    clearTimeout(state.idleTimer)
    state.idleTimer = setTimeout(() => {
      if (video.paused) return
      if (!panel.hidden) return                          // still deciding on the next episode
      if (document.querySelector('.modal-backdrop')) return
      root.classList.add('idle')
      // With a remote something is always focused, so the controls have to let
      // go of it as they fade — otherwise focus sits on a button nobody can
      // see, and the next press moves it somewhere invisible as well.
      if (document.activeElement?.closest(CHROME)) document.activeElement.blur()
    }, tv ? 5000 : 2800)
  }
  root.addEventListener('mousemove', wake)
  root.addEventListener('focusin', wake)
  wake()

  return {
    async destroy () {
      state.destroyed = true
      clearInterval(state.statsTimer)
      clearInterval(state.saveTimer)
      clearInterval(countdown)
      clearTimeout(state.idleTimer)
      window.removeEventListener('keydown', onKey)
      await saveProgress()
      video.pause()
      video.removeAttribute('src')
      video.load()
      root.remove()
    }
  }
}
