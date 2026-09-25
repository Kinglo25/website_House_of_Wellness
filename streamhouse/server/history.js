import crypto from 'crypto'
import { JsonStore } from './store.js'
import { MAIN, MAX_VIEWERS, COLOURS, defaultViewers, normalise } from './viewers.js'

// What has been watched and kept: edited by the API, carried between devices
// by account sync.
export const library = new JsonStore('library', [])
export const progress = new JsonStore('progress', {})

// Who watches here: see viewers.js.
export const viewersStore = new JsonStore('viewers', defaultViewers())

export const viewers = {
  store: viewersStore,
  list: () => normalise(viewersStore.get()),
  has: id => viewers.list().some(viewer => viewer.id === id),
  replace: list => viewersStore.set(normalise(list)),

  add ({ name, colour }) {
    const list = viewers.list()
    if (list.length >= MAX_VIEWERS) throw Object.assign(new Error(`At most ${MAX_VIEWERS} profiles`), { status: 400 })
    const viewer = { id: crypto.randomBytes(4).toString('hex'), name, colour: colour || COLOURS[list.length % COLOURS.length] }
    viewersStore.set(normalise([...list, viewer]))
    return viewers.list().find(entry => entry.id === viewer.id)
  },

  update (id, { name, colour }) {
    const list = viewers.list()
    const viewer = list.find(entry => entry.id === id)
    if (!viewer) throw Object.assign(new Error('No such profile'), { status: 404 })
    if (name !== undefined) viewer.name = name
    if (colour !== undefined) viewer.colour = colour
    viewersStore.set(normalise(list))
    return viewers.list().find(entry => entry.id === id)
  },

  remove (id) {
    if (id === MAIN) throw Object.assign(new Error('The main profile cannot be removed'), { status: 400 })
    viewersStore.set(viewers.list().filter(entry => entry.id !== id))
  }
}

