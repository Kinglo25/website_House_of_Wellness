import crypto from 'crypto'

/* The rules account sync merges by, kept free of stores and network so the
 * tests can check them directly.
 *
 * Each synced item is compared with a fingerprint of the value last agreed with
 * the account server. `agreed` is undefined for an item never synced, null for
 * one agreed deleted. */

export function fingerprint (value) {
  if (value === null || value === undefined) return null
  return crypto.createHash('sha1').update(JSON.stringify(value)).digest('hex')
}

// Everything in `current` that differs from what was last agreed, plus
// deletions: agreed items that are no longer there. An item's own date wins;
// otherwise the last time anything of this kind was edited here.
export function localChanges ({ kind, current, agreed = {}, stamp = () => 0, changedAt = 0, deletable = true, now = Date.now() }) {
  const changes = []
  for (const [key, value] of Object.entries(current)) {
    if (value === undefined || agreed[key] === fingerprint(value)) continue
    changes.push({ kind, key, value, updatedAt: stamp(value) || changedAt || now })
  }
  if (deletable) {
    for (const [key, print] of Object.entries(agreed)) {
      if (print !== null && !(key in current)) changes.push({ kind, key, value: null, updatedAt: changedAt || now })
    }
  }
  return changes
}

// Whether an item from the server should replace what this device has. It
// does unless this device edited the item since they last agreed, and did so
// more recently than the server's copy was edited.
export function remoteWins ({ remote, local, agreed, stamp = () => 0, changedAt = 0 }) {
  const print = fingerprint(local)
  if (print === fingerprint(remote.value)) return true
  const editedHere = agreed === undefined ? print !== null : agreed !== print
  if (!editedHere) return true
  const localStamp = (local !== null && local !== undefined && stamp(local)) || changedAt
  return remote.updatedAt >= localStamp
}
