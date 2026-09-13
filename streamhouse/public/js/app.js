import { route, startRouter, navigate, currentPath } from './router.js'
import { api } from './api.js'
import { bytes, debounce } from './util.js'
import { initTvMode } from './tv.js'
import { nextEpisode, episodeHref } from './playback.js'

import board from './views/board.js'
import discover from './views/discover.js'
import search from './views/search.js'
import detail from './views/detail.js'
import library from './views/library.js'
import downloads from './views/downloads.js'
import addons from './views/addons.js'
import settings from './views/settings.js'
import player from './views/player.js'

route('/board', board)
route('/discover', discover)
route('/search', search)
route('/detail/:type/:id', detail)
route('/library', library)
route('/downloads', downloads)
route('/addons', addons)
route('/settings', settings)
route('/player/:kind/:id', player)

/* ------------------------------------------------------------------ search */

const form = document.getElementById('search-form')
const input = document.getElementById('search-input')

form.addEventListener('submit', event => {
  event.preventDefault()
  const term = input.value.trim()
  if (term) navigate(`/search?q=${encodeURIComponent(term)}`)
})

// Search as you type, but only once typing settles.
input.addEventListener('input', debounce(() => {
  const term = input.value.trim()
  if (term.length >= 2) navigate(`/search?q=${encodeURIComponent(term)}`, { replace: true })
}, 450))

window.addEventListener('keydown', event => {
  if (event.key === '/' && !event.target.matches('input, textarea, select')) {
    event.preventDefault()
    input.focus()
  }
})

/* ------------------------------------------------- global transfer counters */

const badge = document.getElementById('dl-badge')
const down = document.getElementById('net-down')
const up = document.getElementById('net-up')

async function pollStats () {
  try {
    const { torrents, totals } = await api.torrents()
    down.textContent = bytes(totals.downloadSpeed, true)
    up.textContent = bytes(totals.uploadSpeed, true)
    const active = torrents.filter(torrent => torrent.status === 'downloading' || torrent.status === 'connecting').length
    badge.hidden = active === 0
    badge.textContent = String(active)
  } catch {
    down.textContent = '—'
    up.textContent = '—'
  }
}
pollStats()
setInterval(pollStats, 2000)

/* ----------------------------------------------------- the Android TV app */

// Playback there belongs to the native player, which knows only a URL and a
// position. When an episode ends — or the ⏭ key is pressed on the remote — it
// hands control back here, and the next episode is looked up and started the
// same way as anywhere else.
window.addEventListener('streamhouse-playback-ended', async () => {
  let played = null
  try {
    played = JSON.parse(sessionStorage.getItem('sh-native-playback') || 'null')
  } catch { /* nothing remembered */ }
  if (!played) return
  try {
    const next = await nextEpisode(played)
    if (!next) return
    location.hash = await episodeHref(next, played)
  } catch { /* no next episode to be had */ }
})

/* -------------------------------------------------------------------- boot */

if (!location.hash) location.hash = '#/board'
initTvMode()
startRouter()

// Keep the search box in sync when the route changes underneath it.
window.addEventListener('hashchange', () => {
  const path = currentPath()
  if (!path.startsWith('/search')) input.value = ''
})
