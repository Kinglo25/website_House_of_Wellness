import { api } from '../api.js'
import { h, esc, confirmDialog, toast } from '../util.js'
import { metaCard, emptyState } from '../components.js'

// Saved titles plus anything with a saved playback position.
export default async function library ({ container }) {
  container.innerHTML = '<div class="pad" id="library"></div>'
  const root = container.querySelector('#library')
  root.append(h('<h1>Library</h1>'))

  const [items, progress] = await Promise.all([api.library(), api.progress()])
  const watching = Object.values(progress).sort((a, b) => b.updatedAt - a.updatedAt)

  if (watching.length) {
    root.append(h('<div class="section-title"><h2>Continue watching</h2></div>'))
    const grid = h('<div class="grid"></div>')
    watching.forEach(entry => {
      const meta = entry.meta || { name: entry.id, id: entry.id, type: 'movie' }
      const card = metaCard(meta, {
        progress: entry.duration ? entry.time / entry.duration : 0,
        sub: entry.duration ? `${Math.round((entry.duration - entry.time) / 60)} min left` : ''
      })
      card.addEventListener('contextmenu', async event => {
        event.preventDefault()
        if (await confirmDialog({ title: 'Forget progress?', body: `<p class="muted">Remove “${esc(meta.name || entry.id)}” from continue watching.</p>`, confirmLabel: 'Forget', danger: true })) {
          await api.clearProgress(entry.id)
          toast('Removed from continue watching', 'ok')
          card.remove()
        }
      })
      grid.append(card)
    })
    root.append(grid)
  }

  root.append(h('<div class="section-title"><h2>Saved</h2><span class="count">right-click a tile to remove it</span></div>'))
  if (!items.length) {
    root.append(emptyState({
      title: 'Your library is empty',
      message: 'Open any title and press <b>Add to library</b> to keep it here.',
      action: 'Browse',
      href: '#/discover'
    }))
    return
  }

  const grid = h('<div class="grid"></div>')
  items.forEach(item => {
    const card = metaCard(item)
    card.addEventListener('contextmenu', async event => {
      event.preventDefault()
      if (await confirmDialog({ title: 'Remove from library?', body: `<p class="muted">“${esc(item.name || item.id)}” will be removed.</p>`, confirmLabel: 'Remove', danger: true })) {
        await api.removeFromLibrary(item.id)
        toast('Removed from library', 'ok')
        card.remove()
      }
    })
    grid.append(card)
  })
  root.append(grid)
}
