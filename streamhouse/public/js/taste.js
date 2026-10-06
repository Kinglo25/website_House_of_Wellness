/* Taste: what "For you" suggests, from what a profile watched and saved.
 *
 * No recommendation service is involved and nothing leaves the machine. A
 * title's record already names its genres, main cast, director, writers,
 * country and year, so "more like this" is worked out by comparing those with
 * the titles you spent time on, weighted by how much and how lately.
 *
 * No DOM here, so the tests can import it. foryou.js does the fetching. */

import { seriesOf } from './watching.js'

const DAY = 864e5

// A title's pull halves over this many days, down to a floor: last week's
// binge counts most, but an old favourite still counts.
const HALF_LIFE_DAYS = 45

// Below this a candidate is not like anything you watched, only popular.
const MIN_MATCH = 0.12

// A tile says which of your titles it is like only when it really is.
const REASON_AT = 0.3

// Genres that change what a title is, not only what it is about: someone
// watching animation is rarely after live action, nor a horror fan after a
// family film. A mismatch on one halves the likeness.
const DEFINING = ['Animation', 'Documentary', 'Horror', 'Family', 'Reality-TV', 'Talk-Show', 'Game-Show']

/* ------------------------------------------------------------------ fields */

export function ratingOf (meta) {
  return Number(meta?.imdbRating) || 0
}

// A series' first year: "2019–2023" is 2019.
export function yearOf (meta) {
  return parseInt(String(meta?.releaseInfo || meta?.year || '').slice(0, 4), 10) || 0
}

const list = value => Array.isArray(value)
  ? value.filter(Boolean).map(String)
  : typeof value === 'string' && value ? value.split(/\s*,\s*/).filter(Boolean) : []

export function genresOf (meta) {
  return list(meta?.genres?.length ? meta.genres : meta?.genre)
}

/* ------------------------------------------------------------------ eras */

export const ERAS = [
  ['', 'Any year'],
  ['2020', '2020s'],
  ['2010', '2010s'],
  ['2000', '2000s'],
  ['1990', '1990s'],
  ['old', 'Before 1990']
]

export function inEra (meta, era) {
  if (!era) return true
  const year = yearOf(meta)
  if (!year) return false
  if (era === 'old') return year < 1990
  const start = Number(era)
  return year >= start && year < start + 10
}

/* ------------------------------------------------------ what you watched */

// The title a progress entry belongs to: the show for an episode, else the film.
export function titleOf (entry) {
  return seriesOf(entry) || entry?.meta?.imdbId || entry?.id || null
}

// Every title with anything watched or started, as its catalogue id.
export function seenTitles (all) {
  const seen = new Set()
  for (const entry of Object.values(all || {})) {
    const id = entry && titleOf(entry)
    if (id) seen.add(id)
  }
  return seen
}

/* What to go on: one seed per title, strongest first.
 *
 *   { id, type, name, weight }
 *
 * A film counts once watched through, and in part for the part watched; a
 * show grows with its episodes, up to about five. Saving a title counts as
 * interest. All of it fades with time since the title was last touched. */
export function seedsFrom (all, library = [], { now = Date.now(), limit = 12 } = {}) {
  const titles = new Map()
  const touch = (id, type, name) => {
    if (!titles.has(id)) titles.set(id, { id, type, name: '', share: 0, saved: false, at: 0 })
    const title = titles.get(id)
    if (name && !title.name) title.name = name
    return title
  }
  for (const entry of Object.values(all || {})) {
    const id = entry && titleOf(entry)
    if (!id) continue
    const series = seriesOf(entry)
    const name = String(entry.meta?.name || entry.meta?.title || '').replace(/\s+S\d+E\d+$/, '')
    const title = touch(id, series ? 'series' : entry.meta?.type || 'movie', name)
    title.share += entry.watched ? 1 : entry.duration > 0 ? Math.min(1, (entry.time || 0) / entry.duration) : 0
    title.at = Math.max(title.at, entry.updatedAt || 0)
  }
  for (const item of library || []) {
    if (!item?.id) continue
    const title = touch(item.id, item.type, item.name)
    title.saved = true
    title.at = Math.max(title.at, item.addedAt || 0)
  }
  return [...titles.values()]
    .filter(title => title.type === 'movie' || title.type === 'series')
    .map(title => {
      const watched = title.type === 'series' ? Math.min(1.7, 0.35 * title.share) : Math.min(1, title.share)
      const engagement = 0.3 + watched + (title.saved ? 0.4 : 0)
      const age = Math.max(0, now - title.at) / DAY
      const recency = 0.35 + 0.65 * 0.5 ** (age / HALF_LIFE_DAYS)
      return { id: title.id, type: title.type, name: title.name, weight: engagement * recency }
    })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit)
}

// The kinds a profile watches, most-watched first.
export function tasteTypes (seeds) {
  const totals = new Map()
  for (const seed of seeds || []) totals.set(seed.type, (totals.get(seed.type) || 0) + seed.weight)
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([type]) => type)
}

// The genres a profile leans to, strongest first. Seeds carry their records.
export function tasteGenres (seeds) {
  const totals = new Map()
  for (const seed of seeds || []) {
    const genres = genresOf(seed.meta)
    for (const genre of genres) totals.set(genre, (totals.get(genre) || 0) + seed.weight / genres.length)
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([genre]) => genre)
}

/* ------------------------------------------------------------- likeness */

// A title reduced to what comparing needs. Catalogue entries and full records
// carry the same fields.
export function traitsOf (meta) {
  return {
    genres: new Set(genresOf(meta)),
    people: new Set([...list(meta?.cast), ...list(meta?.director), ...list(meta?.writer)].map(name => name.toLowerCase())),
    countries: new Set(list(meta?.country)),
    year: yearOf(meta)
  }
}

// How alike two titles are, 0 to 1: mostly the same mix of genres, then the
// same people, the same country, and a similar age.
export function similarity (a, b) {
  if (!a.genres.size || !b.genres.size) return 0
  let shared = 0
  for (const genre of a.genres) if (b.genres.has(genre)) shared += 1
  let score = 0.6 * shared / (a.genres.size + b.genres.size - shared)
  let people = 0
  for (const name of a.people) if (b.people.has(name)) people += 1
  // The same country or year on their own do not make two titles alike.
  if (!shared && !people) return 0
  score += 0.25 * Math.min(1, people / 2)
  for (const country of a.countries) {
    if (b.countries.has(country)) {
      score += 0.08
      break
    }
  }
  if (a.year && b.year) score += 0.07 * Math.max(0, 1 - Math.abs(a.year - b.year) / 30)
  for (const genre of DEFINING) if (a.genres.has(genre) !== b.genres.has(genre)) score *= 0.5
  return score
}

/* The candidates, ranked by how much they are like what you watch.
 *
 *   [{ meta, score, because }]   because: the name of the title it is most like
 *
 * `seeds` carry their records as `meta`; `exclude` is every title already
 * watched, started or saved. Being like one title a lot counts as much as being
 * a little like all of them, and a better rating lifts a match by up to 30%. */
export function rankPicks (candidates, seeds, { exclude = new Set() } = {}) {
  const known = (seeds || [])
    .filter(seed => seed.meta && seed.weight > 0)
    .map(seed => ({ weight: seed.weight, name: seed.meta.name || seed.name, traits: traitsOf(seed.meta) }))
  if (!known.length) return []
  const strongest = Math.max(...known.map(seed => seed.weight))
  const total = known.reduce((sum, seed) => sum + seed.weight, 0)

  const scored = []
  const done = new Set()
  for (const meta of candidates || []) {
    if (!meta?.id || exclude.has(meta.id) || done.has(meta.id)) continue
    done.add(meta.id)
    const traits = traitsOf(meta)
    let best = null
    let bestPull = 0
    let bestLikeness = 0
    let pulls = 0
    for (const seed of known) {
      const likeness = similarity(traits, seed.traits)
      const pull = seed.weight * likeness
      pulls += pull
      if (pull > bestPull) {
        bestPull = pull
        bestLikeness = likeness
        best = seed
      }
    }
    const match = 0.5 * bestPull / strongest + 0.5 * pulls / total
    if (match < MIN_MATCH) continue
    const quality = Math.min(1, Math.max(0, (ratingOf(meta) - 6) / 3))
    scored.push({ meta, score: match * (0.7 + 0.3 * quality), because: bestLikeness >= REASON_AT ? best.name : null })
  }
  return diversify(scored)
}

// Best first, but no one title of yours fills the list: each further pick like
// the same title counts for a little less, so what is like your other titles
// gets its turn. Picks like nothing in particular never get a turn of their
// own; they come in on their score, discounted.
function diversify (scored) {
  const groups = new Map()
  for (const item of scored.slice().sort((a, b) => b.score - a.score)) {
    if (!groups.has(item.because)) groups.set(item.because, [])
    groups.get(item.because).push(item)
  }
  const used = new Map()
  const out = []
  while (out.length < scored.length) {
    let pick = null
    let value = -1
    for (const [because, items] of groups) {
      if (!items.length) continue
      const candidate = items[0].score * (because === null ? 0.6 : 0.85 ** (used.get(because) || 0))
      if (candidate > value) {
        value = candidate
        pick = because
      }
    }
    out.push(groups.get(pick).shift())
    used.set(pick, (used.get(pick) || 0) + 1)
  }
  return out
}

export const PICK_SORTS = [
  ['match', 'Best match'],
  ['rating', 'Highest rated'],
  ['newest', 'Newest']
]

// Ranked picks in another order; ties keep the ranking's.
export function sortPicks (picks, sort = 'match') {
  const by = {
    rating: pick => ratingOf(pick.meta),
    newest: pick => yearOf(pick.meta)
  }[sort]
  if (!by) return picks.slice()
  return picks.map((pick, index) => ({ pick, index }))
    .sort((a, b) => (by(b.pick) - by(a.pick)) || (a.index - b.index))
    .map(({ pick }) => pick)
}

/* ------------------------------------------------------------ billboard */

/* Home's billboard: a handful of titles to choose from, as varied as the
 * sources allow. `sources` take turns in the order given, each
 *
 *   { label, items: [{ meta, because? }] }
 *
 * and gives at most `perSource`, from its first ten, starting a little further
 * along each day so the billboard changes daily. A genre already featured waits
 * until the other genres have had their turn; a title without wide artwork only
 * when its source has little else. Each slide carries its source's label. */
export function mixSlides (sources, { max = 8, perSource = 2, day = 0, exclude = new Set() } = {}) {
  const queues = (sources || []).map(source => {
    const usable = (source.items || []).filter(item => item?.meta?.id && !exclude.has(item.meta.id) && (item.meta.background || item.meta.poster))
    const wide = usable.filter(item => item.meta.background)
    const pool = (wide.length >= 3 ? wide : usable).slice(0, 10)
    const offset = pool.length ? day % pool.length : 0
    return { label: source.label, items: [...pool.slice(offset), ...pool.slice(0, offset)] }
  })
  const slides = []
  const ids = new Set()
  const genres = new Set()
  const take = (queue, strict) => {
    const index = queue.items.findIndex(item => !ids.has(item.meta.id) && (!strict || !genres.has(genresOf(item.meta)[0])))
    if (index < 0) return false
    const [item] = queue.items.splice(index, 1)
    ids.add(item.meta.id)
    genres.add(genresOf(item.meta)[0])
    slides.push({ ...item, label: queue.label })
    return true
  }
  for (let round = 0; round < perSource; round += 1) {
    for (const queue of queues) {
      if (slides.length >= max) return slides
      if (!take(queue, true)) take(queue, false)
    }
  }
  return slides
}
