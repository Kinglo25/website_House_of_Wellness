import express from 'express'
import fs from 'fs'
import path from 'path'
import { config } from '../config.js'
import { addons, clearAddonCache } from '../addons.js'
import { engine, infoHashOf } from '../torrent.js'
import { rankStreams, PROFILES } from '../rank.js'
import { library, progress, viewers, markers } from '../history.js'
import { MAIN, scopeKey, splitKey, progressOf, libraryOf, viewerOf } from '../viewers.js'
import { recordPosition, setWatched, hide } from '../watching.js'
import { mimeFor, isBrowserPlayable, srtToVtt, byteRange } from '../mime.js'
import { localAddresses, lanUrl, isLanReachable } from '../network.js'
import * as cast from '../cast.js'
import * as vlc from '../vlc.js'
import { account } from '../sync.js'

const router = express.Router()

// Wrap async handlers so a rejected promise becomes a clean 500 instead of an
// unhandled rejection.
const wrap = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)

/* ------------------------------------------------------------------ health */

router.get('/health', (req, res) => {
  res.json({ ok: true, version: 1, uptime: process.uptime() })
})

/* ------------------------------------------------------------------ config */

router.get('/config', (req, res) => res.json(config.get()))

router.post('/config', (req, res) => {
  const next = config.update(req.body)
  engine.applyLimits()
  res.json(next)
})

// The stream profiles Settings offers, described by the ranker itself.
router.get('/profiles', (req, res) => {
  res.json(Object.entries(PROFILES).map(([id, profile]) => ({ id, label: profile.label, hint: profile.hint })))
})

/* ------------------------------------------------------------------ addons */

router.get('/addons', wrap(async (req, res) => {
  if (req.query.refresh) await addons.refreshManifests()
  res.json(addons.list())
}))

router.post('/addons', wrap(async (req, res) => {
  const addon = await addons.install(req.body?.url)
  res.status(201).json(addon)
}))

router.delete('/addons/:id', (req, res) => res.json(addons.remove(req.params.id)))

router.post('/addons/:id/toggle', (req, res) => {
  res.json(addons.toggle(req.params.id, req.body?.enabled !== false))
})

router.post('/addons/reorder', (req, res) => res.json(addons.reorder(req.body?.ids || [])))

/* --------------------------------------------------------------- catalogue */

router.get('/catalogs', (req, res) => res.json(addons.catalogs()))

router.get('/catalog', wrap(async (req, res) => {
  const { addon, type, id, skip, genre, search } = req.query
  const metas = await addons.catalog({ addonId: addon, type, id, skip, genre, search })
  res.json(metas)
}))

router.get('/meta/:type/:id', wrap(async (req, res) => {
  const meta = await addons.meta(req.params.type, req.params.id)
  if (!meta) return res.status(404).json({ error: 'No add-on could describe that title' })
  res.json(meta)
}))

router.get('/streams/:type/:id', wrap(async (req, res) => {
  const streams = await addons.streams(req.params.type, req.params.id)
  // Annotate each stream so the UI knows whether it can play it in the browser,
  // download it, or only hand it to an external player.
  const annotated = streams.map(stream => {
    const hash = stream.infoHash || infoHashOf(stream.url || '')
    return {
      ...stream,
      infoHash: hash || null,
      torrent: Boolean(hash),
      downloadable: Boolean(hash),
      direct: Boolean(stream.url && !hash)
    }
  })
  // Then parse the release names and sort best-first for the profile in
  // Settings, so the top row is the one worth pressing Play on.
  res.json(rankStreams(annotated, config.get()))
}))

router.get('/subtitles/:type/:id', wrap(async (req, res) => {
  res.json(await addons.subtitles(req.params.type, req.params.id, req.query))
}))

// Proxy + convert a remote subtitle file so <track> can consume it (add-on
// subtitle hosts rarely send CORS headers, and most of them serve SubRip).
router.get('/subtitle', wrap(async (req, res) => {
  const url = req.query.url
  if (!/^https?:\/\//i.test(url || '')) return res.status(400).json({ error: 'A subtitle URL is required' })
  const upstream = await fetch(url)
  if (!upstream.ok) return res.status(502).json({ error: `Subtitle host returned ${upstream.status}` })
  const text = await upstream.text()
  res.type('text/vtt; charset=utf-8')
  res.send(text.trimStart().startsWith('WEBVTT') ? text : srtToVtt(text))
}))

router.get('/search', wrap(async (req, res) => {
  const query = String(req.query.q || '').trim()
  if (!query) return res.json([])
  const types = req.query.type ? [req.query.type] : null
  res.json(await addons.search(query, types))
}))

/* ---------------------------------------------------------------- profiles */

// Who is watching. Every request below names its profile in X-Viewer; one that
// names none, or one since removed, is the main profile's — which is also all
// an older device knows about.
const who = req => viewerOf(req, viewers.list())

router.get('/viewers', (req, res) => res.json(viewers.list()))

router.post('/viewers', (req, res) => {
  const name = String(req.body?.name || '').trim()
  if (!name) return res.status(400).json({ error: 'A profile needs a name' })
  res.status(201).json(viewers.add({ name, colour: req.body?.colour }))
})

router.post('/viewers/:id', (req, res) => {
  res.json(viewers.update(req.params.id, { name: req.body?.name, colour: req.body?.colour }))
})

// Removing a profile removes what it watched and saved; nobody else's.
router.delete('/viewers/:id', (req, res) => {
  const { id } = req.params
  viewers.remove(id)
  const all = progress.get()
  for (const key of Object.keys(all)) if (splitKey(key).viewer === id) delete all[key]
  progress.set(all)
  library.set(library.get().filter(item => item.viewer !== id))
  res.json({ removed: id })
})

/* ----------------------------------------------------------------- library */

router.get('/library', wrap(async (req, res) => {
  await account.fresh()
  res.json(libraryOf(library.get(), who(req)))
}))

router.post('/library', (req, res) => {
  const viewer = who(req)
  const { viewer: _, ...item } = req.body || {}
  if (!item.id || !item.type) return res.status(400).json({ error: 'id and type are required' })
  const mine = entry => entry.id === item.id && (entry.viewer || MAIN) === viewer
  const items = library.get().filter(entry => !mine(entry))
  items.unshift({ ...item, ...(viewer === MAIN ? {} : { viewer }), addedAt: Date.now() })
  library.set(items)
  res.status(201).json(item)
})

router.delete('/library/:id', (req, res) => {
  const viewer = who(req)
  library.set(library.get().filter(entry => !(entry.id === req.params.id && (entry.viewer || MAIN) === viewer)))
  res.json({ removed: req.params.id })
})

/* -------------------------------------------------------- playback history */

// Whatever another device watched shows up here: a stale copy is refreshed
// from the account server first, for as long as that is quick.
router.get('/progress', wrap(async (req, res) => {
  await account.fresh()
  res.json(progressOf(progress.get(), who(req)))
}))

// The key an entry is stored under. A key that already names a profile is
// taken as it is: the TV app's native player reports the key it was handed,
// which the page scoped before handing it over.
function storedKey (viewer, id) {
  const already = splitKey(id)
  if (already.viewer !== MAIN && viewers.has(already.viewer)) return String(id)
  return scopeKey(viewer, id)
}
const asSeen = (entry, key) => ({ ...entry, id: splitKey(key).key })

// Shared by the browser player, which posts here, and VLC, whose position the
// server reads back itself. The rules are in watching.js.
function recordProgress ({ viewer = MAIN, id, time, duration, meta }) {
  const key = storedKey(viewer, id)
  const all = progress.get()
  const entry = recordPosition(all, { id: key, time, duration, meta })
  progress.set(all)
  return entry ? asSeen(entry, key) : { id: splitKey(key).key, cleared: true }
}

router.post('/progress', (req, res) => {
  const { id, time, duration, meta } = req.body || {}
  if (!id) return res.status(400).json({ error: 'id is required' })
  res.json(recordProgress({ viewer: who(req), id, time, duration, meta }))
})

// The tick on an episode, by hand: "Mark as watched" and its undo.
// `items` marks a whole season at once, in one write: [{ id, meta }, ...].
router.post('/watched', (req, res) => {
  const { id, watched, meta, items } = req.body || {}
  const list = Array.isArray(items) ? items : [{ id, meta }]
  if (!list.length || list.some(item => !item?.id)) return res.status(400).json({ error: 'id is required' })
  if (list.length > 500) return res.status(413).json({ error: 'At most 500 at once' })
  const viewer = who(req)
  const all = progress.get()
  const results = list.map(item => {
    const key = storedKey(viewer, String(item.id))
    const entry = setWatched(all, { id: key, watched: Boolean(watched), meta: item.meta })
    return entry ? asSeen(entry, key) : { id: String(item.id), cleared: true }
  })
  progress.set(all)
  res.json(Array.isArray(items) ? results : results[0])
})

// "Remove from row" on continue watching and up next.
router.post('/progress/:id/hide', (req, res) => {
  const key = storedKey(who(req), req.params.id)
  const all = progress.get()
  const entry = hide(all, key)
  progress.set(all)
  res.json(entry ? asSeen(entry, key) : { id: req.params.id, cleared: true })
})

router.delete('/progress/:id', (req, res) => {
  const all = progress.get()
  delete all[storedKey(who(req), req.params.id)]
  progress.set(all)
  res.json({ removed: req.params.id })
})

/* ------------------------------------------------------------------ intros */

// Skip Intro, learned rather than detected: the player reports where someone
// skipped the opening of an episode by hand, and every episode of that show
// offers the same jump. Plex and Jellyfin find the span by analysing audio;
// StreamHouse only ever sees what people do.
router.get('/intro/:series', (req, res) => res.json(markers.get()[req.params.series] || null))

router.post('/intro/:series', (req, res) => {
  const start = Number(req.body?.start)
  const end = Number(req.body?.end)
  // An intro starts in the first few minutes and lasts from a few seconds to
  // a few minutes; anything else is someone skipping a scene.
  if (!(start >= 0 && start < 480 && end - start >= 10 && end - start <= 300)) {
    return res.status(400).json({ error: 'That does not look like an intro' })
  }
  const all = markers.get()
  all[req.params.series] = { start: Math.round(start), end: Math.round(end), learnedAt: Date.now() }
  markers.set(all)
  res.json(all[req.params.series])
})

router.delete('/intro/:series', (req, res) => {
  const all = markers.get()
  delete all[req.params.series]
  markers.set(all)
  res.json({ removed: req.params.series })
})

/* ----------------------------------------------------------------- account */

router.get('/account', (req, res) => res.json(account.status()))

router.post('/account/login', wrap(async (req, res) => {
  res.json(await account.signIn({ mode: 'login', email: req.body?.email, password: req.body?.password }))
}))

router.post('/account/signup', wrap(async (req, res) => {
  res.status(201).json(await account.signIn({ mode: 'signup', email: req.body?.email, password: req.body?.password }))
}))

router.post('/account/logout', wrap(async (req, res) => res.json(await account.signOut())))

router.post('/account/sync', wrap(async (req, res) => res.json(await account.sync())))

/* ---------------------------------------------------------------- torrents */

router.get('/torrents', (req, res) => {
  res.json({ torrents: engine.list(), totals: engine.totals() })
})

router.post('/torrents', (req, res) => {
  const { magnet, infoHash, sources, fileIdx, mode, meta, name, paused } = req.body || {}
  const record = engine.add({ magnet, infoHash, sources, fileIdx, mode: mode || 'download', meta, name, paused })
  res.status(201).json(engine.stats(record))
})

// Raw .torrent file upload (the body is the file itself).
router.post('/torrents/file', express.raw({ type: '*/*', limit: '10mb' }), (req, res) => {
  if (!req.body?.length) return res.status(400).json({ error: 'Empty .torrent upload' })
  const record = engine.add({ torrentFile: Buffer.from(req.body), mode: 'download' })
  res.status(201).json(engine.stats(record))
})

router.post('/torrents/:id/pause', (req, res) => res.json(engine.stats(engine.pause(req.params.id))))
router.post('/torrents/:id/resume', (req, res) => res.json(engine.stats(engine.resume(req.params.id))))

router.post('/torrents/:id/files', (req, res) => {
  res.json(engine.stats(engine.selectFiles(req.params.id, req.body?.indices || [])))
})

router.delete('/torrents/:id', (req, res) => {
  res.json(engine.remove(req.params.id, { deleteFiles: req.query.deleteFiles === '1' || req.query.deleteFiles === 'true' }))
})

// Where a finished download lives on disk, for "show me the file" in the UI.
router.get('/torrents/:id/location', (req, res) => {
  const record = engine.record(req.params.id)
  if (!record) return res.status(404).json({ error: 'Torrent not found' })
  const torrent = engine.torrent(record.id)
  const files = (torrent?.files || []).map(file => path.join(record.savePath, file.path))
  res.json({ savePath: record.savePath, folder: torrent?.name ? path.join(record.savePath, torrent.name) : record.savePath, files })
})

/* ---------------------------------------------------------------- playback */

// Byte-range video server. This is what the <video> element (and VLC, if the
// user copies the link) actually reads from.
async function serveFile (req, res, next) {
  const { id } = req.params
  const fileIdx = req.params.fileIdx !== undefined ? Number(req.params.fileIdx) : null
  let file
  try {
    ({ file } = await engine.file(id, fileIdx))
  } catch (err) {
    return next(err)
  }

  const total = file.length
  const range = req.headers.range
  const type = mimeFor(file.name)
  const headers = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Content-Disposition': `inline; filename="${encodeURIComponent(file.name)}"`,
    'Cache-Control': 'no-store'
  }

  if (req.method === 'HEAD') {
    res.writeHead(200, { ...headers, 'Content-Length': total })
    return res.end()
  }

  if (!range) {
    res.writeHead(200, { ...headers, 'Content-Length': total })
    const stream = file.createReadStream()
    stream.on('error', () => res.destroy())
    res.on('close', () => stream.destroy())
    return stream.pipe(res)
  }

  const wanted = byteRange(range, total)
  if (!wanted) {
    res.writeHead(416, { 'Content-Range': `bytes */${total}` })
    return res.end()
  }
  const { start, end } = wanted

  res.writeHead(206, {
    ...headers,
    'Content-Range': `bytes ${start}-${end}/${total}`,
    'Content-Length': end - start + 1
  })
  const stream = file.createReadStream({ start, end })
  stream.on('error', () => res.destroy())
  res.on('close', () => stream.destroy())
  stream.pipe(res)
}

router.get('/stream/:id/:fileIdx', serveFile)
router.get('/stream/:id', serveFile)
router.head('/stream/:id/:fileIdx', serveFile)
router.head('/stream/:id', serveFile)

// Everything the player needs before it starts: the file list, which file is
// playable in a browser, and the stream URL.
router.get('/playback/:id', wrap(async (req, res) => {
  const fileIdx = req.query.fileIdx !== undefined ? Number(req.query.fileIdx) : null
  const { torrent, file, record, fileIndex } = await engine.file(req.params.id, fileIdx)
  res.json({
    id: torrent.infoHash,
    name: file.name,
    fileIdx: fileIndex,
    length: file.length,
    mime: mimeFor(file.name),
    browserPlayable: isBrowserPlayable(file.name),
    streamUrl: `/api/stream/${torrent.infoHash}/${fileIndex}`,
    savePath: path.join(record.savePath, file.path),
    files: torrent.files.map((entry, index) => ({ index, name: entry.name, length: entry.length }))
  })
}))

/* --------------------------------------------------------------------- vlc */

// Whether the browser asking is on the computer running StreamHouse — by
// loopback, or by one of this machine's own addresses (a LAN or Tailscale URL
// opened on the same desk).
function fromThisComputer (req) {
  const address = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '')
  return vlc.isLoopback(address) || localAddresses().some(entry => entry.address === address)
}

router.get('/vlc', (req, res) => {
  res.json({ ...vlc.status(), local: fromThisComputer(req) })
})

// Open a stream in VLC here. `explicit` is the player's "Open in VLC" button,
// which works even when Settings say to play in the browser. A phone asking is
// refused: VLC would start on a screen nobody is watching.
router.post('/vlc/play', wrap(async (req, res) => {
  const { url, title, start, progressKey, meta, explicit } = req.body || {}
  const viewer = who(req)
  if (!explicit && config.get().desktopPlayer === 'browser') {
    return res.status(409).json({ error: 'Settings say to play in the browser', code: 'disabled' })
  }
  if (!fromThisComputer(req)) {
    return res.status(409).json({ error: 'VLC opens on the computer running StreamHouse, not this device', code: 'not-local' })
  }
  const target = vlc.playableUrl(url)
  if (!target) return res.status(400).json({ error: 'A stream URL is required' })
  const bin = vlc.findVlc()
  if (!bin) {
    return res.status(409).json({ error: 'VLC is not installed on this computer — get it from videolan.org', code: 'not-installed' })
  }

  await vlc.play({
    bin,
    url: target,
    title: typeof title === 'string' ? title : '',
    start: Number(start) || 0,
    onProgress: progressKey ? ({ time, duration }) => recordProgress({ viewer, id: String(progressKey), time, duration, meta }) : null
  })
  res.json({ ok: true })
}))

/* ------------------------------------------------------------- network */

// What address a TV, phone or tablet on the same network should open.
router.get('/network', (req, res) => {
  const settings = config.get()
  const addresses = localAddresses()
  res.json({
    host: settings.host,
    port: settings.port,
    reachable: isLanReachable(settings.host),
    addresses,
    urls: addresses.map(entry => `http://${entry.address}:${settings.port}`),
    primaryUrl: lanUrl(settings.port)
  })
})

// Flip between loopback-only and listening on the whole network, without
// making the user restart the app from a terminal.
router.post('/network/expose', wrap(async (req, res) => {
  const enabled = req.body?.enabled !== false
  const host = enabled ? '0.0.0.0' : '127.0.0.1'
  config.update({ host })

  // Answer first: rebinding drops every open socket, this request included.
  res.json({
    host,
    reachable: isLanReachable(host),
    primaryUrl: lanUrl(config.get().port),
    note: enabled
      ? 'Anyone on your network can now open StreamHouse. There is no password, and playback in progress restarts.'
      : 'StreamHouse is back to this computer only.'
  })

  const rebind = req.app.locals.rebind
  if (typeof rebind !== 'function') return
  res.on('finish', () => {
    setTimeout(() => {
      rebind(host, config.get().port).catch(err => console.error('[network] rebind failed:', err.message))
    }, 50).unref?.()
  })
}))

/* ---------------------------------------------------------------- casting */

router.get('/cast/devices', wrap(async (req, res) => {
  res.json(await cast.listAllDevices({ refresh: req.query.refresh === '1' }))
}))

router.post('/cast/devices', wrap(async (req, res) => {
  res.status(201).json(await cast.addManualAnywhere(req.body?.location))
}))

router.delete('/cast/devices/:id', (req, res) => {
  res.json({ removed: cast.forgetAnyDevice(req.params.id) })
})

// Hand a TV the URL of something in the library, or any direct URL.
router.post('/cast/play', wrap(async (req, res) => {
  const { deviceId, torrentId, fileIdx, url, title, subtitleUrl } = req.body || {}
  if (!deviceId) return res.status(400).json({ error: 'Pick a device to cast to' })

  const settings = config.get()
  let target = url
  let name = title
  let mime = 'video/mp4'

  if (torrentId) {
    const address = lanUrl(settings.port)
    if (!address) {
      return res.status(409).json({ error: 'This computer has no network address, so a TV cannot reach it' })
    }
    if (!isLanReachable(settings.host)) {
      return res.status(409).json({
        error: 'StreamHouse is only listening on this computer, so your TV cannot fetch the video. Turn on "Allow other devices" in Settings first.'
      })
    }
    const { torrent, file, fileIndex } = await engine.file(torrentId, fileIdx ?? null)
    target = `${address}/api/stream/${torrent.infoHash}/${fileIndex}`
    name = name || file.name
    mime = mimeFor(file.name)
  }

  if (!target) return res.status(400).json({ error: 'Nothing to cast' })
  res.json(await cast.playAnywhere(deviceId, { url: target, title: name, mime, subtitleUrl }))
}))

router.post('/cast/:id/control', wrap(async (req, res) => {
  await cast.controlAnywhere(req.params.id, req.body?.action, req.body?.value)
  res.json({ ok: true })
}))

router.get('/cast/:id/status', wrap(async (req, res) => {
  res.json(await cast.statusAnywhere(req.params.id))
}))

/* ------------------------------------------------------------ maintenance */

router.post('/cache/clear', (req, res) => {
  clearAddonCache()
  res.json({ ok: true })
})

router.get('/disk', (req, res) => {
  const dir = config.get().downloadDir
  let exists = false
  let writable = false
  try {
    exists = fs.existsSync(dir)
    fs.accessSync(dir, fs.constants.W_OK)
    writable = true
  } catch { /* reported as writable: false */ }
  res.json({ downloadDir: dir, exists, writable })
})

export default router
