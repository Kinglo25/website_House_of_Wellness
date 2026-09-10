import { JsonStore } from './store.js'
import { DEFAULT_DOWNLOAD_DIR, ensureDir } from './paths.js'

const DEFAULTS = {
  // http server
  port: Number(process.env.PORT) || 11471,
  host: process.env.HOST || '127.0.0.1',

  // where finished / in-progress media lands
  downloadDir: DEFAULT_DOWNLOAD_DIR,

  // bittorrent engine
  torrentPort: 0,            // 0 = pick a free port
  maxConns: 55,              // per torrent
  downloadLimit: -1,         // bytes/sec, -1 = unlimited
  uploadLimit: -1,           // bytes/sec, -1 = unlimited
  seedAfterDownload: true,   // keep seeding once a download completes
  seedRatioLimit: 0,         // 0 = no limit; otherwise stop seeding at this ratio
  autoStartDownloads: true,  // start downloading as soon as a torrent is added
  streamCacheOnly: false,    // true = delete stream-only torrents when they stop

  // player
  playerVolume: 1,
  autoPlayNextEpisode: true,

  // ui
  theme: 'midnight'
}

class Config {
  constructor () {
    this.store = new JsonStore('config', DEFAULTS)
    this.store.set({ ...DEFAULTS, ...this.store.get() })
    ensureDir(this.get().downloadDir)
  }

  get () {
    return this.store.get()
  }

  update (patch) {
    const next = { ...this.get() }
    for (const [key, value] of Object.entries(patch || {})) {
      if (!(key in DEFAULTS)) continue
      if (typeof DEFAULTS[key] === 'number') {
        const num = Number(value)
        if (Number.isFinite(num)) next[key] = num
      } else if (typeof DEFAULTS[key] === 'boolean') {
        next[key] = Boolean(value)
      } else if (typeof value === 'string' && value.trim()) {
        next[key] = value.trim()
      }
    }
    if (next.downloadDir !== this.get().downloadDir) ensureDir(next.downloadDir)
    this.store.set(next)
    return next
  }
}

export const config = new Config()
export { DEFAULTS }
