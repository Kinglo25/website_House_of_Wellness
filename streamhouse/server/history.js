import { JsonStore } from './store.js'

// What has been watched and kept: edited by the API, carried between devices
// by account sync.
export const library = new JsonStore('library', [])
export const progress = new JsonStore('progress', {})
