/* Thin wrapper around the local StreamHouse HTTP API. */

import { currentViewer } from './viewers.js'

async function request (url, options = {}) {
  const res = await fetch(url, {
    ...options,
    // Which profile is watching: progress, ticks and the library are its own.
    headers: { 'X-Viewer': currentViewer(), ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`)
    // Some refusals are expected, and the caller needs to know which one.
    err.code = data?.code || null
    throw err
  }
  return data
}

const qs = params => {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') search.set(key, value)
  }
  const string = search.toString()
  return string ? `?${string}` : ''
}

export const api = {
  health: () => request('/api/health'),

  getConfig: () => request('/api/config'),
  saveConfig: patch => request('/api/config', { method: 'POST', body: patch }),
  profiles: () => request('/api/profiles'),

  intro: series => request(`/api/intro/${encodeURIComponent(series)}`),
  learnIntro: (series, body) => request(`/api/intro/${encodeURIComponent(series)}`, { method: 'POST', body }),
  forgetIntro: series => request(`/api/intro/${encodeURIComponent(series)}`, { method: 'DELETE' }),

  viewers: () => request('/api/viewers'),
  addViewer: body => request('/api/viewers', { method: 'POST', body }),
  updateViewer: (id, body) => request(`/api/viewers/${encodeURIComponent(id)}`, { method: 'POST', body }),
  removeViewer: id => request(`/api/viewers/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  addons: (refresh = false) => request(`/api/addons${refresh ? '?refresh=1' : ''}`),
  installAddon: url => request('/api/addons', { method: 'POST', body: { url } }),
  removeAddon: id => request(`/api/addons/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  toggleAddon: (id, enabled) => request(`/api/addons/${encodeURIComponent(id)}/toggle`, { method: 'POST', body: { enabled } }),
  reorderAddons: ids => request('/api/addons/reorder', { method: 'POST', body: { ids } }),

  catalogs: () => request('/api/catalogs'),
  catalog: params => request(`/api/catalog${qs(params)}`),
  meta: (type, id) => request(`/api/meta/${encodeURIComponent(type)}/${encodeURIComponent(id)}`),
  streams: (type, id) => request(`/api/streams/${encodeURIComponent(type)}/${encodeURIComponent(id)}`),
  subtitles: (type, id, extra) => request(`/api/subtitles/${encodeURIComponent(type)}/${encodeURIComponent(id)}${qs(extra)}`),
  search: (q, type) => request(`/api/search${qs({ q, type })}`),

  library: () => request('/api/library'),
  addToLibrary: item => request('/api/library', { method: 'POST', body: item }),
  removeFromLibrary: id => request(`/api/library/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  account: () => request('/api/account'),
  accountLogin: body => request('/api/account/login', { method: 'POST', body }),
  accountSignup: body => request('/api/account/signup', { method: 'POST', body }),
  accountLogout: () => request('/api/account/logout', { method: 'POST' }),
  accountSync: () => request('/api/account/sync', { method: 'POST' }),

  progress: () => request('/api/progress'),
  saveProgress: body => request('/api/progress', { method: 'POST', body }),
  clearProgress: id => request(`/api/progress/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  hideProgress: id => request(`/api/progress/${encodeURIComponent(id)}/hide`, { method: 'POST' }),
  setWatched: body => request('/api/watched', { method: 'POST', body }),

  torrents: () => request('/api/torrents'),
  addTorrent: body => request('/api/torrents', { method: 'POST', body }),
  uploadTorrentFile: async file => {
    const res = await fetch('/api/torrents/file', { method: 'POST', body: file })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.error || 'Upload failed')
    return data
  },
  pauseTorrent: id => request(`/api/torrents/${encodeURIComponent(id)}/pause`, { method: 'POST' }),
  resumeTorrent: id => request(`/api/torrents/${encodeURIComponent(id)}/resume`, { method: 'POST' }),
  selectFiles: (id, indices) => request(`/api/torrents/${encodeURIComponent(id)}/files`, { method: 'POST', body: { indices } }),
  removeTorrent: (id, deleteFiles) => request(`/api/torrents/${encodeURIComponent(id)}${qs({ deleteFiles: deleteFiles ? 1 : '' })}`, { method: 'DELETE' }),
  location: id => request(`/api/torrents/${encodeURIComponent(id)}/location`),

  playback: (id, fileIdx) => request(`/api/playback/${encodeURIComponent(id)}${qs({ fileIdx })}`),
  streamUrl: (id, fileIdx) => `/api/stream/${encodeURIComponent(id)}${fileIdx === undefined || fileIdx === null ? '' : `/${fileIdx}`}`,
  subtitleUrl: url => `/api/subtitle${qs({ url })}`,

  vlc: () => request('/api/vlc'),
  playInVlc: body => request('/api/vlc/play', { method: 'POST', body }),

  network: () => request('/api/network'),
  exposeNetwork: enabled => request('/api/network/expose', { method: 'POST', body: { enabled } }),

  castDevices: (refresh = false) => request(`/api/cast/devices${refresh ? '?refresh=1' : ''}`),
  castAddDevice: location => request('/api/cast/devices', { method: 'POST', body: { location } }),
  castForget: id => request(`/api/cast/devices/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  castPlay: body => request('/api/cast/play', { method: 'POST', body }),
  castControl: (id, action, value = null) => request(`/api/cast/${encodeURIComponent(id)}/control`, { method: 'POST', body: { action, value } }),
  castStatus: id => request(`/api/cast/${encodeURIComponent(id)}/status`),

  disk: () => request('/api/disk'),
  clearCache: () => request('/api/cache/clear', { method: 'POST' })
}
