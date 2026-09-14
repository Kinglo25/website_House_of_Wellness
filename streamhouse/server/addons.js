import { JsonStore } from './store.js'

// A client for the Stremio add-on protocol.
//
// An add-on is just an HTTP endpoint that serves a manifest plus any of the
// `catalog`, `meta`, `stream` and `subtitles` resources:
//
//   GET <base>/manifest.json
//   GET <base>/<resource>/<type>/<id>.json
//   GET <base>/<resource>/<type>/<id>/<extra>.json
//
// The app ships with the public Cinemeta metadata add-on so the catalogues are
// not empty on first run; every other source is whatever the user installs.

const DEFAULT_ADDONS = [
  { transportUrl: 'https://v3-cinemeta.strem.io/manifest.json', enabled: true }
]

const CACHE_TTL_MS = 5 * 60 * 1000
const REQUEST_TIMEOUT_MS = 20 * 1000

const cache = new Map()

function cacheGet (key) {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() > hit.expires) {
    cache.delete(key)
    return null
  }
  return hit.value
}

function cacheSet (key, value, ttl = CACHE_TTL_MS) {
  if (cache.size > 500) cache.clear()
  cache.set(key, { value, expires: Date.now() + ttl })
}

export function clearAddonCache () {
  cache.clear()
}

async function getJson (url, { timeout = REQUEST_TIMEOUT_MS, useCache = true } = {}) {
  if (useCache) {
    const hit = cacheGet(url)
    if (hit) return hit
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': 'StreamHouse/1.0' }
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
    const json = await res.json()
    if (useCache) cacheSet(url, json)
    return json
  } finally {
    clearTimeout(timer)
  }
}

export function normalizeTransportUrl (input) {
  let url = String(input || '').trim()
  if (!url) throw new Error('An add-on URL is required')
  url = url.replace(/^stremio:\/\//i, 'https://')
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  if (!/manifest\.json$/i.test(url)) url = `${url.replace(/\/+$/, '')}/manifest.json`
  return url
}

function baseUrl (transportUrl) {
  return transportUrl.replace(/\/manifest\.json$/i, '')
}

// `resources` entries are either a plain name or an object with its own
// type/idPrefix restrictions. Normalizing them makes routing requests simple.
function resourceEntries (manifest) {
  return (manifest.resources || []).map(entry => {
    if (typeof entry === 'string') {
      return { name: entry, types: manifest.types || [], idPrefixes: manifest.idPrefixes || null }
    }
    return {
      name: entry.name,
      types: entry.types || manifest.types || [],
      idPrefixes: entry.idPrefixes || manifest.idPrefixes || null
    }
  })
}

function supports (manifest, resource, type, id) {
  return resourceEntries(manifest).some(entry => {
    if (entry.name !== resource) return false
    if (type && entry.types?.length && !entry.types.includes(type)) return false
    if (id && entry.idPrefixes?.length && !entry.idPrefixes.some(prefix => String(id).startsWith(prefix))) return false
    return true
  })
}

function encodeExtra (extra) {
  const parts = Object.entries(extra || {})
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
  return parts.join('&')
}

function resourceUrl (transportUrl, resource, type, id, extra) {
  const encoded = encodeExtra(extra)
  const tail = encoded ? `/${encoded}` : ''
  return `${baseUrl(transportUrl)}/${resource}/${encodeURIComponent(type)}/${encodeURIComponent(id)}${tail}.json`
}

class AddonManager {
  constructor () {
    this.store = new JsonStore('addons', DEFAULT_ADDONS)
    if (!this.store.get().length) this.store.set(structuredClone(DEFAULT_ADDONS))
    this.refreshManifests()
  }

  list () {
    return this.store.get()
  }

  enabled () {
    return this.list().filter(addon => addon.enabled !== false && addon.manifest)
  }

  find (id) {
    return this.list().find(addon => addon.manifest?.id === id || addon.transportUrl === id)
  }

  // Manifests are cached on disk so the UI renders instantly offline, then
  // refreshed in the background on every boot.
  async refreshManifests () {
    await Promise.all(this.list().map(async addon => {
      try {
        const manifest = await getJson(addon.transportUrl, { useCache: false })
        addon.manifest = manifest
        addon.error = null
      } catch (err) {
        addon.error = err.message
      }
    }))
    this.store.save()
    return this.list()
  }

  async install (url) {
    const transportUrl = normalizeTransportUrl(url)
    const manifest = await getJson(transportUrl, { useCache: false })
    if (!manifest?.id || !Array.isArray(manifest.resources)) {
      throw new Error('That URL did not return a valid Stremio add-on manifest')
    }
    const addons = this.list()
    const existing = addons.findIndex(addon => addon.transportUrl === transportUrl || addon.manifest?.id === manifest.id)
    const record = { transportUrl, manifest, enabled: true, addedAt: Date.now(), error: null }
    if (existing >= 0) addons[existing] = { ...addons[existing], ...record }
    else addons.push(record)
    this.store.set(addons)
    clearAddonCache()
    return record
  }

  remove (id) {
    const addons = this.list().filter(addon => addon.manifest?.id !== id && addon.transportUrl !== id)
    this.store.set(addons)
    clearAddonCache()
    return addons
  }

  toggle (id, enabled) {
    const addon = this.find(id)
    if (!addon) throw new Error('Add-on not found')
    addon.enabled = enabled
    this.store.save()
    clearAddonCache()
    return addon
  }

  reorder (ids) {
    const addons = this.list()
    const byId = new Map(addons.map(addon => [addon.manifest?.id || addon.transportUrl, addon]))
    const next = []
    for (const id of ids) {
      const addon = byId.get(id)
      if (addon) {
        next.push(addon)
        byId.delete(id)
      }
    }
    next.push(...byId.values())
    this.store.set(next)
    return next
  }

  // The add-on list as another device has it: the same add-ons in the same
  // order, switched on and off the same way. Manifests already here are kept;
  // the rest are fetched.
  replaceList (entries) {
    const known = new Map(this.list().map(addon => [addon.transportUrl, addon]))
    const next = entries
      .filter(entry => entry?.transportUrl)
      .map(entry => ({
        ...(known.get(entry.transportUrl) || { manifest: null, error: null, addedAt: Date.now() }),
        transportUrl: entry.transportUrl,
        enabled: entry.enabled !== false
      }))
    this.store.set(next)
    clearAddonCache()
    if (next.some(addon => !addon.manifest)) this.refreshManifests()
    return next
  }

  // Flattened list of every catalogue every enabled add-on exposes.
  catalogs () {
    const out = []
    for (const addon of this.enabled()) {
      for (const catalog of addon.manifest.catalogs || []) {
        const extras = catalog.extra || (catalog.extraSupported || []).map(name => ({ name }))
        out.push({
          addonId: addon.manifest.id,
          addonName: addon.manifest.name,
          type: catalog.type,
          id: catalog.id,
          name: catalog.name || catalog.id,
          genres: extras.find(extra => extra.name === 'genre')?.options || [],
          searchable: extras.some(extra => extra.name === 'search'),
          requiresSearch: extras.some(extra => extra.name === 'search' && extra.isRequired),
          extras: extras.map(extra => extra.name)
        })
      }
    }
    return out
  }

  async catalog ({ addonId, type, id, skip = 0, genre = '', search = '' }) {
    const addon = this.find(addonId)
    if (!addon?.manifest) throw new Error('Add-on not found')
    const extra = {}
    if (Number(skip) > 0) extra.skip = Number(skip)
    if (genre) extra.genre = genre
    if (search) extra.search = search
    const url = resourceUrl(addon.transportUrl, 'catalog', type, id, extra)
    const json = await getJson(url)
    return (json?.metas || []).map(meta => ({ ...meta, addonId: addon.manifest.id }))
  }

  // Ask every add-on that claims to know about this id, first answer wins.
  async meta (type, id) {
    const candidates = this.enabled().filter(addon => supports(addon.manifest, 'meta', type, id))
    for (const addon of candidates) {
      try {
        const json = await getJson(resourceUrl(addon.transportUrl, 'meta', type, id))
        if (json?.meta) return { ...json.meta, addonId: addon.manifest.id }
      } catch (err) {
        console.warn(`[addons] meta failed on ${addon.manifest.id}: ${err.message}`)
      }
    }
    return null
  }

  // Streams are merged across every add-on, in the order the add-ons are
  // installed, so the user's preferred source stays on top.
  async streams (type, id) {
    const candidates = this.enabled().filter(addon => supports(addon.manifest, 'stream', type, id))
    const results = await Promise.allSettled(candidates.map(async addon => {
      const json = await getJson(resourceUrl(addon.transportUrl, 'stream', type, id), { timeout: 25000 })
      return (json?.streams || []).map(stream => ({
        ...stream,
        addonId: addon.manifest.id,
        addonName: addon.manifest.name
      }))
    }))
    const streams = []
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') streams.push(...result.value)
      else console.warn(`[addons] stream failed on ${candidates[index]?.manifest?.id}: ${result.reason?.message}`)
    })
    return streams
  }

  async subtitles (type, id, extra = {}) {
    const candidates = this.enabled().filter(addon => supports(addon.manifest, 'subtitles', type, id))
    const results = await Promise.allSettled(candidates.map(async addon => {
      const json = await getJson(resourceUrl(addon.transportUrl, 'subtitles', type, id, extra))
      return (json?.subtitles || []).map(sub => ({ ...sub, addonName: addon.manifest.name }))
    }))
    return results.filter(r => r.status === 'fulfilled').flatMap(r => r.value)
  }

  // Search every searchable catalogue at once and de-duplicate by meta id.
  async search (query, types = null) {
    const targets = this.catalogs().filter(catalog => {
      if (!catalog.searchable) return false
      if (types && !types.includes(catalog.type)) return false
      return true
    })
    const results = await Promise.allSettled(targets.map(catalog =>
      this.catalog({ addonId: catalog.addonId, type: catalog.type, id: catalog.id, search: query })
    ))
    const seen = new Set()
    const metas = []
    results.forEach((result, index) => {
      if (result.status !== 'fulfilled') return
      for (const meta of result.value) {
        const key = `${meta.type}:${meta.id}`
        if (seen.has(key)) continue
        seen.add(key)
        metas.push({ ...meta, catalogName: targets[index].name, addonName: targets[index].addonName })
      }
    })
    return metas
  }
}

export const addons = new AddonManager()
