/* "For you": titles like the ones this profile watched and saved.
 *
 * The rules are in taste.js; this fetches what they need. The titles you
 * watched are looked up for their genres and people, the catalogues are asked
 * for those genres, and everything that comes back is ranked against them.
 * Asked again within a few minutes, with nothing new watched, the last answer
 * is reused, so Back and switching filters do not start over. */

import { api } from './api.js'
import { browsable } from './util.js'
import { currentViewer } from './viewers.js'
import { seedsFrom, seenTitles, rankPicks, tasteGenres } from './taste.js'

// Shown in Discover as a catalogue of each kind, first in the row.
export const FOR_YOU = { addonId: 'streamhouse', id: 'foryou', name: 'For you' }

export const isForYou = catalog => catalog?.addonId === FOR_YOU.addonId && catalog?.id === FOR_YOU.id

export const forYouHref = type => `#/discover?addon=${FOR_YOU.addonId}&type=${encodeURIComponent(type)}&id=${FOR_YOU.id}`

const FRESH_MS = 10 * 60 * 1000

// How many of your strongest genres the catalogues are asked for.
const GENRES_ASKED = 4

const answers = new Map()
const records = new Map()

// What this profile watched and saved: cheap, both are local.
//   watched: titles with anything watched or started
//   known:   those, and everything saved — never suggested back
export async function loadTaste () {
  const [progress, library] = await Promise.all([
    api.progress().catch(() => ({})),
    api.library().catch(() => [])
  ])
  const watched = seenTitles(progress)
  return {
    progress,
    library,
    watched,
    known: new Set([...watched, ...library.map(item => item.id)]),
    seeds: seedsFrom(progress, library)
  }
}

// For films or series: { picks: [{ meta, score, because }], seeds } — seeds
// with their records, the ones the picks were measured against. With `genre`,
// only that genre is asked for.
export function forYou (type, { genre = '', taste, catalogs } = {}) {
  return (async () => {
    taste = taste || await loadTaste()
    if (!taste.seeds.length) return { picks: [], seeds: [] }
    const key = [currentViewer(), type, genre, taste.seeds.map(seed => seed.id).join(',')].join('|')
    const hit = answers.get(key)
    if (hit && Date.now() - hit.at < FRESH_MS) return hit.answer
    const answer = work(type, genre, taste, catalogs)
    answers.set(key, { at: Date.now(), answer })
    answer.catch(() => answers.delete(key))
    return answer
  })()
}

async function work (type, genre, taste, catalogs) {
  catalogs = catalogs || await api.catalogs()
  const seeds = (await Promise.all(taste.seeds.map(async seed => ({ ...seed, meta: await recordOf(seed) }))))
    .filter(seed => seed.meta)
  if (!seeds.length) return { picks: [], seeds: [] }
  const wanted = genre ? [genre] : tasteGenres(seeds).slice(0, GENRES_ASKED)
  const lists = await Promise.all(sourcesFor(catalogs, type, wanted, Boolean(genre))
    .map(({ catalog, genre, pages }) => pagesOf(catalog, genre, pages)))
  return { picks: rankPicks(lists.flat(), seeds, { exclude: taste.known }), seeds }
}

function recordOf (seed) {
  const key = `${seed.type}:${seed.id}`
  if (!records.has(key)) records.set(key, api.meta(seed.type, seed.id).catch(() => null))
  return records.get(key)
}

// Which pages to ask each catalogue of this kind for: your genres, where it
// offers them, plus its unfiltered first page for breadth.
function sourcesFor (catalogs, type, wanted, chosen) {
  const sources = []
  for (const catalog of catalogs) {
    if (catalog.type !== type || !browsable(catalog)) continue
    const offered = catalog.genres || []
    const needsGenre = (catalog.requires || []).includes('genre')
    const matching = wanted.filter(genre => offered.includes(genre))
    if (matching.length) {
      matching.forEach(genre => sources.push({ catalog, genre, pages: chosen ? 3 : 2 }))
      if (!chosen && !needsGenre) sources.push({ catalog, genre: '', pages: 1 })
    } else if (needsGenre) {
      // Cinemeta's "New" is split by year, not genre: its latest two.
      offered.slice(0, 2).forEach(option => sources.push({ catalog, genre: option, pages: 1 }))
    } else if (!chosen || !offered.length) {
      sources.push({ catalog, genre: '', pages: 2 })
    }
  }
  return sources
}

async function pagesOf (catalog, genre, count) {
  const metas = []
  for (let page = 0; page < count; page += 1) {
    const batch = await api.catalog({ addon: catalog.addonId, type: catalog.type, id: catalog.id, genre, skip: metas.length })
      .catch(() => [])
    if (!batch.length) break
    metas.push(...batch)
  }
  return metas
}
