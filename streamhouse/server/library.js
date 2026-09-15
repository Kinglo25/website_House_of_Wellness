/* Saved titles, and which of them to keep an eye on.
 *
 * Lives here rather than in the API routes because the monitor reads it too:
 * "what am I watching, and since when?"
 *
 * That "since when" is the important field. Turning monitoring on for a show
 * with six aired seasons must not start six seasons of downloads — so an
 * episode only counts as new if it aired after you asked to be told about it.
 */

import { JsonStore } from './store.js'

const store = new JsonStore('library', [])

export const library = {
  list () {
    return store.get()
  },

  find (id) {
    return store.get().find(entry => entry.id === id) || null
  },

  /* Re-adding a title keeps whatever was already decided about it, so
   * pressing "Add to library" again never silently stops monitoring. */
  add (item) {
    const existing = library.find(item.id)
    const items = store.get().filter(entry => entry.id !== item.id)
    const record = {
      ...item,
      monitored: existing?.monitored ?? false,
      monitoredSince: existing?.monitoredSince ?? null,
      addedAt: existing?.addedAt ?? Date.now()
    }
    items.unshift(record)
    store.set(items)
    return record
  },

  remove (id) {
    store.set(store.get().filter(entry => entry.id !== id))
    return id
  },

  /* Monitoring starts counting from now: everything already aired is in the
   * past and stays there. */
  setMonitored (id, monitored, now = Date.now()) {
    const entry = library.find(id)
    if (!entry) return null
    entry.monitored = Boolean(monitored)
    entry.monitoredSince = entry.monitored ? (entry.monitoredSince ?? now) : null
    store.save()
    return entry
  },

  monitored () {
    return store.get().filter(entry => entry.monitored && entry.type === 'series')
  }
}

/* What the monitor has already grabbed, so an episode is never fetched twice —
 * including after the download is deleted, which is the whole point of keeping
 * it separately from the queue. Sonarr calls this history. */
const grabStore = new JsonStore('grabs', [])
const MAX_GRABS = 500

export const grabs = {
  list () {
    return grabStore.get()
  },

  has (videoId) {
    return grabStore.get().some(entry => entry.videoId === videoId)
  },

  add ({ videoId, infoHash, title, quality = null }) {
    if (!videoId) return null
    const entry = { videoId, infoHash, title, quality, at: Date.now() }
    grabStore.set([entry, ...grabStore.get().filter(item => item.videoId !== videoId)].slice(0, MAX_GRABS))
    return entry
  },

  forget (videoId) {
    grabStore.set(grabStore.get().filter(entry => entry.videoId !== videoId))
    return videoId
  },

  clear () {
    grabStore.set([])
  }
}
