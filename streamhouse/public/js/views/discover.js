import { api } from '../api.js'
import { h, esc, toast, wellRated, browsable, MIN_RATING, RATED_TYPES } from '../util.js'
import { metaCard, pickCard, ratedSub, emptyState, errorBox, skeletonStrip } from '../components.js'
import { ERAS, PICK_SORTS, inEra, ratingOf, genresOf, sortPicks, tasteTypes } from '../taste.js'
import { FOR_YOU, isForYou, loadTaste, forYou } from '../foryou.js'

const TYPE_LABELS = { movie: 'Films', series: 'Series', channel: 'Channels', tv: 'TV' }

// The app never suggests anything at or below MIN_RATING; these raise the bar.
const RATING_FLOORS = [[MIN_RATING, `IMDb above ${MIN_RATING}`], [7, 'IMDb 7+'], [7.5, 'IMDb 7.5+'], [8, 'IMDb 8+']]

// Past this many, a catalogue's genres are a menu rather than a wall of chips:
// Cinemeta's "New" lists every year back to 1900.
const MAX_GENRE_CHIPS = 24

// A filtered page can come back nearly empty, so keep fetching until this
// many tiles were added, or the catalogue runs out...
const MIN_BATCH = 24
const MAX_FETCHES = 6
// ...but filters that match almost nothing would page through all of it.
const MAX_DRY_BATCHES = 3

// For you is ranked in one go, then shown this many at a time.
const PICKS_PAGE = 48

// Remembered between visits: how strict, and whether to hide what you have seen.
const PREFS_KEY = 'sh-discover'

// Browse one catalogue at a time — or For you, what is like the titles you
// watch — with genre, rating and year filters and infinite scroll.
export default async function discover ({ query, container }) {
  container.innerHTML = '<div class="pad" id="discover"></div>'
  const root = container.querySelector('#discover')
  root.append(h('<h1>Discover</h1>'))

  let catalogs = []
  let taste = null
  try {
    [catalogs, taste] = await Promise.all([api.catalogs(), loadTaste()])
  } catch (err) {
    return root.append(errorBox(err.message))
  }
  const real = catalogs.filter(browsable)
  if (!real.length) {
    return root.append(emptyState({
      title: 'Nothing to browse yet',
      message: 'Add-ons provide the catalogues. Install one to fill this page.',
      action: 'Open add-ons',
      href: '#/addons'
    }))
  }
  catalogs = [...forYouCatalogs(real), ...real]

  const prefs = { min: MIN_RATING, hideSeen: true }
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')) } catch { /* defaults */ }

  // With anything watched, Discover opens on For you, of the kind you watch most.
  const liked = taste.seeds.length ? tasteTypes(taste.seeds).find(type => catalogs.some(catalog => isForYou(catalog) && catalog.type === type)) : null
  const start = liked ? catalogs.find(catalog => isForYou(catalog) && catalog.type === liked) : real[0]
  const state = {
    type: query.type || start.type,
    addonId: query.addon || start.addonId,
    id: query.id || start.id,
    genre: query.genre || '',
    era: ERAS.some(([key]) => key === query.era) ? query.era : '',
    sort: PICK_SORTS.some(([key]) => key === query.sort) ? query.sort : 'match',
    min: RATING_FLOORS.some(([floor]) => floor === prefs.min) ? prefs.min : MIN_RATING,
    hideSeen: prefs.hideSeen !== false,
    picks: null,
    // Pages of a catalogue can overlap as its order shifts: each title once.
    shown: new Set(),
    skip: 0,
    dry: 0,
    done: false,
    loading: false,
    generation: 0
  }

  // A link naming a list that is not there lands on the first of its kind.
  const settled = catalogs.find(catalog => catalog.addonId === state.addonId && catalog.id === state.id && catalog.type === state.type)
    || catalogs.find(catalog => catalog.type === state.type) || start
  Object.assign(state, { type: settled.type, addonId: settled.addonId, id: settled.id })

  const filters = h('<div class="discover-filters"></div>')
  const typeRow = h('<div class="row wrap"></div>')
  const catalogRow = h('<div class="row wrap"></div>')
  const genreRow = h('<div class="row wrap"></div>')
  const refineRow = h('<div class="row wrap discover-refine"></div>')
  filters.append(typeRow, catalogRow, genreRow, refineRow)
  // For you says what it went on; either kind of list says when nothing matches.
  const note = h('<p class="muted taste-note" hidden></p>')
  const message = h('<div class="discover-message"></div>')
  const grid = h('<div class="grid"></div>')
  const sentinel = h('<div style="height:60px"></div>')
  root.append(filters, note, message, grid, sentinel)

  function currentCatalog () {
    return catalogs.find(catalog => catalog.addonId === state.addonId && catalog.id === state.id && catalog.type === state.type)
      || catalogs.find(catalog => catalog.type === state.type)
  }

  const forYouNow = () => isForYou(currentCatalog())
  // Cinemeta's "New" is split by year already; a decade menu beside it would
  // only say the same thing twice.
  const byYear = () => (currentCatalog()?.genres || []).some(genre => /^\d{4}$/.test(genre))
  const era = () => byYear() ? '' : state.era

  function remember () {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ min: state.min, hideSeen: state.hideSeen })) } catch { /* not remembered */ }
  }

  function menu (label, options, value, onChange) {
    const select = h(`<select class="field" aria-label="${esc(label)}">${options.map(([key, text]) =>
      `<option value="${esc(key)}" ${String(key) === String(value) ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select>`)
    select.addEventListener('change', () => onChange(select.value))
    return select
  }

  function drawFilters () {
    const types = [...new Set(catalogs.map(catalog => catalog.type))]
    typeRow.innerHTML = ''
    types.forEach(type => {
      const chip = h(`<button class="chip ${type === state.type ? 'active' : ''}">${esc(TYPE_LABELS[type] || type)}</button>`)
      chip.addEventListener('click', () => {
        // The same list for the other kind where there is one: For you stays For you.
        const next = catalogs.find(catalog => catalog.type === type && catalog.addonId === state.addonId && catalog.id === state.id)
          || catalogs.find(catalog => catalog.type === type && !isForYou(catalog))
          || catalogs.find(catalog => catalog.type === type)
        Object.assign(state, { type, addonId: next.addonId, id: next.id, genre: '' })
        reload()
      })
      typeRow.append(chip)
    })

    catalogRow.innerHTML = ''
    catalogs.filter(catalog => catalog.type === state.type).forEach(catalog => {
      const active = catalog.addonId === state.addonId && catalog.id === state.id
      const chip = isForYou(catalog)
        ? h(`<button class="chip for-you ${active ? 'active' : ''}">${esc(catalog.name)}</button>`)
        : h(`<button class="chip ${active ? 'active' : ''}">${esc(catalog.name)} <span class="muted tiny">${esc(catalog.addonName)}</span></button>`)
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
    if (genres.length > MAX_GENRE_CHIPS) {
      const years = byYear()
      genreRow.append(menu(years ? 'Year' : 'Genre', [['', years ? 'All years' : 'All genres'], ...genres.map(genre => [genre, genre])], state.genre, value => {
        state.genre = value
        reload()
      }))
    } else if (genres.length) {
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
    genreRow.hidden = !genres.length

    refineRow.innerHTML = ''
    if (RATED_TYPES.includes(state.type)) {
      refineRow.append(menu('Rating', RATING_FLOORS, state.min, value => {
        state.min = Number(value)
        remember()
        reload()
      }))
      if (!byYear()) {
        refineRow.append(menu('Released', ERAS, state.era, value => {
          state.era = value
          reload()
        }))
      }
    }
    if (forYouNow()) {
      refineRow.append(menu('Order', PICK_SORTS, state.sort, value => {
        state.sort = value
        reload()
      }))
    } else if (taste.watched.size) {
      const toggle = h(`<button class="chip ${state.hideSeen ? 'active' : ''}" aria-pressed="${state.hideSeen}">Hide watched</button>`)
      toggle.addEventListener('click', () => {
        state.hideSeen = !state.hideSeen
        remember()
        reload()
      })
      refineRow.append(toggle)
    }
    refineRow.hidden = !refineRow.childElementCount
    // For you with nothing to go on has nothing to narrow.
    if (forYouNow() && !taste.seeds.length) genreRow.hidden = refineRow.hidden = true
  }

  // What every list is narrowed by. For you never has anything watched or
  // saved in it to begin with.
  function passes (meta) {
    if (!wellRated(meta)) return false
    if (RATED_TYPES.includes(meta.type) && ratingOf(meta) < state.min) return false
    if (!inEra(meta, era())) return false
    return !(state.hideSeen && taste.watched.has(meta.id))
  }

  const narrowed = () => state.min !== MIN_RATING || era() || (state.hideSeen && taste.watched.size)

  async function loadCatalogue (generation) {
    let added = 0
    for (let fetches = 0; fetches < MAX_FETCHES && added < MIN_BATCH; fetches += 1) {
      const metas = await api.catalog({
        addon: state.addonId,
        type: state.type,
        id: state.id,
        genre: state.genre,
        skip: state.skip
      })
      if (generation !== state.generation) return
      // Page sizes vary between add-ons, so only an empty page means the end.
      if (!metas.length) {
        state.done = true
        break
      }
      state.skip += metas.length
      const kept = metas.filter(meta => !state.shown.has(meta.id) && passes(meta))
      kept.forEach(meta => {
        state.shown.add(meta.id)
        grid.append(metaCard(meta, { sub: ratedSub(meta) }))
      })
      added += kept.length
    }
    state.dry = added ? 0 : state.dry + 1
    if (state.dry >= MAX_DRY_BATCHES) state.done = true
    if (state.done && !grid.children.length) {
      message.append(h(`<p class="muted">${!RATED_TYPES.includes(state.type)
        ? 'This catalogue returned nothing.'
        : narrowed() ? 'Nothing here matches these filters.' : `Nothing here rated above ${MIN_RATING} on IMDb.`}</p>`))
    }
  }

  async function loadForYou (generation) {
    if (!state.picks) {
      if (!taste.seeds.length) {
        state.done = true
        const browse = real.find(catalog => catalog.type === state.type) || real[0]
        message.append(emptyState({
          title: 'Nothing to go on yet',
          message: 'Watch or save a few titles, and this fills with more like them.',
          action: 'Browse instead',
          href: `#/discover?addon=${encodeURIComponent(browse.addonId)}&type=${encodeURIComponent(browse.type)}&id=${encodeURIComponent(browse.id)}`
        }))
        return
      }
      grid.append(...skeletonStrip(12).children)
      const { picks, seeds } = await forYou(state.type, { genre: state.genre, taste, catalogs: real })
      if (generation !== state.generation) return
      grid.innerHTML = ''
      state.picks = sortPicks(picks.filter(pick => passes(pick.meta) && (!state.genre || genresOf(pick.meta).includes(state.genre))), state.sort)
      note.textContent = basedOn(seeds)
      note.hidden = !note.textContent
    }
    const page = state.picks.slice(state.skip, state.skip + PICKS_PAGE)
    page.forEach(pick => grid.append(pickCard(pick)))
    state.skip += page.length
    if (state.skip >= state.picks.length) state.done = true
    if (state.done && !grid.children.length) {
      message.append(h('<p class="muted">Nothing like what you watch matches these filters.</p>'))
    }
  }

  async function loadPage () {
    if (state.loading || state.done) return
    state.loading = true
    const generation = state.generation
    try {
      await (forYouNow() ? loadForYou(generation) : loadCatalogue(generation))
    } catch (err) {
      if (generation !== state.generation) return
      state.done = true
      grid.querySelectorAll('.skeleton').forEach(tile => tile.closest('.card').remove())
      toast(err.message, 'err')
    } finally {
      if (generation === state.generation) {
        state.loading = false
        // Re-arm the observer: if the sentinel is still on screen it fires again.
        if (!state.done) {
          observer.unobserve(sentinel)
          observer.observe(sentinel)
        }
      }
    }
  }

  function href () {
    const params = new URLSearchParams({ addon: state.addonId, type: state.type, id: state.id })
    if (state.genre) params.set('genre', state.genre)
    if (state.era) params.set('era', state.era)
    if (forYouNow() && state.sort !== 'match') params.set('sort', state.sort)
    return `#/discover?${params}`
  }

  function reload () {
    state.generation++
    Object.assign(state, { loading: false, picks: null, shown: new Set(), skip: 0, dry: 0, done: false })
    grid.innerHTML = ''
    message.innerHTML = ''
    note.hidden = true
    history.replaceState(null, '', href())
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

// For you, as a catalogue of each kind it can suggest. Its genres are the ones
// that kind's catalogues offer, years left out.
function forYouCatalogs (catalogs) {
  return RATED_TYPES.filter(type => catalogs.some(catalog => catalog.type === type)).map(type => {
    const genres = []
    for (const catalog of catalogs) {
      if (catalog.type !== type || (catalog.requires || []).includes('genre')) continue
      for (const genre of catalog.genres || []) if (!/^\d{4}$/.test(genre) && !genres.includes(genre)) genres.push(genre)
    }
    return { ...FOR_YOU, addonName: '', type, genres }
  })
}

// "Picked for what you watched and saved: The Mighty Nein, Lanterns and 3 more."
function basedOn (seeds) {
  const names = seeds.map(seed => seed.meta?.name || seed.name).filter(Boolean)
  if (!names.length) return ''
  const shown = names.slice(0, 3)
  const more = names.length - shown.length
  const joined = more
    ? `${shown.join(', ')} and ${more} more`
    : shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}` : shown[0]
  return `Picked for what you watched and saved: ${joined}.`
}
