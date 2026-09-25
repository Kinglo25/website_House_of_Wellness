import { api } from '../api.js'
import { h, esc, toast } from '../util.js'
import { metaCard, emptyState, errorBox } from '../components.js'

const TYPE_LABELS = { movie: 'Films', series: 'Series', channel: 'Channels', tv: 'TV' }

const PAGE_SIZE = 100

// Browse one catalogue at a time with genre filtering and infinite scroll.
export default async function discover ({ query, container }) {
  container.innerHTML = '<div class="pad" id="discover"></div>'
  const root = container.querySelector('#discover')
  root.append(h('<h1>Discover</h1>'))

  let catalogs = []
  try {
    catalogs = (await api.catalogs()).filter(catalog => !catalog.requiresSearch)
  } catch (err) {
    return root.append(errorBox(err.message))
  }
  if (!catalogs.length) {
    return root.append(emptyState({
      title: 'Nothing to browse yet',
      message: 'Add-ons provide the catalogues. Install one to fill this page.',
      action: 'Open add-ons',
      href: '#/addons'
    }))
  }

  const state = {
    type: query.type || catalogs[0].type,
    addonId: query.addon || catalogs[0].addonId,
    id: query.id || catalogs[0].id,
    genre: query.genre || '',
    skip: 0,
    done: false,
    loading: false
  }

  const filters = h('<div style="display:flex;flex-direction:column;gap:12px;margin:18px 0 22px"></div>')
  const typeRow = h('<div class="row wrap"></div>')
  const catalogRow = h('<div class="row wrap"></div>')
  const genreRow = h('<div class="row wrap"></div>')
  filters.append(typeRow, catalogRow, genreRow)
  root.append(filters)

  const grid = h('<div class="grid"></div>')
  root.append(grid)
  const sentinel = h('<div style="height:60px"></div>')
  root.append(sentinel)

  function currentCatalog () {
    return catalogs.find(catalog => catalog.addonId === state.addonId && catalog.id === state.id && catalog.type === state.type)
      || catalogs.find(catalog => catalog.type === state.type)
  }

  function drawFilters () {
    const types = [...new Set(catalogs.map(catalog => catalog.type))]
    typeRow.innerHTML = ''
    types.forEach(type => {
      const chip = h(`<button class="chip ${type === state.type ? 'active' : ''}">${esc(TYPE_LABELS[type] || type)}</button>`)
      chip.addEventListener('click', () => {
        state.type = type
        const first = catalogs.find(catalog => catalog.type === type)
        state.addonId = first.addonId
        state.id = first.id
        state.genre = ''
        reload()
      })
      typeRow.append(chip)
    })

    catalogRow.innerHTML = ''
    catalogs.filter(catalog => catalog.type === state.type).forEach(catalog => {
      const active = catalog.addonId === state.addonId && catalog.id === state.id
      const chip = h(`<button class="chip ${active ? 'active' : ''}">${esc(catalog.name)} <span class="muted tiny">${esc(catalog.addonName)}</span></button>`)
      chip.addEventListener('click', () => {
        state.addonId = catalog.addonId
        state.id = catalog.id
        state.genre = ''
        reload()
      })
      catalogRow.append(chip)
    })

    genreRow.innerHTML = ''
    const genres = currentCatalog()?.genres || []
    if (genres.length) {
      const all = h(`<button class="chip ${state.genre ? '' : 'active'}">All genres</button>`)
      all.addEventListener('click', () => {
        state.genre = ''
        reload()
      })
      genreRow.append(all)
      genres.forEach(genre => {
        const chip = h(`<button class="chip ${state.genre === genre ? 'active' : ''}">${esc(genre)}</button>`)
        chip.addEventListener('click', () => {
          state.genre = genre
          reload()
        })
        genreRow.append(chip)
      })
    }
  }

  async function loadPage () {
    if (state.loading || state.done) return
    state.loading = true
    try {
      const metas = await api.catalog({
        addon: state.addonId,
        type: state.type,
        id: state.id,
        genre: state.genre,
        skip: state.skip
      })
      if (!metas.length) {
        state.done = true
        if (!grid.children.length) {
          grid.append(h('<p class="muted">This catalogue returned nothing.</p>'))
        }
        return
      }
      metas.forEach(meta => grid.append(metaCard(meta)))
      state.skip += metas.length
      if (metas.length < PAGE_SIZE) state.done = true
    } catch (err) {
      state.done = true
      toast(err.message, 'err')
    } finally {
      state.loading = false
    }
  }

  function reload () {
    state.skip = 0
    state.done = false
    grid.innerHTML = ''
    history.replaceState(null, '', `#/discover?addon=${encodeURIComponent(state.addonId)}&type=${encodeURIComponent(state.type)}&id=${encodeURIComponent(state.id)}${state.genre ? `&genre=${encodeURIComponent(state.genre)}` : ''}`)
    drawFilters()
    loadPage()
  }

  const observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) loadPage()
  }, { root: container, rootMargin: '400px' })
  observer.observe(sentinel)

  drawFilters()
  await loadPage()

  return { destroy: () => observer.disconnect() }
}
