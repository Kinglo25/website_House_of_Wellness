import { h, esc } from './util.js'

/* Who is watching on this screen — Netflix's profiles.
 *
 * The choice belongs to the device: remembered in localStorage so the picker
 * starts on the last one, and asked for again each session (each browser tab,
 * each launch of the TV app) whenever there is more than one profile, as
 * Netflix asks on every launch. The server is told on every request through
 * the X-Viewer header — see api.js. */

export const MAIN = 'main'
const STORE = 'sh-viewer'
const ASKED = 'sh-viewer-asked'

const read = (storage, key) => { try { return storage.getItem(key) } catch { return null } }
const write = (storage, key, value) => { try { storage.setItem(key, value) } catch { /* not remembered */ } }

let current = read(localStorage, STORE) || MAIN

export const currentViewer = () => current

export function setViewer (id) {
  current = id || MAIN
  write(localStorage, STORE, current)
  write(sessionStorage, ASKED, '1')
  window.dispatchEvent(new CustomEvent('viewerchange', { detail: current }))
}

export const askedThisSession = () => read(sessionStorage, ASKED) === '1'

// A key as the server stores it for this profile. The TV app's native player
// reports progress with nothing but the key it was handed, so it is handed one
// that already says whose it is.
export function scopedKey (key) {
  return current === MAIN ? String(key) : `p:${current}:${key}`
}

// Per-profile browser memory, for preferences such as the subtitle language.
export const viewerStorageKey = name => (current === MAIN ? name : `${name}:${current}`)

export function avatar (viewer, size = '') {
  const initial = (viewer?.name || '?').trim().charAt(0).toUpperCase() || '?'
  return `<span class="avatar ${size}" style="background:${esc(viewer?.colour || '#7b5bf5')}" aria-hidden="true">${esc(initial)}</span>`
}

/* The "Who's watching?" screen. Resolves with the chosen profile's id. */
export function whoIsWatching (list, { cancellable = false } = {}) {
  return new Promise(resolve => {
    document.querySelector('.who')?.remove()
    const screen = h(`
      <div class="who" role="dialog" aria-label="Who's watching?">
        <h1>Who’s watching?</h1>
        <div class="who-list">
          ${list.map(viewer => `
            <button class="who-pick${viewer.id === current ? ' last' : ''}" data-id="${esc(viewer.id)}">
              ${avatar(viewer, 'xl')}
              <span class="who-name">${esc(viewer.name)}</span>
            </button>`).join('')}
        </div>
        <a class="btn ghost small" href="#/settings?section=profiles" data-act="manage">Manage profiles</a>
      </div>`)
    const done = id => {
      screen.remove()
      document.removeEventListener('keydown', onKey, true)
      resolve(id)
    }
    screen.addEventListener('click', event => {
      const pick = event.target.closest('.who-pick')
      if (pick) return done(pick.dataset.id)
      if (event.target.closest('[data-act="manage"]')) done(current)
    })
    const onKey = event => {
      if (cancellable && event.key === 'Escape') { event.stopPropagation(); done(current) }
    }
    document.addEventListener('keydown', onKey, true)
    document.body.append(screen)
    // The one watching last time starts focused: one press of OK carries on.
    ;(screen.querySelector('.who-pick.last') || screen.querySelector('.who-pick'))?.focus()
  })
}
