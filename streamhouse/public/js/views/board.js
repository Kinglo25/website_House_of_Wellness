import { api } from '../api.js'
import { h, bytes, esc } from '../util.js'
import { metaCard, continueCard, upNextCard, shelf, skeletonStrip, emptyState, errorBox, detailHref, seeAllCard } from '../components.js'
import { inProgress, upNextCandidates, upNext } from '../watching.js'

// Home. Continue watching, whatever is downloading right now, then the first
// page of every catalogue the installed add-ons expose.
export default async function board ({ container }) {
  container.innerHTML = '<div class="pad" id="board"></div>'
  const root = container.querySelector('#board')

  // Netflix's billboard: one title from the first catalogue, a different one
  // each day, filled in once that catalogue answers. Until then — or if it
  // never does — the page keeps its plain heading.
  const billboardSlot = h('<div class="billboard-slot"></div>')
  const heading = h('<div><h1>Home</h1><p class="muted" style="margin-top:0">Everything your add-ons are offering right now.</p></div>')
  root.append(billboardSlot, heading)

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
        if (!billboardSlot.childElementCount) fillBillboard(billboardSlot, heading, metas, catalog)
        const strip = h('<div class="strip"></div>')
        metas.slice(0, 24).forEach(meta => strip.append(metaCard(meta)))
        strip.append(seeAllCard(node.moreHref))
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
  // Oldest of all, so every tile placed by time lands before it.
  place(seeAllCard(node.moreHref), -1)
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

async function fillBillboard (slot, heading, metas, catalog) {
  const candidates = metas.filter(meta => meta.poster || meta.background).slice(0, 10)
  if (!candidates.length) return
  const day = Math.floor(Date.now() / 864e5)
  let meta = { type: catalog.type, ...candidates[day % candidates.length] }
  // Catalogue entries are often brief; the title's own record has the rest.
  if (!meta.description || !meta.background) {
    try { meta = { ...meta, ...(await api.meta(meta.type, meta.id)) } } catch { /* the brief one will do */ }
  }
  if (slot.childElementCount) return
  const href = detailHref(meta)
  const art = meta.background || meta.poster
  const node = h(`
    <section class="billboard" style="background-image:url('${esc(art)}')">
      <div class="info">
        <span class="eyebrow">${esc(catalog.name)}</span>
        <h1>${esc(meta.name)}</h1>
        <div class="facts">${[meta.imdbRating ? `<span class="rating">★ ${esc(meta.imdbRating)}</span>` : '', ...[meta.releaseInfo || meta.year, meta.runtime, meta.genres?.slice(0, 3).join(', ')].filter(Boolean).map(fact => `<span>${esc(fact)}</span>`)].filter(Boolean).join('<span>·</span>')}</div>
        ${meta.description ? `<p class="desc">${esc(meta.description)}</p>` : ''}
        <div class="cta">
          <a class="btn primary" href="${esc(href)}?play=1">▶ Play</a>
          <a class="btn" href="${esc(href)}">ⓘ More info</a>
        </div>
      </div>
    </section>`)
  slot.append(node)
  heading.hidden = true
}
