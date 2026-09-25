import { api } from '../api.js'
import { h, esc, confirmDialog, toast } from '../util.js'
import { metaCard, continueCard, emptyState } from '../components.js'
import { inProgress } from '../watching.js'

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

  const grid = h('<div class="grid"></div>')
  items.forEach(item => {
    grid.append(metaCard(item, {
      removeLabel: 'Remove from library',
      onRemove: async () => {
        if (!await confirmDialog({ title: 'Remove from library?', body: `<p class="muted">“${esc(item.name || item.id)}” will be removed.</p>`, confirmLabel: 'Remove', danger: true })) return false
        await api.removeFromLibrary(item.id)
        toast('Removed from library', 'ok')
      }
    }))
  })
  root.append(grid)
}
