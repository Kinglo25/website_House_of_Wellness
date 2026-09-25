/* What has been watched, and how far: the rules for the progress map.
 *
 * One entry per video: { id, time, duration, meta, updatedAt, watched?, hidden? }.
 * `time` is where to carry on from, 0 when there is nothing to carry on. `watched`
 * says the video has been seen to the end at least once — it stays when the video
 * is started again, as Netflix and Stremio both keep a tick on an episode you are
 * rewatching. `hidden` takes a finished episode off the "Up next" row.
 *
 * Kept free of stores so the tests can check it directly. Each function takes
 * the whole map and returns the entry it wrote, or null for one it removed. */

// Past this share of the running time, the rest is credits.
export const FINISHED_AT = 0.93

export function recordPosition (all, { id, time, duration, meta }, now = Date.now()) {
  const previous = all[id]
  time = Number(time) || 0
  duration = Number(duration) || 0
  const finished = duration > 0 && time / duration > FINISHED_AT
  if (!finished && !time && !previous?.watched) {
    delete all[id]
    return null
  }
  const entry = {
    id,
    time: finished ? 0 : time,
    duration: duration || previous?.duration || 0,
    meta: meta || previous?.meta,
    updatedAt: now
  }
  if (finished || previous?.watched) entry.watched = true
  all[id] = entry
  return entry
}

// The tick on an episode, set or cleared by hand.
export function setWatched (all, { id, watched, meta }, now = Date.now()) {
  const previous = all[id]
  if (watched) {
    all[id] = { id, time: 0, duration: previous?.duration || 0, meta: meta || previous?.meta, updatedAt: now, watched: true }
    return all[id]
  }
  if (!previous) return null
  if (!previous.time) {
    delete all[id]
    return null
  }
  const { watched: _, hidden: __, ...rest } = previous
  all[id] = { ...rest, updatedAt: now }
  return all[id]
}

// "Remove from row". Something part-way through loses its place — and the entry
// with it, unless it was once watched, when the tick is worth keeping. Something
// finished stays watched but stops offering what comes after it.
export function hide (all, id, now = Date.now()) {
  const previous = all[id]
  if (!previous) return null
  if (previous.time > 0) {
    if (!previous.watched) {
      delete all[id]
      return null
    }
    all[id] = { ...previous, time: 0, updatedAt: now }
    return all[id]
  }
  all[id] = { ...previous, hidden: true, updatedAt: now }
  return all[id]
}
