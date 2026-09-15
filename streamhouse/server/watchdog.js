/* The queue watchdog.
 *
 * A torrent with no peers sits at 0% forever and nobody notices — the app is
 * happy, the download is dead, and you find out when you sit down to watch.
 * Sonarr solves this by watching its queue, declaring a grab failed,
 * blocklisting the release and searching again for the next best one. This is
 * the same loop, against the local engine.
 *
 * What it will not do is throw away your data. Sonarr removes a failed
 * download from a download client that lives somewhere else; here the queue is
 * the screen you are looking at, so a stalled grab is paused, labelled and
 * left where it is, with its files intact. The replacement appears next to it.
 * Deleting is still yours to do.
 */

import { config } from './config.js'
import { engine, infoHashOf } from './torrent.js'
import { addons } from './addons.js'
import { blocklist } from './blocklist.js'
import { rankStreams } from './rank.js'
import { parseVideoId, parseRuntime } from './parse.js'

const CHECK_INTERVAL_MS = 30 * 1000
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000

// infoHash -> { bytes, since, stalled } — how long a torrent has been sitting
// at the same number of bytes. Memory only: after a restart everything gets a
// fresh timer, which is the forgiving choice.
const progressSeen = new Map()

let timer = null
let pruneTimer = null

/* A torrent the watchdog has an opinion about: actively trying to download,
 * not paused by hand, not finished, not already given up on. */
function isWatchable (torrent) {
  if (torrent.status === 'paused' || torrent.status === 'stalled') return false
  if (torrent.status === 'done' || torrent.status === 'seeding') return false
  return torrent.progress < 1
}

export function checkForStalled (now = Date.now()) {
  const settings = config.get()
  const stallMs = Math.max(1, Number(settings.stallMinutes) || 10) * 60 * 1000
  const stalled = []

  const live = new Set()
  for (const torrent of engine.list()) {
    live.add(torrent.infoHash)

    // Resumed by hand, or finished: forget what we knew and start the clock
    // again if it ever comes back to us.
    if (!isWatchable(torrent)) {
      if (progressSeen.get(torrent.infoHash)?.stalled !== true) progressSeen.delete(torrent.infoHash)
      continue
    }

    const seen = progressSeen.get(torrent.infoHash)
    if (seen?.stalled) {
      // It was stalled and is now watchable again, so the user resumed it.
      progressSeen.set(torrent.infoHash, { bytes: torrent.downloaded, since: now, stalled: false })
      continue
    }

    if (!seen || torrent.downloaded > seen.bytes) {
      progressSeen.set(torrent.infoHash, { bytes: torrent.downloaded, since: now, stalled: false })
      continue
    }

    if (now - seen.since >= stallMs) {
      seen.stalled = true
      stalled.push(torrent)
    }
  }

  // Do not leak entries for torrents that have been deleted.
  for (const hash of progressSeen.keys()) if (!live.has(hash)) progressSeen.delete(hash)

  return stalled
}

/* Give up on one grab: pause it where it stands, say why, and block the hash
 * so neither the ranker nor a later retry offers it again. */
export function giveUp (torrent, { minutes }) {
  const reason = `No data for ${minutes} minute${minutes === 1 ? '' : 's'}`
  blocklist.add({
    infoHash: torrent.infoHash,
    name: torrent.name,
    reason,
    videoId: torrent.meta?.videoId || null
  })

  const record = engine.record(torrent.infoHash)
  if (!record) return null
  try {
    engine.pause(torrent.infoHash)
  } catch (err) {
    console.warn(`[watchdog] could not pause ${torrent.infoHash}: ${err.message}`)
  }
  record.status = 'stalled'
  record.error = `${reason}. Your files are untouched — resume to try it again, or delete it.`
  console.log(`[watchdog] gave up on "${record.name}" — ${reason.toLowerCase()}`)
  return record
}

/* Ask the add-ons again and grab the best release that is not blocklisted.
 * Returns the new record, or null when there is nothing better to try. */
export async function findReplacement (record) {
  const { type, videoId } = record.meta || {}
  if (!type || !videoId) return null

  const streams = await addons.streams(type, videoId)
  if (!streams.length) return null

  // The same context the title page gets, so the replacement is held to the
  // same standard as anything you would have picked by hand.
  const { season, episode } = parseVideoId(videoId)
  let runtime = null
  try {
    const meta = await addons.meta(type, String(videoId).split(':')[0])
    runtime = parseRuntime(meta?.runtime)
  } catch { /* runtime is optional — the size check falls back without it */ }

  const annotated = streams.map(stream => {
    const hash = stream.infoHash || infoHashOf(stream.url || '')
    return { ...stream, infoHash: hash || null }
  })

  const ranked = rankStreams(annotated, config.get(), {
    season,
    episode,
    runtime,
    blocked: blocklist.hashes()
  })

  const next = ranked.find(stream => stream.infoHash && !stream.rejections.length)
  if (!next) return null

  const replacement = engine.add({
    infoHash: next.infoHash,
    sources: next.sources || [],
    fileIdx: next.fileIdx ?? null,
    mode: record.mode,
    meta: record.meta,
    retryOf: record.id
  })
  console.log(`[watchdog] retrying "${record.name}" with ${next.quality?.label || 'another release'}`)
  return replacement
}

export async function tick (now = Date.now()) {
  const settings = config.get()
  const minutes = Math.max(1, Number(settings.stallMinutes) || 10)
  const stalled = checkForStalled(now)
  const results = []

  for (const torrent of stalled) {
    const record = giveUp(torrent, { minutes })
    if (!record) continue
    let replacement = null
    if (settings.autoRetryStalled) {
      try {
        replacement = await findReplacement(record)
      } catch (err) {
        console.warn(`[watchdog] could not look for a replacement: ${err.message}`)
      }
    }
    results.push({ gaveUpOn: record.id, replacement: replacement?.id || null })
  }

  return results
}

export function startWatchdog () {
  if (timer) return
  timer = setInterval(() => {
    tick().catch(err => console.error('[watchdog]', err.message))
  }, CHECK_INTERVAL_MS)
  timer.unref?.()

  blocklist.prune()
  pruneTimer = setInterval(() => blocklist.prune(), PRUNE_INTERVAL_MS)
  pruneTimer.unref?.()
}

export function stopWatchdog () {
  clearInterval(timer)
  clearInterval(pruneTimer)
  timer = null
  pruneTimer = null
  progressSeen.clear()
}
