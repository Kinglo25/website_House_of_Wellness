/* Reading the progress map: what to carry on with, and what comes next.
 *
 * No DOM here, so the tests can import it. The map's rules are in
 * server/watching.js: `time` is where to carry on from, `watched` a video seen
 * to the end, `hidden` a finished one taken off the "Up next" row. */

// The show an entry belongs to, for an episode; null for anything else.
export function seriesOf (entry) {
  const meta = entry?.meta || {}
  return meta.type === 'series' && meta.imdbId ? meta.imdbId : null
}

// Continue watching: everything part-way through, newest first — one tile per
// show, the episode touched last, as Netflix and Stremio both do.
export function inProgress (all) {
  const seen = new Set()
  return Object.values(all || {})
    .filter(entry => entry && entry.time > 0)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .filter(entry => {
      const series = seriesOf(entry)
      if (!series) return true
      if (seen.has(series)) return false
      seen.add(series)
      return true
    })
}

// Shows whose last thing watched was an episode seen to the end — the ones
// that might have a next episode to offer. Newest first; a show with anything
// part-way through is already on continue watching instead.
export function upNextCandidates (all) {
  const latest = new Map()
  for (const entry of Object.values(all || {})) {
    const series = seriesOf(entry)
    if (!series) continue
    const current = latest.get(series)
    if (!current || (entry.updatedAt || 0) > (current.updatedAt || 0)) latest.set(series, entry)
  }
  return [...latest.values()]
    .filter(entry => entry.watched && !(entry.time > 0) && !entry.hidden)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
}

// Episodes in watching order, specials left out unless that is all there is.
export function episodeOrder (videos = []) {
  const list = videos.filter(video => video && video.id)
  const regular = list.filter(video => Number(video.season) !== 0)
  return (regular.length ? regular : list)
    .slice()
    .sort((a, b) => (Number(a.season) - Number(b.season)) || (Number(a.episode) - Number(b.episode)))
}

export function isReleased (video, now = Date.now()) {
  if (!video?.released) return true
  const at = Date.parse(video.released)
  return Number.isNaN(at) || at <= now
}

/* Where a series page should start you.
 *
 *   { action: 'resume', video, entry }   part-way through an episode
 *   { action: 'next', video }            the episode after the last one finished
 *   { action: 'upcoming', video }        …which has not aired yet
 *   { action: 'start', video }           nothing watched yet: the first episode
 *   { action: 'again', video }           everything out has been watched
 *   null                                 no episode is out yet
 */
export function upNext (videos, all, now = Date.now()) {
  const order = episodeOrder(videos)
  const released = order.filter(video => isReleased(video, now))
  if (!released.length) return null

  let latest = null
  for (const video of order) {
    const entry = all?.[video.id]
    if (entry && (!latest || (entry.updatedAt || 0) > (latest.entry.updatedAt || 0))) latest = { video, entry }
  }
  if (!latest) return { action: 'start', video: released[0] }
  if (latest.entry.time > 0) return { action: 'resume', video: latest.video, entry: latest.entry }

  const after = order[order.indexOf(latest.video) + 1]
  if (after) return isReleased(after, now) ? { action: 'next', video: after } : { action: 'upcoming', video: after }
  return { action: 'again', video: released[0] }
}

// "S1:E4", the way Netflix labels an episode on its buttons.
export function episodeLabel (video) {
  return video && video.season != null && video.episode != null ? `S${video.season}:E${video.episode}` : ''
}
