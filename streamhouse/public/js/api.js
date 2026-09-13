/* Thin wrapper around the local StreamHouse HTTP API. */

async function request (url, options = {}) {
  const res = await fetch(url, {
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`)
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

  progress: () => request('/api/progress'),
  saveProgress: body => request('/api/progress', { method: 'POST', body }),
  clearProgress: id => request(`/api/progress/${encodeURIComponent(id)}`, { method: 'DELETE' }),

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
