import { api } from '../api.js'
import { h, bytes, esc } from '../util.js'
import { metaCard, shelf, skeletonStrip, emptyState, errorBox } from '../components.js'

// Home. Continue watching, whatever is downloading right now, then the first
// page of every catalogue the installed add-ons expose.
export default async function board ({ container }) {
  container.innerHTML = '<div class="pad" id="board"></div>'
  const root = container.querySelector('#board')

  root.append(h('<h1>Home</h1>'))
  root.append(h('<p class="muted" style="margin-top:0">Everything your add-ons are offering right now.</p>'))

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

  await renderContinueWatching(root)
  await renderActiveDownloads(root)

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

async function renderContinueWatching (root) {
  let entries = []
  try {
    entries = Object.values(await api.progress())
  } catch { return }
  if (!entries.length) return

  entries.sort((a, b) => b.updatedAt - a.updatedAt)
  const node = shelf({ title: 'Continue watching' })
  entries.slice(0, 20).forEach(entry => {
    const meta = entry.meta || { name: entry.id, type: 'movie', id: entry.id }
    const card = metaCard(meta, {
      progress: entry.duration ? entry.time / entry.duration : 0,
      sub: `${Math.round((entry.duration - entry.time) / 60)} min left`
    })
    if (entry.meta?.playback) {
      card.addEventListener('click', event => {
        event.stopPropagation()
        location.hash = `#/player/${entry.meta.playback.infoHash}/${entry.meta.playback.fileIdx}?t=${Math.floor(entry.time)}&title=${encodeURIComponent(meta.name || '')}&meta=${encodeURIComponent(entry.id)}`
      }, true)
    }
    node.strip.append(card)
  })
  root.append(node)
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
    const card = metaCard(
      { name: torrent.name, id: torrent.id, type: torrent.meta?.type || 'movie', poster: torrent.meta?.poster },
      { progress: torrent.progress, ribbon: `${Math.round(torrent.progress * 100)}%`, sub: `${bytes(torrent.downloadSpeed, true)} · ${esc(torrent.status)}` }
    )
    card.addEventListener('click', event => {
      event.stopPropagation()
      location.hash = '#/downloads'
    }, true)
    node.strip.append(card)
  })
  root.append(node)
}
