import { api } from '../api.js'
import { h, esc, confirmDialog, toast } from '../util.js'
import { metaCard, continueCard, emptyState, detailHref } from '../components.js'
import { inProgress, sortLibrary, LIBRARY_SORTS, followedShows, episodeCalendar, episodeLabel } from '../watching.js'

// Saved titles plus anything with a saved playback position.
export default async function library ({ container }) {
  container.innerHTML = '<div class="pad" id="library"></div>'
  const root = container.querySelector('#library')
  root.append(h('<h1>Library</h1>'))

  // Neither half should be able to hide the other if its request fails.
  const [items, progress] = await Promise.all([
    api.library().catch(() => []),
    api.progress().catch(() => ({}))
  ])
  const watching = inProgress(progress)

  if (watching.length) {
    root.append(h('<div class="section-title"><h2>Continue watching</h2></div>'))
    const grid = h('<div class="grid"></div>')
    watching.forEach(entry => {
      // Same tile as the home shelf: clicking it picks the file back up where
      // it stopped instead of opening the title page again.
      grid.append(continueCard(entry, {
        onRemove: async () => {
          await api.hideProgress(entry.id)
          toast('Removed from continue watching', 'ok')
        }
      }))
    })
    root.append(grid)
  }

  // Fills in once the shows' episode lists are in; never holds up the rest.
  const calendar = h('<div></div>')
  root.append(calendar)
  renderCalendar(calendar, items, progress)

  root.append(h('<div class="section-title"><h2>Saved</h2></div>'))
  if (!items.length) {
    root.append(emptyState({
      title: 'Your library is empty',
      message: 'Open any title and press <b>Add to library</b> to keep it here.',
      action: 'Browse',
      href: '#/discover'
    }))
    return
  }

  // Stremio's library controls: which kind, and in what order. Remembered.
  const saved = { sort: 'added', type: '' }
  try { Object.assign(saved, JSON.parse(localStorage.getItem('sh-library-view') || '{}')) } catch { /* defaults */ }
  const types = [...new Set(items.map(item => item.type))]
  if (!types.includes(saved.type)) saved.type = ''
  const labels = { movie: 'Films', series: 'Series', channel: 'Channels', tv: 'TV' }
  const controls = h('<div class="row wrap library-controls"></div>')
  const grid = h('<div class="grid"></div>')
  root.append(controls, grid)

  function draw () {
    try { localStorage.setItem('sh-library-view', JSON.stringify(saved)) } catch { /* not remembered */ }
    controls.innerHTML = ''
    if (types.length > 1) {
      for (const type of ['', ...types]) {
        const chip = h(`<button class="chip ${saved.type === type ? 'active' : ''}">${esc(type ? labels[type] || type : 'All')}</button>`)
        chip.addEventListener('click', () => { saved.type = type; draw() })
        controls.append(chip)
      }
    }
    const sort = h(`<select class="field library-sort" aria-label="Sort">${Object.entries(LIBRARY_SORTS).map(([key, label]) => `<option value="${key}" ${key === saved.sort ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>`)
    sort.addEventListener('change', () => { saved.sort = sort.value; draw() })
    controls.append(sort)

    grid.innerHTML = ''
    sortLibrary(items, progress, saved).forEach(item => {
      grid.append(metaCard(item, {
        removeLabel: 'Remove from library',
        onRemove: async () => {
          if (!await confirmDialog({ title: 'Remove from library?', body: `<p class="muted">“${esc(item.name || item.id)}” will be removed.</p>`, confirmLabel: 'Remove', danger: true })) return false
          await api.removeFromLibrary(item.id)
          items.splice(items.indexOf(item), 1)
          toast('Removed from library', 'ok')
        }
      }))
    })
  }
  draw()
}

// Stremio's calendar: what came out lately for the shows you follow, and what
// is about to. Only a handful of shows are asked, newest activity first.
async function renderCalendar (node, items, progress) {
  const shows = followedShows(items, progress).slice(0, 16)
  if (!shows.length) return
  const metas = await Promise.all(shows.map(show => api.meta(show.type, show.id).catch(() => null)))
  const { fresh, upcoming } = episodeCalendar(
    metas.filter(meta => meta?.videos?.length).map(meta => ({ meta, videos: meta.videos })),
    progress
  )
  const when = at => {
    const days = Math.round((new Date(at).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 864e5)
    if (days === 0) return 'Today'
    if (days === -1) return 'Yesterday'
    if (days === 1) return 'Tomorrow'
    return new Date(at).toLocaleDateString(undefined, { weekday: days > 0 && days < 7 ? 'short' : undefined, day: 'numeric', month: 'short' })
  }
  const list = (title, entries) => {
    if (!entries.length) return
    node.append(h(`<div class="section-title"><h2>${esc(title)}</h2></div>`))
    const rows = h('<div class="calendar"></div>')
    entries.slice(0, 12).forEach(({ meta, video, at }) => {
      const row = h(`
        <a class="calendar-row" href="${esc(detailHref({ type: 'series', id: meta.id }))}">
          <span class="when">${esc(when(at))}</span>
          <span class="show">${esc(meta.name)}</span>
          <span class="ep">${esc(episodeLabel(video))}${video.name || video.title ? ` · ${esc(video.name || video.title)}` : ''}</span>
        </a>`)
      rows.append(row)
    })
    node.append(rows)
  }
  list('New episodes', fresh)
  list('Coming up', upcoming)
}
