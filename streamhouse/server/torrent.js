import fs from 'fs'
import path from 'path'
import WebTorrent from 'webtorrent'
import { config } from './config.js'
import { JsonStore } from './store.js'
import { ensureDir, DATA_DIR } from './paths.js'

// Extra public trackers so a bare info-hash (which is all some add-ons hand
// back) still finds peers when the source list is thin.
const FALLBACK_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.openbittorrent.com:6969/announce'
]

const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.m4v', '.webm', '.wmv', '.flv', '.mpg', '.mpeg', '.ts', '.m2ts', '.ogv']

export function isVideo (name = '') {
  return VIDEO_EXTENSIONS.includes(path.extname(name).toLowerCase())
}

export function infoHashOf (input = '') {
  const value = String(input)
  const magnet = value.match(/xt=urn:btih:([a-z0-9]{32,40})/i)
  if (magnet) return magnet[1].toLowerCase()
  if (/^[a-f0-9]{40}$/i.test(value)) return value.toLowerCase()
  return null
}

// Like a torrent client's backup folder: the .torrent metadata of everything in
// the list, so a restart resumes instantly instead of re-asking the swarm.
const TORRENT_CACHE = ensureDir(path.join(DATA_DIR, 'torrents'))

function cachePath (infoHash) {
  return path.join(TORRENT_CACHE, `${infoHash}.torrent`)
}

export function isValidTorrentId (value) {
  if (!value) return false
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value.length > 0
  const text = String(value).trim()
  if (/^magnet:\?/i.test(text)) return /xt=urn:btih:[a-z0-9]{32,40}/i.test(text)
  if (/^[a-f0-9]{40}$/i.test(text)) return true
  if (/^[a-z2-7]{32}$/i.test(text)) return true                 // base32 info-hash
  return /^https?:\/\/\S+$/i.test(text)                          // remote .torrent
}

// Stremio stream objects carry `sources` such as "tracker:udp://host:port" and
// "dht:<hash>"; turn those plus an info-hash into a magnet link.
export function buildMagnet ({ infoHash, name, sources = [], trackers = [] }) {
  const hash = infoHashOf(infoHash)
  if (!hash) throw new Error('A valid info-hash is required to build a magnet link')
  const params = [`xt=urn:btih:${hash}`]
  if (name) params.push(`dn=${encodeURIComponent(name)}`)
  const announce = new Set(trackers)
  for (const source of sources) {
    const value = String(source)
    if (value.startsWith('tracker:')) announce.add(value.slice('tracker:'.length))
    else if (/^(https?|udp|wss):\/\//i.test(value)) announce.add(value)
  }
  for (const tracker of FALLBACK_TRACKERS) announce.add(tracker)
  for (const tracker of announce) params.push(`tr=${encodeURIComponent(tracker)}`)
  return `magnet:?${params.join('&')}`
}

// Only ever removes a directory we emptied ourselves — never a folder that
// still holds files the user might want.
function removeIfEmpty (folder) {
  try {
    if (!fs.existsSync(folder)) return
    if (fs.readdirSync(folder).length) return
    fs.rmdirSync(folder)
  } catch (err) {
    console.warn(`[torrent] could not remove empty folder: ${err.message}`)
  }
}

function pickLargestVideo (files) {
  const videos = files.filter(file => isVideo(file.name))
  const pool = videos.length ? videos : files
  return pool.reduce((best, file) => (!best || file.length > best.length ? file : best), null)
}

class TorrentEngine {
  constructor () {
    this.store = new JsonStore('torrents', [])
    this.client = null
    this.started = false
    this.playing = new Map() // infoHash -> last playback timestamp
  }

  start () {
    if (this.started) return this
    this.started = true
    const settings = config.get()

    this.client = new WebTorrent({
      torrentPort: settings.torrentPort || 0,
      maxConns: settings.maxConns,
      downloadLimit: settings.downloadLimit,
      uploadLimit: settings.uploadLimit
    })
    this.client.on('error', err => console.error('[torrent] client error:', err.message))

    // Restore whatever was in the list when the app was last closed. WebTorrent
    // re-verifies the pieces already on disk, so downloads resume where they
    // stopped instead of starting over.
    for (const record of this.records()) {
      if (!record.magnet) continue
      try {
        this._attach(record, { paused: record.status === 'paused' })
      } catch (err) {
        record.status = 'error'
        record.error = err.message
      }
    }
    this.store.save()

    this._ticker = setInterval(() => this._tick(), 5000)
    if (this._ticker.unref) this._ticker.unref()
    return this
  }

  records () {
    return this.store.get()
  }

  record (id) {
    const hash = infoHashOf(id) || String(id).toLowerCase()
    return this.records().find(record => record.id === hash)
  }

  torrent (id) {
    const hash = infoHashOf(id) || String(id).toLowerCase()
    return this.client?.torrents.find(torrent => torrent.infoHash === hash) || null
  }

  applyLimits () {
    if (!this.client) return
    const settings = config.get()
    this.client.throttleDownload(settings.downloadLimit)
    this.client.throttleUpload(settings.uploadLimit)
  }

  // Add a magnet / info-hash / .torrent buffer and start it.
  //   mode 'download' -> keep the file on disk, qBittorrent style
  //   mode 'stream'   -> same engine, but only the file being watched
  add ({ magnet, infoHash, torrentFile, sources = [], fileIdx = null, mode = 'download', meta = {}, name = '', paused = false }) {
    this.start()
    const settings = config.get()

    let torrentId = torrentFile || magnet
    if (!torrentId && infoHash) torrentId = buildMagnet({ infoHash, name: meta.title || name, sources })
    if (!torrentId) {
      const error = new Error('Provide a magnet link, an info-hash or a .torrent file')
      error.status = 400
      throw error
    }
    if (!isValidTorrentId(torrentId)) {
      const error = new Error('That is not a magnet link, an info-hash or a .torrent URL')
      error.status = 400
      throw error
    }
    // A bare info-hash needs trackers attached before it can find peers.
    if (typeof torrentId === 'string' && /^[a-f0-9]{40}$/i.test(torrentId.trim())) {
      torrentId = buildMagnet({ infoHash: torrentId.trim(), name: meta.title || name, sources })
    }

    const hash = torrentFile ? null : infoHashOf(torrentId)
    const existing = hash ? this.record(hash) : null

    if (existing) {
      // Already known: upgrade a stream-only entry into a real download, or
      // just point it at a different file, rather than adding a duplicate.
      if (mode === 'download') existing.mode = 'download'
      if (fileIdx !== null && fileIdx !== undefined) existing.fileIdx = Number(fileIdx)
      existing.meta = { ...existing.meta, ...meta }
      if (!this.torrent(existing.id)) this._attach(existing, { paused })
      else this._applySelection(this.torrent(existing.id), existing)
      if (!paused) this.resume(existing.id)
      this.store.save()
      return existing
    }

    const record = {
      id: hash || `pending-${Date.now()}`,
      magnet: typeof torrentId === 'string' ? torrentId : null,
      name: meta.title || name || 'Fetching metadata…',
      mode,
      fileIdx: fileIdx === null || fileIdx === undefined ? null : Number(fileIdx),
      savePath: ensureDir(settings.downloadDir),
      addedAt: Date.now(),
      completedAt: null,
      status: paused ? 'paused' : 'connecting',
      meta,
      error: null
    }

    const records = this.records()
    records.push(record)
    this.store.set(records)

    this._attach(record, { paused, torrentId })
    return record
  }

  _attach (record, { paused = false, torrentId = null } = {}) {
    const settings = config.get()
    let id = torrentId || record.magnet
    // Prefer the cached metadata: it carries the piece hashes, so the torrent is
    // ready immediately and resumes from disk even with no peers around.
    const cached = cachePath(record.id)
    if (!torrentId && fs.existsSync(cached)) {
      try {
        id = fs.readFileSync(cached)
      } catch (err) {
        console.warn(`[torrent] could not read cached metadata: ${err.message}`)
      }
    }
    if (!id) throw new Error('Nothing to add for this torrent')

    const torrent = this.client.add(id, {
      path: record.savePath || settings.downloadDir,
      paused,
      // Nothing downloads until the wanted files are selected below.
      deselect: true,
      announce: FALLBACK_TRACKERS
    })

    torrent.on('error', err => {
      record.status = 'error'
      record.error = err.message
      this.store.save()
    })

    torrent.on('metadata', () => {
      record.id = torrent.infoHash
      record.magnet = torrent.magnetURI
      record.name = record.meta?.title || torrent.name
      record.totalLength = torrent.length
      this._cacheMetadata(torrent)
      this.store.save()
    })

    torrent.on('ready', () => {
      record.id = torrent.infoHash
      record.magnet = torrent.magnetURI
      this._cacheMetadata(torrent)
      if (!record.meta?.title) record.name = torrent.name
      record.totalLength = torrent.length
      this._applySelection(torrent, record)
      if (!torrent.paused && record.status !== 'done' && record.status !== 'seeding') {
        record.status = 'downloading'
      }
      this.store.save()
    })

    torrent.on('done', () => {
      record.status = config.get().seedAfterDownload ? 'seeding' : 'done'
      record.completedAt = Date.now()
      record.error = null
      if (!config.get().seedAfterDownload) torrent.pause()
      this.store.save()
    })

    return torrent
  }

  _cacheMetadata (torrent) {
    if (!torrent?.torrentFile || !torrent.infoHash) return
    const file = cachePath(torrent.infoHash)
    if (fs.existsSync(file)) return
    try {
      fs.writeFileSync(file, Buffer.from(torrent.torrentFile))
    } catch (err) {
      console.warn(`[torrent] could not cache metadata: ${err.message}`)
    }
  }

  // qBittorrent-style file selection: only the wanted files are downloaded.
  _applySelection (torrent, record) {
    if (!torrent?.files?.length) return
    const wanted = this.wantedFiles(torrent, record)
    const wantedSet = new Set(wanted)
    torrent.files.forEach(file => {
      if (wantedSet.has(file)) file.select(record.mode === 'stream' ? 10 : 1)
      else file.deselect()
    })
  }

  wantedFiles (torrent, record) {
    if (Array.isArray(record.selectedFiles) && record.selectedFiles.length) {
      return record.selectedFiles.map(index => torrent.files[index]).filter(Boolean)
    }
    if (record.fileIdx !== null && record.fileIdx !== undefined && torrent.files[record.fileIdx]) {
      return [torrent.files[record.fileIdx]]
    }
    if (record.mode === 'stream') {
      const file = pickLargestVideo(torrent.files)
      return file ? [file] : []
    }
    return torrent.files
  }

  selectFiles (id, indices) {
    const record = this.record(id)
    if (!record) throw new Error('Torrent not found')
    record.selectedFiles = Array.isArray(indices) ? indices.map(Number).filter(n => Number.isInteger(n)) : []
    if (!record.selectedFiles.length) delete record.selectedFiles
    record.mode = 'download'
    const torrent = this.torrent(record.id)
    if (torrent) this._applySelection(torrent, record)
    this.store.save()
    return record
  }

  pause (id) {
    const record = this.record(id)
    if (!record) throw new Error('Torrent not found')
    this.torrent(record.id)?.pause()
    record.status = 'paused'
    this.store.save()
    return record
  }

  resume (id) {
    const record = this.record(id)
    if (!record) throw new Error('Torrent not found')
    let torrent = this.torrent(record.id)
    if (!torrent) torrent = this._attach(record, { paused: false })
    else torrent.resume()
    if (torrent.done) record.status = config.get().seedAfterDownload ? 'seeding' : 'done'
    else record.status = torrent.ready ? 'downloading' : 'connecting'
    record.error = null
    this.store.save()
    return record
  }

  remove (id, { deleteFiles = false } = {}) {
    const record = this.record(id)
    if (!record) throw new Error('Torrent not found')
    const torrent = this.torrent(record.id)
    if (torrent) {
      const folder = torrent.name ? path.join(record.savePath, torrent.name) : null
      // client.remove is async in WebTorrent 3, so catch both shapes.
      try {
        const pending = this.client.remove(torrent.infoHash, { destroyStore: deleteFiles })
        if (pending?.catch) pending.catch(err => console.warn('[torrent] remove failed:', err.message))
      } catch (err) {
        console.warn('[torrent] remove failed:', err.message)
      }
      // destroyStore deletes the files but leaves the directory behind.
      if (deleteFiles && folder) setTimeout(() => removeIfEmpty(folder), 1500).unref?.()
    } else if (deleteFiles && record.savePath && record.name) {
      const target = path.join(record.savePath, record.name)
      fs.rmSync(target, { recursive: true, force: true })
    }
    fs.rmSync(cachePath(record.id), { force: true })
    this.store.set(this.records().filter(entry => entry.id !== record.id))
    return { removed: record.id, deletedFiles: deleteFiles }
  }

  // Resolve a playable file, waiting for metadata if the torrent just started.
  async file (id, fileIdx = null, { timeout = 60000 } = {}) {
    this.start()
    let record = this.record(id)
    if (!record) {
      const hash = infoHashOf(id)
      if (!hash) throw new Error('Torrent not found')
      record = this.add({ infoHash: hash, mode: 'stream' })
    }
    let torrent = this.torrent(record.id)
    if (!torrent) torrent = this._attach(record, { paused: false })
    if (torrent.paused) torrent.resume()

    if (!torrent.ready) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out waiting for torrent metadata')), timeout)
        torrent.once('ready', () => {
          clearTimeout(timer)
          resolve()
        })
        torrent.once('error', err => {
          clearTimeout(timer)
          reject(err)
        })
      })
    }

    const index = fileIdx === null || fileIdx === undefined ? record.fileIdx : Number(fileIdx)
    const file = (index !== null && index !== undefined && torrent.files[index]) || pickLargestVideo(torrent.files)
    if (!file) throw new Error('This torrent has no playable file')

    // Watching a file always implies wanting it, whatever the current selection.
    file.select(10)
    this.playing.set(torrent.infoHash, Date.now())
    if (record.status === 'paused') record.status = 'downloading'
    this.store.save()
    return { torrent, file, record, fileIndex: torrent.files.indexOf(file) }
  }

  stats (record) {
    const torrent = this.torrent(record.id)
    const files = (torrent?.files || []).map((file, index) => ({
      index,
      name: file.name,
      path: file.path,
      length: file.length,
      downloaded: file.downloaded,
      progress: file.progress,
      selected: this.wantedFiles(torrent, record).includes(file),
      video: isVideo(file.name)
    }))
    const selected = files.filter(file => file.selected)
    const selectedLength = selected.reduce((sum, file) => sum + file.length, 0)
    const selectedDownloaded = selected.reduce((sum, file) => sum + file.downloaded, 0)
    const progress = selectedLength ? Math.min(1, selectedDownloaded / selectedLength) : (torrent?.progress || 0)
    const downloadSpeed = torrent?.downloadSpeed || 0
    const remaining = Math.max(0, selectedLength - selectedDownloaded)

    return {
      ...record,
      status: torrent?.paused ? 'paused' : record.status,
      ready: Boolean(torrent?.ready),
      infoHash: torrent?.infoHash || record.id,
      name: record.meta?.title || torrent?.name || record.name,
      length: selectedLength || torrent?.length || record.totalLength || 0,
      downloaded: selectedDownloaded || torrent?.downloaded || 0,
      uploaded: torrent?.uploaded || 0,
      ratio: torrent?.ratio || 0,
      progress,
      downloadSpeed,
      uploadSpeed: torrent?.uploadSpeed || 0,
      numPeers: torrent?.numPeers || 0,
      timeRemaining: downloadSpeed > 0 ? (remaining / downloadSpeed) * 1000 : Infinity,
      files,
      playableIndex: files.find(file => file.selected && file.video)?.index ?? files.find(file => file.video)?.index ?? null
    }
  }

  list () {
    this.start()
    return this.records().map(record => this.stats(record))
  }

  totals () {
    const client = this.client
    return {
      downloadSpeed: client?.downloadSpeed || 0,
      uploadSpeed: client?.uploadSpeed || 0,
      progress: client?.progress || 0,
      ratio: client?.ratio || 0,
      active: client?.torrents.filter(torrent => !torrent.paused).length || 0,
      total: this.records().length,
      downloadLimit: config.get().downloadLimit,
      uploadLimit: config.get().uploadLimit
    }
  }

  // Housekeeping: honour the seed-ratio limit and drop stream-only torrents
  // that nobody is watching when the cache-only setting is on.
  _tick () {
    const settings = config.get()
    for (const record of [...this.records()]) {
      const torrent = this.torrent(record.id)
      if (!torrent) continue
      if (torrent.done && record.status === 'downloading') {
        record.status = settings.seedAfterDownload ? 'seeding' : 'done'
        record.completedAt = record.completedAt || Date.now()
      }
      if (settings.seedRatioLimit > 0 && torrent.done && torrent.ratio >= settings.seedRatioLimit && !torrent.paused) {
        torrent.pause()
        record.status = 'done'
      }
      if (settings.streamCacheOnly && record.mode === 'stream') {
        const lastPlayed = this.playing.get(record.id) || record.addedAt
        if (Date.now() - lastPlayed > 30 * 60 * 1000) this.remove(record.id, { deleteFiles: true })
      }
    }
    this.store.save()
  }

  async destroy () {
    this.store.flush()
    if (!this.client) return
    await new Promise(resolve => this.client.destroy(resolve))
    this.client = null
    this.started = false
  }
}

export const engine = new TorrentEngine()
