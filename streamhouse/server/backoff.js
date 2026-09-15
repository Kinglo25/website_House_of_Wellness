/* Escalating backoff for things that keep failing.
 *
 * An add-on that has gone away costs a 25 second timeout on every single
 * lookup, forever, and says nothing about it. Sonarr's provider status service
 * solves this by standing further and further back from anything that keeps
 * failing — a minute, then five, then fifteen, up to a day — and showing that
 * state in the UI. These are its periods.
 *
 * Deliberately in memory only: a restart gives every add-on a clean slate,
 * which is the forgiving choice, and the same one the queue watchdog makes.
 */

// Seconds to wait after the 1st, 2nd, 3rd… consecutive failure. The first is
// zero on purpose: one blip should cost nothing.
export const BACKOFF_SECONDS = [0, 60, 5 * 60, 15 * 60, 30 * 60, 60 * 60, 3 * 60 * 60, 6 * 60 * 60, 12 * 60 * 60, 24 * 60 * 60]

export class FailureTracker {
  constructor () {
    this.state = new Map()
  }

  /* It worked: forget everything that went before. */
  recordSuccess (id) {
    if (id) this.state.delete(String(id))
  }

  recordFailure (id, message = '', now = Date.now()) {
    const key = String(id || '')
    if (!key) return null
    const previous = this.state.get(key)
    const failures = (previous?.failures || 0) + 1
    const seconds = BACKOFF_SECONDS[Math.min(failures - 1, BACKOFF_SECONDS.length - 1)]
    const entry = {
      failures,
      lastError: message,
      failingSince: previous?.failingSince || now,
      disabledUntil: now + seconds * 1000
    }
    this.state.set(key, entry)
    return entry
  }

  isAvailable (id, now = Date.now()) {
    const entry = this.state.get(String(id || ''))
    return !entry || now >= entry.disabledUntil
  }

  /* What the UI needs to explain itself. Null when nothing is wrong. */
  status (id, now = Date.now()) {
    const entry = this.state.get(String(id || ''))
    if (!entry) return null
    const waitingFor = Math.max(0, entry.disabledUntil - now)
    return {
      failures: entry.failures,
      lastError: entry.lastError,
      failingSince: entry.failingSince,
      failingForMs: now - entry.failingSince,
      // Only ever counts down; a tracker entry with nothing left to wait for
      // is an add-on on its last warning, not one being skipped.
      retryInMs: waitingFor,
      skipped: waitingFor > 0
    }
  }

  clear (id) {
    if (id) this.state.delete(String(id))
    else this.state.clear()
  }
}
