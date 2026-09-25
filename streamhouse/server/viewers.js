/* Profiles: who is watching, Netflix-style. Each has its own Continue watching,
 * ticks, Up next and library; everything else — add-ons, downloads, settings —
 * is the household's.
 *
 * Called "viewers" in the code because /api/profiles already means the stream
 * quality profiles.
 *
 * The main profile owns the data exactly as it was stored before profiles
 * existed, so nothing moves and a device that has not been updated still sees
 * it. Another profile's progress entries are the same entries under a
 * prefixed key, `p:<id>:<video id>`, and its library items carry `viewer:
 * <id>`. Both sync through the account server as they are: to it a key is a
 * key, so it needs no change. */

export const MAIN = 'main'
const PREFIX = 'p:'
export const COLOURS = ['#7b5bf5', '#e35d6a', '#3ac47d', '#f5a623', '#3a9ad9', '#d95fb5', '#8a8fa8']
export const MAX_VIEWERS = 6

export const defaultViewers = () => [{ id: MAIN, name: 'Me', colour: COLOURS[0] }]

/* ----------------------------------------------------- keys (pure, tested) */

export function scopeKey (viewer, key) {
  return !viewer || viewer === MAIN ? String(key) : `${PREFIX}${viewer}:${key}`
}

// Whose a stored key is, and the key as that profile knows it.
export function splitKey (key) {
  const match = /^p:([a-z0-9]{1,16}):(.*)$/s.exec(String(key))
  return match ? { viewer: match[1], key: match[2] } : { viewer: MAIN, key: String(key) }
}

// One profile's progress, keyed and identified as that profile knows it.
export function progressOf (all, viewer = MAIN) {
  const view = {}
  for (const [stored, entry] of Object.entries(all || {})) {
    const { viewer: owner, key } = splitKey(stored)
    if (owner === viewer) view[key] = { ...entry, id: key }
  }
  return view
}

export function libraryOf (items, viewer = MAIN) {
  return (items || []).filter(item => (item.viewer || MAIN) === viewer)
}

// The list as stored, made whole: always a main profile, first, and nothing
// malformed — the list arrives from other devices too.
export function normalise (list) {
  const seen = new Set()
  const clean = []
  for (const viewer of Array.isArray(list) ? list : []) {
    const id = String(viewer?.id || '')
    if (!/^[a-z0-9]{1,16}$/.test(id) || seen.has(id)) continue
    seen.add(id)
    clean.push({
      id,
      name: String(viewer.name || '').trim().slice(0, 24) || (id === MAIN ? 'Me' : 'Viewer'),
      colour: /^#[0-9a-f]{6}$/i.test(viewer.colour) ? viewer.colour : COLOURS[clean.length % COLOURS.length]
    })
  }
  if (!seen.has(MAIN)) clean.unshift(defaultViewers()[0])
  else clean.sort((a, b) => (a.id === MAIN ? -1 : b.id === MAIN ? 1 : 0))
  return clean.slice(0, MAX_VIEWERS)
}

// Which profile a request is for: the X-Viewer header, if it names one that
// exists. `known` is the current list.
export function viewerOf (req, known) {
  const asked = String(req.get?.('x-viewer') || '')
  return asked && known.some(viewer => viewer.id === asked) ? asked : MAIN
}
