import { route, startRouter, navigate, currentPath, render } from './router.js'
import { api } from './api.js'
import { bytes, debounce } from './util.js'
import { initTvMode, focusFirst } from './tv.js'
import { MAIN, currentViewer, setViewer, askedThisSession, whoIsWatching, avatar } from './viewers.js'

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

/* ---------------------------------------------------------------- profiles */

// The avatar in the top bar: who is watching, and a way to change it. Only
// there once the household has more than one profile.
const whoButton = document.createElement('button')
whoButton.className = 'who-button'
whoButton.hidden = true
document.querySelector('.topbar').append(whoButton)
let viewerList = []

async function loadViewers () {
  try {
    viewerList = await api.viewers()
  } catch {
    viewerList = []
  }
  // A profile removed on another device, or this device's first run.
  if (viewerList.length && !viewerList.some(viewer => viewer.id === currentViewer())) setViewer(MAIN)
  const me = viewerList.find(viewer => viewer.id === currentViewer())
  whoButton.hidden = viewerList.length < 2
  whoButton.innerHTML = me ? `${avatar(me)}<span class="who-label">${me.name.replace(/[<>&"]/g, '')}</span>` : ''
  whoButton.title = 'Switch profile'
}

whoButton.addEventListener('click', async () => {
  setViewer(await whoIsWatching(viewerList, { cancellable: true }))
})

// Everything on screen belongs to the profile that was watching: draw it again.
let booted = false
window.addEventListener('viewerchange', async () => {
  loadViewers()
  if (booted && !currentPath().startsWith('/player/')) await render()
  // On a TV the remote starts again from the page, not the avatar.
  if (document.documentElement.classList.contains('tv')) setTimeout(focusFirst, 150)
})
// Settings added, renamed or removed one.
window.addEventListener('viewerschanged', loadViewers)

/* -------------------------------------------------------------------- boot */

if (!location.hash) location.hash = '#/board'
initTvMode()
;(async () => {
  await loadViewers()
  // More than one profile and not asked yet this session: ask first, as
  // Netflix does on every launch.
  if (viewerList.length > 1 && !askedThisSession() && !currentPath().startsWith('/settings')) {
    setViewer(await whoIsWatching(viewerList))
  }
  booted = true
  startRouter()
})()

// Keep the search box in sync when the route changes underneath it.
window.addEventListener('hashchange', () => {
  const path = currentPath()
  if (!path.startsWith('/search')) input.value = ''
})
