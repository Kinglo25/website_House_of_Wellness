import { api } from '../api.js'
import { h, bytes, esc } from '../util.js'
import { metaCard, continueCard, upNextCard, shelf, skeletonStrip, emptyState, errorBox } from '../components.js'
import { inProgress, upNextCandidates, upNext } from '../watching.js'

// Home. Continue watching, whatever is downloading right now, then the first
// page of every catalogue the installed add-ons expose.
export default async function board ({ container }) {
  container.innerHTML = '<div class="pad" id="board"></div>'
  const root = container.querySelector('#board')

  root.append(h('<h1>Home</h1>'))
  root.append(h('<p class="muted" style="margin-top:0">Everything your add-ons are offering right now.</p>'))

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
    return
  }

  // Only fetch the catalogues that do not require a search term, and cap the
  // number of parallel requests so a slow add-on cannot stall the page.
  const usable = catalogs.filter(catalog => !catalog.requiresSearch).slice(0, 12)
  for (const catalog of usable) {
    const node = shelf({
      title: catalog.name,
      source: catalog.addonName,
      moreHref: `#/discover?addon=${encodeURIComponent(catalog.addonId)}&type=${encodeURIComponent(catalog.type)}&id=${encodeURIComponent(catalog.id)}`
    })
    const placeholderStrip = skeletonStrip(6)
    node.strip.replaceWith(placeholderStrip)
    root.append(node)

    api.catalog({ addon: catalog.addonId, type: catalog.type, id: catalog.id })
      .then(metas => {
        if (!metas.length) return node.remove()
        const strip = h('<div class="strip"></div>')
        metas.slice(0, 24).forEach(meta => strip.append(metaCard(meta)))
        placeholderStrip.replaceWith(strip)
      })
      .catch(() => node.remove())
  }
}

// Part-way through, one tile per show; then, as Netflix and Stremio do, the
// episode after one just finished. Finding that needs the show's episode list,
// so those tiles arrive a moment later and slot in by when they were watched.
async function renderContinueWatching (root) {
  let all = {}
  try {
    all = await api.progress()
  } catch { return }
  const entries = inProgress(all).slice(0, 20)
  const candidates = upNextCandidates(all).slice(0, 8)
  if (!entries.length && !candidates.length) return

  const node = shelf({ title: 'Continue watching', moreHref: '#/library' })
  const place = (card, updatedAt) => {
    card.dataset.at = String(updatedAt || 0)
    const later = [...node.strip.children].find(other => Number(other.dataset.at) < (updatedAt || 0))
    node.strip.insertBefore(card, later || null)
    node.hidden = false
  }
  entries.forEach(entry => place(continueCard(entry, { onRemove: () => api.hideProgress(entry.id) }), entry.updatedAt))
  node.hidden = !entries.length
  root.append(node)

  // Not awaited: the catalogues below must not wait on these.
  candidates.forEach(async entry => {
    const { type, imdbId } = entry.meta
    let series
    try {
      series = await api.meta(type, imdbId)
    } catch { return }
    const next = upNext(series?.videos || [], all)
    if (next?.action !== 'next') return
    place(upNextCard({ ...series, type, id: imdbId }, next.video, { onRemove: () => api.hideProgress(entry.id) }), entry.updatedAt)
  })
}

async function renderActiveDownloads (root) {
  let data
  try {
    data = await api.torrents()
  } catch { return }
  const active = data.torrents.filter(torrent => torrent.status !== 'done')
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
  root.append(node)
}
