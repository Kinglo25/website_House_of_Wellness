import { api } from '../api.js'
import { h, bytes, esc, wellRated, browsable } from '../util.js'
import { metaCard, pickCard, continueCard, upNextCard, shelf, skeletonStrip, emptyState, errorBox, seeAllCard, withShowDetails } from '../components.js'
import { continueRow, seriesOf, upNext } from '../watching.js'
import { tasteTypes } from '../taste.js'
import { loadTaste, forYou, forYouHref } from '../foryou.js'
import { billboard } from '../billboard.js'

const TYPE_LABELS = { movie: 'Films', series: 'Series', channel: 'Channels', tv: 'TV' }

// The billboard waits this long at most for its sources before showing.
const SETTLE_MS = 2500

// Home. Continue watching, whatever is downloading right now, then the first
// page of every catalogue the installed add-ons expose.
export default async function board ({ container }) {
  container.innerHTML = '<div class="pad" id="board"></div>'
  const root = container.querySelector('#board')

  // Netflix's billboard, with a choice: a few titles from your For you picks
  // and each catalogue, films and series of different genres, a different set
  // each day. A placeholder holds its place until they answer; if none does,
  // the page keeps its plain heading.
  const billboardSlot = h('<div class="billboard-slot"></div>')
  const heading = h('<div><h1>Home</h1><p class="muted" style="margin-top:0">Everything your add-ons are offering right now.</p></div>')
  root.append(billboardSlot, heading)
  const hero = billboard(billboardSlot, heading)
  // What you watched and saved, asked once: For you and the billboard both use it.
  const tasting = loadTaste()

  // What is already on this machine comes first, and never waits on the
  // add-ons: a slow or broken catalogue used to take the whole page down with
  // it, continue watching included.
  await renderContinueWatching(root)
  await renderActiveDownloads(root)

  const loading = shelf({ title: 'Loading…' })
  loading.strip.replaceWith(skeletonStrip())
  root.append(loading)

  let catalogs = []
  try {
    catalogs = await api.catalogs()
  } catch (err) {
    loading.remove()
    root.append(errorBox(err.message))
    hero.settle()
    return
  }
  loading.remove()

  if (!catalogs.length) {
    root.append(emptyState({
      title: 'No catalogues yet',
      message: 'Install an add-on and its catalogues will show up here.',
      action: 'Open add-ons',
      href: '#/addons'
    }))
    hero.settle()
    return
  }

  const taste = await tasting
  // The billboard is for finding something: nothing already watched or saved.
  hero.skip(taste.known)
  const answers = []

  // What is like the titles you watch comes before what the add-ons offer.
  const picks = h('<div></div>')
  root.append(picks)
  answers.push(renderForYou(picks, catalogs.filter(browsable), taste, hero))

  // Only fetch the catalogues that can be paged as they are, and cap the
  // number of parallel requests so a slow add-on cannot stall the page.
  const usable = catalogs.filter(browsable).slice(0, 12)
  usable.forEach((catalog, index) => {
    const node = shelf({
      title: catalog.name,
      source: catalog.addonName,
      moreHref: `#/discover?addon=${encodeURIComponent(catalog.addonId)}&type=${encodeURIComponent(catalog.type)}&id=${encodeURIComponent(catalog.id)}`
    })
    const placeholderStrip = skeletonStrip(6)
    node.strip.replaceWith(placeholderStrip)
    root.append(node)

    answers.push(api.catalog({ addon: catalog.addonId, type: catalog.type, id: catalog.id })
      .then(metas => {
        metas = metas.filter(wellRated)
        if (!metas.length) return node.remove()
        hero.offer(`${catalog.addonId}:${catalog.type}:${catalog.id}`, {
          label: `${catalog.name} · ${TYPE_LABELS[catalog.type] || catalog.type}`,
          order: index,
          items: metas.map(meta => ({ meta: { type: catalog.type, ...meta } }))
        })
        const strip = h('<div class="strip"></div>')
        metas.slice(0, 24).forEach(meta => strip.append(metaCard(meta)))
        strip.append(seeAllCard(node.moreHref))
        placeholderStrip.replaceWith(strip)
      })
      .catch(() => node.remove()))
  })

  // The billboard shows once everything has answered, or after a moment,
  // whichever comes first; a slower answer is fitted in after what is on screen.
  Promise.allSettled(answers).then(() => hero.settle())
  setTimeout(() => hero.settle(), SETTLE_MS)
}

// Part-way through, one tile per show; then, as Netflix and Stremio do, the
// episode after one just finished. Finding that needs the show's episode list,
// so those tiles arrive a moment later and slot in by when they were watched.
async function renderContinueWatching (root) {
  let all = {}
  try {
    all = await api.progress()
  } catch { return }
  // One tile per show, decided by the latest thing watched in it.
  const row = continueRow(all)
  const entries = row.filter(item => item.kind === 'resume').map(item => item.entry).slice(0, 20)
  const candidates = row.filter(item => item.kind === 'next').map(item => item.entry).slice(0, 8)
  if (!entries.length && !candidates.length) return

  const node = shelf({ title: 'Continue watching', moreHref: '#/library' })
  const place = (card, updatedAt) => {
    card.dataset.at = String(updatedAt || 0)
    const later = [...node.strip.children].find(other => Number(other.dataset.at) < (updatedAt || 0))
    node.strip.insertBefore(card, later || null)
    node.hidden = false
  }
  // Oldest of all, so every tile placed by time lands before it.
  place(seeAllCard(node.moreHref), -1)
  // An episode saved without its show's name and poster (the TV app's own
  // player sends neither) gets them from the show, then takes its place.
  const shows = new Map()
  const showOf = id => {
    if (!shows.has(id)) shows.set(id, api.meta('series', id).catch(() => null))
    return shows.get(id)
  }
  entries.forEach(async entry => {
    const series = seriesOf(entry)
    if (series && !entry.meta?.name) entry = withShowDetails(entry, series, await showOf(series))
    place(continueCard(entry, { onRemove: () => api.hideProgress(entry.id) }), entry.updatedAt)
  })
  node.hidden = !entries.length
  root.append(node)

  // Not awaited: the catalogues below must not wait on these.
  candidates.forEach(async entry => {
    const type = 'series'
    const imdbId = seriesOf(entry)
    const series = await showOf(imdbId)
    if (!series) return
    const next = upNext(series?.videos || [], all)
    if (next?.action !== 'next') return
    place(upNextCard({ ...series, type, id: imdbId }, next.video, { onRemove: () => api.hideProgress(entry.id) }), entry.updatedAt)
  })
}

// "Series for you", "Films for you": one row per kind you watch, most-watched
// first. A profile with nothing watched or saved has none.
const FOR_YOU_ROWS = { movie: 'Films for you', series: 'Series for you' }

// The best of them are offered to the billboard too, ahead of the catalogues.
function renderForYou (slot, catalogs, taste, hero) {
  const types = tasteTypes(taste.seeds).filter(type => FOR_YOU_ROWS[type] && catalogs.some(catalog => catalog.type === type))
  return Promise.all(types.map(async (type, index) => {
    const node = shelf({ title: FOR_YOU_ROWS[type], moreHref: forYouHref(type) })
    const placeholder = skeletonStrip(6)
    node.strip.replaceWith(placeholder)
    slot.append(node)
    try {
      const shown = (await forYou(type, { taste, catalogs })).picks.filter(pick => wellRated(pick.meta))
      if (!shown.length) return node.remove()
      hero.offer(`foryou:${type}`, { label: FOR_YOU_ROWS[type], order: index - types.length, items: shown.slice(0, 10) })
      const strip = h('<div class="strip"></div>')
      shown.slice(0, 24).forEach(pick => strip.append(pickCard(pick)))
      strip.append(seeAllCard(node.moreHref))
      placeholder.replaceWith(strip)
    } catch {
      node.remove()
    }
  }))
}

async function renderActiveDownloads (root) {
  let data
  try {
    data = await api.torrents()
  } catch { return }
  // Downloads you asked for that are not finished. A finished one keeps
  // seeding, and a stream's own cache is not something you asked to keep, so
  // neither belongs on a row called "Downloading now".
  const active = data.torrents.filter(torrent =>
    torrent.mode === 'download' && !['done', 'seeding', 'error'].includes(torrent.status) && torrent.progress < 1)
  if (!active.length) return

  const node = shelf({ title: 'Downloading now', moreHref: '#/downloads' })
  active.slice(0, 12).forEach(torrent => {
    node.strip.append(metaCard(
      { name: torrent.name, id: torrent.id, type: torrent.meta?.type || 'movie', poster: torrent.meta?.poster },
      {
        progress: torrent.progress,
        ribbon: `${Math.round(torrent.progress * 100)}%`,
        sub: `${bytes(torrent.downloadSpeed, true)} · ${esc(torrent.status)}`,
        open: '#/downloads'
      }
    ))
  })
  node.strip.append(seeAllCard(node.moreHref))
  root.append(node)
}
