/* Releases that did not work out.
 *
 * Sonarr blocklists a release when its download fails, so the next search
 * cannot hand back the same dead torrent it just gave up on. Same idea here:
 * an info-hash that stalled goes in, the ranker rejects it from every future
 * stream list, and the watchdog never retries it.
 *
 * Entries age out, because a swarm that was empty in March may be busy in
 * June — a blocklist that only grows eventually hides good releases.
 */

import { JsonStore } from './store.js'

const store = new JsonStore('blocklist', [])
const DEFAULT_MAX_AGE_DAYS = 30

function normalize (hash) {
  return String(hash || '').trim().toLowerCase()
}

export const blocklist = {
  list () {
    return store.get()
  },

  hashes () {
    return store.get().map(entry => entry.infoHash)
  },

  has (infoHash) {
    const hash = normalize(infoHash)
    return Boolean(hash) && store.get().some(entry => entry.infoHash === hash)
  },

  /* Idempotent: blocking the same hash twice keeps the first reason and the
   * first date, so "when did this start failing?" stays answerable. */
  add ({ infoHash, name = '', reason = 'Did not work out', videoId = null }) {
    const hash = normalize(infoHash)
    if (!hash) return null
    const existing = store.get().find(entry => entry.infoHash === hash)
    if (existing) return existing
    const entry = { infoHash: hash, name, reason, videoId, at: Date.now() }
    store.set([entry, ...store.get()])
    return entry
  },

  remove (infoHash) {
    const hash = normalize(infoHash)
    const before = store.get().length
    store.set(store.get().filter(entry => entry.infoHash !== hash))
    return before !== store.get().length
  },

  clear () {
    const removed = store.get().length
    store.set([])
    return removed
  },

  prune (maxAgeDays = DEFAULT_MAX_AGE_DAYS) {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
    const kept = store.get().filter(entry => entry.at > cutoff)
    const removed = store.get().length - kept.length
    if (removed) store.set(kept)
    return removed
  }
}
