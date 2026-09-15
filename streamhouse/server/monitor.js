/* Following a series.
 *
 * This is the thing Sonarr fundamentally is, and the one piece StreamHouse had
 * none of: you say which shows you care about, and new episodes turn up on
 * their own. Sonarr calls the loop RSS sync — every fifteen minutes it asks
 * its indexers what is new, runs the results past the quality profile, and
 * grabs what fits. Here the add-ons are the indexers and the profile is the
 * one the title page already uses, so this is mostly bookkeeping: which
 * episodes have aired, which ones have been dealt with, and stopping.
 *
 * Two rules keep it from being alarming:
 *
 *   - It only ever looks forward. An episode counts as new when it aired after
 *     you asked to be told about the show, so turning monitoring on for a show
 *     with six seasons behind it downloads nothing at all.
 *   - It grabs a few episodes per run, not a season. A show that ends up with
 *     twenty unwatched episodes is a bug report, not a feature.
 */

import { config } from './config.js'
import { engine, infoHashOf } from './torrent.js'
import { addons } from './addons.js'
import { blocklist } from './blocklist.js'
import { library, grabs } from './library.js'
import { rankStreams } from './rank.js'
import { parseVideoId, parseRuntime } from './parse.js'

let timer = null
let running = false

/* Everything already in the queue, by the episode it was grabbed for. The
 * monitor must not re-grab something the user is already downloading. */
function queuedVideoIds () {
  const ids = new Set()
  for (const record of engine.list()) {
    if (record.meta?.videoId) ids.add(record.meta.videoId)
  }
  return ids
}

/* The episodes of one series worth grabbing right now: aired, after monitoring
 * began, and not already dealt with. Newest last, so a catch-up run gets them
 * in the order they aired. */
export function episodesToGrab (entry, meta, { now = Date.now(), queued = new Set() } = {}) {
  const since = entry.monitoredSince || entry.addedAt || 0
  return (meta?.videos || [])
    .filter(video => video.season > 0 && video.episode != null)
    .filter(video => {
      const aired = Date.parse(video.released || video.firstAired || '')
      return Number.isFinite(aired) && aired <= now && aired > since
    })
    .filter(video => !grabs.has(video.id) && !queued.has(video.id))
    .sort((a, b) => Date.parse(a.released) - Date.parse(b.released))
}

/* Ask the add-ons for one episode and start the best release that fits the
 * profile. Returns the queue record, or null when nothing was good enough. */
export async function grabEpisode (entry, meta, video) {
  const streams = await addons.streams('series', video.id)
  if (!streams.length) return null

  const { season, episode } = parseVideoId(video.id)
  const annotated = streams.map(stream => {
    const hash = stream.infoHash || infoHashOf(stream.url || '')
    return { ...stream, infoHash: hash || null }
  })

  const ranked = rankStreams(annotated, config.get(), {
    season,
    episode,
    runtime: parseRuntime(meta?.runtime),
    blocked: blocklist.hashes()
  })

  const best = ranked.find(stream => stream.infoHash && !stream.rejections.length)
  if (!best) return null

  const title = `${entry.name} S${season}E${episode}`
  const record = engine.add({
    infoHash: best.infoHash,
    sources: best.sources || [],
    fileIdx: best.fileIdx ?? null,
    mode: 'download',
    meta: {
      title,
      poster: entry.poster,
      type: 'series',
      imdbId: entry.id,
      videoId: video.id,
      season,
      episode,
      seriesTitle: entry.name,
      episodeTitle: video.name || video.title || null,
      year: String(entry.releaseInfo || '').slice(0, 4) || null
    }
  })

  grabs.add({ videoId: video.id, infoHash: best.infoHash, title, quality: best.quality?.label || null })
  console.log(`[monitor] grabbed ${title} — ${best.quality?.label || 'unknown quality'}`)
  return record
}

/* One pass over every monitored series. */
export async function run ({ now = Date.now() } = {}) {
  if (running) return { skipped: 'already running' }
  running = true
  const settings = config.get()
  const budget = Math.max(1, Number(settings.maxGrabsPerRun) || 3)
  const queued = queuedVideoIds()
  const grabbed = []

  try {
    for (const entry of library.monitored()) {
      if (grabbed.length >= budget) break

      let meta = null
      try {
        meta = await addons.meta('series', entry.id)
      } catch (err) {
        console.warn(`[monitor] could not look up ${entry.name}: ${err.message}`)
        continue
      }
      if (!meta) continue

      for (const video of episodesToGrab(entry, meta, { now, queued })) {
        if (grabbed.length >= budget) break
        try {
          const record = await grabEpisode(entry, meta, video)
          if (record) {
            grabbed.push({ videoId: video.id, id: record.id, series: entry.name })
            queued.add(video.id)
          }
        } catch (err) {
          console.warn(`[monitor] could not grab ${entry.name} ${video.id}: ${err.message}`)
        }
      }
    }
  } finally {
    running = false
  }

  return { grabbed }
}

export function startMonitor () {
  if (timer) return
  const minutes = Math.max(5, Number(config.get().monitorIntervalMinutes) || 60)
  timer = setInterval(() => {
    if (!config.get().monitorEnabled) return
    run().catch(err => console.error('[monitor]', err.message))
  }, minutes * 60 * 1000)
  timer.unref?.()
}

export function stopMonitor () {
  clearInterval(timer)
  timer = null
}
