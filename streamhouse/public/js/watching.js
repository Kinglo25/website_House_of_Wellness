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
    // On a tie — a season marked at once — the one furthest along wins.
    if (entry && (!latest || (entry.updatedAt || 0) >= (latest.entry.updatedAt || 0))) latest = { video, entry }
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

/* ---------------------------------------------------------------- library */

// When anything of this title was last watched: the film itself, or any
// episode of the show.
export function lastWatched (item, all) {
  let latest = 0
  for (const entry of Object.values(all || {})) {
    if (entry?.id === item.id || entry?.meta?.imdbId === item.id) latest = Math.max(latest, entry.updatedAt || 0)
  }
  return latest
}

export const LIBRARY_SORTS = {
  added: 'Recently added',
  watched: 'Recently watched',
  name: 'A–Z',
  year: 'Newest release'
}

// The saved list, filtered to a type ('' for all) and ordered, as Stremio's
// library is. Never-watched titles go after watched ones, newest added first.
export function sortLibrary (items, all, { sort = 'added', type = '' } = {}) {
  const year = item => parseInt(String(item.releaseInfo || item.year || '').slice(0, 4), 10) || 0
  const byAdded = (a, b) => (b.addedAt || 0) - (a.addedAt || 0)
  const compare = {
    added: byAdded,
    watched: (a, b) => (lastWatched(b, all) - lastWatched(a, all)) || byAdded(a, b),
    name: (a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base', numeric: true }),
    year: (a, b) => (year(b) - year(a)) || byAdded(a, b)
  }[sort] || byAdded
  return items.filter(item => !type || item.type === type).slice().sort(compare)
}

/* --------------------------------------------------------------- calendar */

const DAY = 864e5

// The shows worth checking for new episodes: saved series, and any series
// watched from, newest activity first. [{ id, type }]
export function followedShows (library, all) {
  const shows = new Map()
  for (const item of library || []) {
    if (item.type === 'series') shows.set(item.id, { id: item.id, type: 'series', at: item.addedAt || 0 })
  }
  for (const entry of Object.values(all || {})) {
    const series = seriesOf(entry)
    if (!series) continue
    const at = Math.max(shows.get(series)?.at || 0, entry.updatedAt || 0)
    shows.set(series, { id: series, type: 'series', at })
  }
  return [...shows.values()].sort((a, b) => b.at - a.at).map(({ id, type }) => ({ id, type }))
}

// Stremio's calendar, in two lists: episodes out in the last `recentDays` and
// not yet watched, newest first; and those airing in the next `aheadDays`,
// soonest first. `shows` is [{ meta, videos }].
export function episodeCalendar (shows, all, { now = Date.now(), recentDays = 14, aheadDays = 30 } = {}) {
  const fresh = []
  const upcoming = []
  for (const { meta, videos } of shows) {
    for (const video of episodeOrder(videos)) {
      const at = Date.parse(video.released)
      if (Number.isNaN(at)) continue
      if (at <= now && at > now - recentDays * DAY && !all?.[video.id]?.watched) fresh.push({ meta, video, at })
      else if (at > now && at <= now + aheadDays * DAY) upcoming.push({ meta, video, at })
    }
  }
  fresh.sort((a, b) => b.at - a.at)
  upcoming.sort((a, b) => a.at - b.at)
  return { fresh, upcoming }
}
