import { api } from '../api.js'
import { h, esc, confirmDialog, toast } from '../util.js'
import { metaCard, emptyState } from '../components.js'

// Saved titles plus anything with a saved playback position.
export default async function library ({ container }) {
  container.innerHTML = '<div class="pad" id="library"></div>'
  const root = container.querySelector('#library')
  root.append(h('<h1>Library</h1>'))

  const [items, progress, grabbed] = await Promise.all([
    api.library(),
    api.progress(),
    api.grabs().catch(() => [])
  ])
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

  /* -------------------------------------------------------------- followed */

  const followed = items.filter(item => item.monitored)
  if (followed.length || grabbed.length) {
    const head = h(`<div class="section-title"><h2>Following</h2><span class="count">${followed.length} show${followed.length === 1 ? '' : 's'} · new episodes download on their own</span></div>`)
    const check = h('<button class="btn small ghost" style="margin-left:auto">Check now</button>')
    check.addEventListener('click', async () => {
      check.disabled = true
      check.textContent = 'Checking…'
      try {
        const { grabbed: found } = await api.runMonitor()
        toast(found?.length ? `Grabbed ${found.length} episode${found.length === 1 ? '' : 's'}` : 'Nothing new right now', 'ok')
        if (found?.length) location.reload()
      } catch (err) {
        toast(err.message, 'err')
      } finally {
        check.disabled = false
        check.textContent = 'Check now'
      }
    })
    head.append(check)
    root.append(head)

    if (followed.length) {
      const grid = h('<div class="grid"></div>')
      followed.forEach(item => {
        const card = metaCard(item, { sub: 'following' })
        card.addEventListener('contextmenu', async event => {
          event.preventDefault()
          if (await confirmDialog({
            title: 'Stop following?',
            body: `<p class="muted">New episodes of “${esc(item.name)}” will stop downloading on their own. It stays in your library.</p>`,
            confirmLabel: 'Stop following'
          })) {
            await api.setMonitored(item.id, false)
            toast(`No longer following ${item.name}`, 'ok')
            card.remove()
          }
        })
        grid.append(card)
      })
      root.append(grid)
    }

    if (grabbed.length) {
      const recent = grabbed.slice(0, 6)
        .map(entry => `<div>${esc(entry.title)}${entry.quality ? ` <span class="muted">· ${esc(entry.quality)}</span>` : ''}</div>`)
        .join('')
      root.append(h(`<div class="tiny muted" style="margin:10px 0 4px"><b>Grabbed for you</b>${recent}</div>`))
    }
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
