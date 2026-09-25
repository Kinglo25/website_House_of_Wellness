import { api } from '../api.js'
import { h, esc } from '../util.js'
import { metaCard, emptyState, errorBox, skeletonStrip } from '../components.js'

// Fans a query out across every searchable catalogue of every add-on.
export default async function search ({ query, container }) {
  const term = query.q || ''
  container.innerHTML = '<div class="pad" id="search"></div>'
  const root = container.querySelector('#search')
  root.append(h(`<h1>Search</h1><p class="muted" style="margin-top:0">Results for “${esc(term)}”</p>`))

  if (!term.trim()) {
    return root.append(emptyState({ title: 'Type something', message: 'Use the box at the top to search every installed add-on at once.' }))
  }

  const loading = skeletonStrip(8)
  root.append(loading)

  try {
    const metas = await api.search(term)
    loading.remove()
    if (!metas.length) {
      return root.append(emptyState({
        title: 'No results',
        message: 'None of your add-ons know that title. Installing more catalogue add-ons widens the search.',
        action: 'Open add-ons',
        href: '#/addons'
      }))
    }
    root.append(h(`<p class="muted tiny">${metas.length} result${metas.length === 1 ? '' : 's'}</p>`))
    // One section per kind, films first, as Stremio lays its results out —
    // "Dune" the film and "Dune" the series should not be told apart by a subtitle.
    const LABELS = { movie: 'Films', series: 'Series', channel: 'Channels', tv: 'TV channels' }
    const kinds = [...new Set(metas.map(meta => meta.type || 'other'))]
      .sort((a, b) => (Object.keys(LABELS).indexOf(a) + 1 || 99) - (Object.keys(LABELS).indexOf(b) + 1 || 99))
    for (const kind of kinds) {
      const group = metas.filter(meta => (meta.type || 'other') === kind)
      if (kinds.length > 1) root.append(h(`<div class="section-title"><h2>${esc(LABELS[kind] || kind)}</h2><span class="count">${group.length}</span></div>`))
      const grid = h('<div class="grid"></div>')
      group.forEach(meta => grid.append(metaCard(meta, { sub: [meta.releaseInfo || meta.year, meta.addonName].filter(Boolean).join(' · ') })))
      root.append(grid)
    }
  } catch (err) {
    loading.remove()
    root.append(errorBox(err.message))
  }
}
