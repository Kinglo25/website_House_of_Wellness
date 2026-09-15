import { api } from '../api.js'
import { h, esc, bytes, duration, percent, toast, confirmDialog } from '../util.js'
import { emptyState } from '../components.js'
import { castButton } from '../cast.js'

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'downloading', label: 'Downloading' },
  { id: 'seeding', label: 'Seeding' },
  { id: 'completed', label: 'Completed' },
  { id: 'paused', label: 'Paused' },
  { id: 'stalled', label: 'Stalled' }
]

// A grab the watchdog gave up on is paused underneath, so it takes the same
// buttons as a paused one — it just has a more useful word on it.
const isHalted = torrent => torrent.status === 'paused' || torrent.status === 'stalled'

// The download manager. Same job as a torrent client's transfer list: add,
// pause, resume, pick files, watch the numbers, delete with or without data.
export default async function downloads ({ container }) {
  container.innerHTML = '<div class="pad" id="downloads"></div>'
  const root = container.querySelector('#downloads')

  root.append(h(`
    <div class="row" style="justify-content:space-between;align-items:flex-start">
      <div><h1>Downloads</h1><p class="muted" style="margin-top:0">Files are saved to disk and keep downloading while you browse.</p></div>
      <div class="row" style="gap:16px" id="global-stats"></div>
    </div>`))

  const toolbar = h(`
    <div class="toolbar">
      <input class="field" id="magnet-input" style="flex:1;min-width:280px" placeholder="Paste a magnet link, info-hash or .torrent URL…">
      <button class="btn primary" id="add-magnet">Add</button>
      <label class="btn" for="torrent-file">⭱ .torrent file</label>
      <input type="file" id="torrent-file" accept=".torrent,application/x-bittorrent" hidden>
      <span style="flex:1"></span>
      <button class="btn small" id="resume-all">▶ Resume all</button>
      <button class="btn small" id="pause-all">⏸ Pause all</button>
      <button class="btn small" id="limits">⚙ Speed limits</button>
    </div>`)
  root.append(toolbar)

  const filterRow = h('<div class="row wrap" style="margin-bottom:16px"></div>')
  root.append(filterRow)

  const list = h('<div class="dl-table"></div>')
  root.append(list)

  const state = { filter: 'all', expanded: new Set(), data: { torrents: [], totals: {} } }

  FILTERS.forEach(filter => {
    const chip = h(`<button class="chip ${filter.id === state.filter ? 'active' : ''}" data-filter="${filter.id}">${filter.label}</button>`)
    chip.addEventListener('click', () => {
      state.filter = filter.id
      filterRow.querySelectorAll('.chip').forEach(node => node.classList.toggle('active', node.dataset.filter === filter.id))
      draw()
    })
    filterRow.append(chip)
  })

  /* ------------------------------------------------------------- adding */

  async function addFromInput () {
    const input = root.querySelector('#magnet-input')
    const value = input.value.trim()
    if (!value) return
    try {
      const record = await api.addTorrent({ magnet: value, mode: 'download' })
      input.value = ''
      toast(`Added ${record.name || 'torrent'}`, 'ok')
      await refresh()
    } catch (err) {
      toast(err.message, 'err')
    }
  }

  root.querySelector('#add-magnet').addEventListener('click', addFromInput)
  root.querySelector('#magnet-input').addEventListener('keydown', event => {
    if (event.key === 'Enter') addFromInput()
  })

  root.querySelector('#torrent-file').addEventListener('change', async event => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const record = await api.uploadTorrentFile(file)
      toast(`Added ${record.name || file.name}`, 'ok')
      await refresh()
    } catch (err) {
      toast(err.message, 'err')
    } finally {
      event.target.value = ''
    }
  })

  // Dropping a .torrent file or a magnet link anywhere on the page adds it.
  const onDrop = async event => {
    event.preventDefault()
    const file = event.dataTransfer?.files?.[0]
    const text = event.dataTransfer?.getData('text')
    try {
      if (file) await api.uploadTorrentFile(file)
      else if (text) await api.addTorrent({ magnet: text.trim(), mode: 'download' })
      else return
      toast('Added to downloads', 'ok')
      await refresh()
    } catch (err) {
      toast(err.message, 'err')
    }
  }
  const onDragOver = event => event.preventDefault()
  container.addEventListener('drop', onDrop)
  container.addEventListener('dragover', onDragOver)

  root.querySelector('#pause-all').addEventListener('click', async () => {
    await Promise.allSettled(state.data.torrents.map(torrent => api.pauseTorrent(torrent.id)))
    refresh()
  })
  root.querySelector('#resume-all').addEventListener('click', async () => {
    await Promise.allSettled(state.data.torrents.map(torrent => api.resumeTorrent(torrent.id)))
    refresh()
  })

  root.querySelector('#limits').addEventListener('click', async () => {
    const config = await api.getConfig()
    const toKb = value => (value > 0 ? Math.round(value / 1024) : 0)
    const answer = await confirmDialog({
      title: 'Speed limits',
      confirmLabel: 'Apply',
      body: `
        <label>Download limit (KB/s, 0 = unlimited)
          <input class="field" name="down" type="number" min="0" value="${toKb(config.downloadLimit)}"></label>
        <label>Upload limit (KB/s, 0 = unlimited)
          <input class="field" name="up" type="number" min="0" value="${toKb(config.uploadLimit)}"></label>`
    })
    if (!answer) return
    await api.saveConfig({
      downloadLimit: Number(answer.down) > 0 ? Number(answer.down) * 1024 : -1,
      uploadLimit: Number(answer.up) > 0 ? Number(answer.up) * 1024 : -1
    })
    toast('Speed limits applied', 'ok')
    refresh()
  })

  /* ------------------------------------------------------------ drawing */

  function matchesFilter (torrent) {
    switch (state.filter) {
      case 'downloading': return torrent.status === 'downloading' || torrent.status === 'connecting'
      case 'seeding': return torrent.status === 'seeding'
      case 'completed': return torrent.progress >= 1 || torrent.status === 'done' || torrent.status === 'seeding'
      case 'paused': return torrent.status === 'paused'
      case 'stalled': return torrent.status === 'stalled'
      default: return true
    }
  }

  function draw () {
    const totals = state.data.totals || {}
    root.querySelector('#global-stats').innerHTML = `
      <div><div class="tiny muted">Download</div><b style="color:#3ac47d">${bytes(totals.downloadSpeed, true)}</b></div>
      <div><div class="tiny muted">Upload</div><b style="color:#6ea8ff">${bytes(totals.uploadSpeed, true)}</b></div>
      <div><div class="tiny muted">Active</div><b>${totals.active || 0}/${totals.total || 0}</b></div>`

    const visible = state.data.torrents.filter(matchesFilter)
    const scroll = container.scrollTop
    list.innerHTML = ''

    if (!visible.length) {
      list.append(emptyState({
        title: state.filter === 'all' ? 'No downloads yet' : 'Nothing matches this filter',
        message: state.filter === 'all'
          ? 'Paste a magnet link above, drop a .torrent file on this page, or hit <b>Download</b> on any stream.'
          : 'Try another filter.'
      }))
      return
    }

    visible.forEach(torrent => list.append(row(torrent)))
    container.scrollTop = scroll
  }

  function row (torrent) {
    const done = torrent.progress >= 1
    const eta = done ? '—' : duration(torrent.timeRemaining)
    const node = h(`
      <div class="dl ${torrent.status} ${done ? 'done' : ''}">
        <div class="dl-top">
          <div class="thumb" style="${torrent.meta?.poster ? `background-image:url('${esc(torrent.meta.poster)}')` : ''}"></div>
          <div style="flex:1;min-width:0">
            <div class="name">${esc(torrent.name)}</div>
            <div class="meta">
              <span class="status ${esc(torrent.status)}">${esc(torrent.status)}</span>
              <span>${percent(torrent.progress)} of ${bytes(torrent.length)}</span>
              <span>↓ ${bytes(torrent.downloadSpeed, true)}</span>
              <span>↑ ${bytes(torrent.uploadSpeed, true)}</span>
              <span>${torrent.numPeers} peers</span>
              <span>ETA ${esc(eta)}</span>
              <span>ratio ${(torrent.ratio || 0).toFixed(2)}</span>
            </div>
          </div>
          <div class="actions">
            ${torrent.playableIndex !== null ? '<button class="btn small primary" data-act="play">▶ Play</button>' : ''}
            ${torrent.playableIndex !== null ? '<span data-slot="cast"></span>' : ''}
            <button class="btn small" data-act="toggle">${torrent.status === 'stalled' ? '↻ Try again' : isHalted(torrent) ? '▶ Resume' : '⏸ Pause'}</button>
            <button class="btn small ghost" data-act="files">Files (${torrent.files.length})</button>
            <button class="btn small ghost" data-act="where" title="Where is it saved?">📁</button>
            ${done && !torrent.imported ? '<button class="btn small ghost" data-act="import" title="File this into your media library">📚</button>' : ''}
            <button class="btn small danger" data-act="remove">Delete</button>
          </div>
        </div>
        <div class="bar"><i style="width:${percent(torrent.progress)}"></i></div>
        ${torrent.retryOf ? '<div class="tiny muted" style="margin-top:8px">↻ Swapped in after an earlier grab stalled</div>' : ''}
        ${torrent.imported ? `<div class="tiny muted" style="margin-top:8px">📚 In your library: <span class="mono">${esc(torrent.imported.path)}</span></div>` : ''}
        ${torrent.error ? `<div class="tiny" style="color:#ff9ba4;margin-top:8px">${esc(torrent.error)}</div>` : ''}
      </div>`)

    if (state.expanded.has(torrent.id)) node.append(fileList(torrent))

    node.querySelector('[data-slot="cast"]')?.append(castButton({
      torrentId: torrent.id,
      fileIdx: torrent.playableIndex,
      title: torrent.meta?.title || torrent.name
    }))

    node.querySelector('[data-act="play"]')?.addEventListener('click', () => {
      location.hash = `#/player/torrent/${torrent.id}?fileIdx=${torrent.playableIndex}&meta=${encodeURIComponent(JSON.stringify(torrent.meta || { title: torrent.name }))}`
    })

    node.querySelector('[data-act="toggle"]').addEventListener('click', async event => {
      event.currentTarget.disabled = true
      try {
        if (isHalted(torrent)) await api.resumeTorrent(torrent.id)
        else await api.pauseTorrent(torrent.id)
        await refresh()
      } catch (err) {
        toast(err.message, 'err')
      }
    })

    node.querySelector('[data-act="import"]')?.addEventListener('click', async event => {
      event.currentTarget.disabled = true
      try {
        const imported = await api.importTorrent(torrent.id)
        toast(imported.mode === 'copy' ? 'Copied into your library' : 'Linked into your library', 'ok')
        await refresh()
      } catch (err) {
        toast(err.message, 'err')
        event.currentTarget.disabled = false
      }
    })

    node.querySelector('[data-act="files"]').addEventListener('click', () => {
      if (state.expanded.has(torrent.id)) state.expanded.delete(torrent.id)
      else state.expanded.add(torrent.id)
      draw()
    })

    node.querySelector('[data-act="where"]').addEventListener('click', async () => {
      try {
        const where = await api.location(torrent.id)
        await confirmDialog({
          title: 'Saved location',
          confirmLabel: 'Close',
          body: `<div><b>Folder</b><textarea class="field mono tiny" rows="2" readonly>${esc(where.folder)}</textarea></div>
                 ${where.files.length ? `<div><b>Files</b><textarea class="field mono tiny" rows="5" readonly>${esc(where.files.join('\n'))}</textarea></div>` : ''}`
        })
      } catch (err) {
        toast(err.message, 'err')
      }
    })

    node.querySelector('[data-act="remove"]').addEventListener('click', async () => {
      const answer = await confirmDialog({
        title: 'Remove download?',
        danger: true,
        confirmLabel: 'Remove',
        body: `<p>“${esc(torrent.name)}” will be removed from the list.</p>
               <label class="row"><input type="checkbox" name="deleteFiles"> Also delete the downloaded files from disk</label>`
      })
      if (!answer) return
      try {
        await api.removeTorrent(torrent.id, answer.deleteFiles)
        toast('Removed', 'ok')
        await refresh()
      } catch (err) {
        toast(err.message, 'err')
      }
    })

    return node
  }

  // Per-file checkboxes, the way a torrent client lets you skip the extras.
  function fileList (torrent) {
    const wrap = h('<div class="files"></div>')
    torrent.files.forEach(file => {
      const fileRow = h(`
        <label class="file-row">
          <input type="checkbox" ${file.selected ? 'checked' : ''} data-index="${file.index}">
          <span class="fname" title="${esc(file.name)}">${esc(file.name)}</span>
          <span class="muted">${percent(file.progress)}</span>
          <span class="muted">${bytes(file.length)}</span>
          ${file.video ? '<button class="btn small ghost" data-play-file>▶</button>' : ''}
        </label>`)
      fileRow.querySelector('[data-play-file]')?.addEventListener('click', event => {
        event.preventDefault()
        location.hash = `#/player/torrent/${torrent.id}?fileIdx=${file.index}&meta=${encodeURIComponent(JSON.stringify({ title: file.name }))}`
      })
      wrap.append(fileRow)
    })

    wrap.addEventListener('change', async () => {
      const indices = [...wrap.querySelectorAll('input[type="checkbox"]')]
        .filter(input => input.checked)
        .map(input => Number(input.dataset.index))
      try {
        await api.selectFiles(torrent.id, indices)
        toast(`${indices.length} file${indices.length === 1 ? '' : 's'} selected`, 'ok')
        await refresh()
      } catch (err) {
        toast(err.message, 'err')
      }
    })
    return wrap
  }

  async function refresh () {
    try {
      state.data = await api.torrents()
      draw()
    } catch (err) {
      list.innerHTML = ''
      list.append(h(`<div class="error-box">${esc(err.message)}</div>`))
    }
  }

  await refresh()
  const timer = setInterval(refresh, 1000)

  return {
    destroy () {
      clearInterval(timer)
      container.removeEventListener('drop', onDrop)
      container.removeEventListener('dragover', onDragOver)
    }
  }
}
