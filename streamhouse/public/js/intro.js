/* Skip Intro, learned from people rather than detected.
 *
 * Plex and Jellyfin find a show's intro by analysing its audio. StreamHouse
 * streams files it never holds whole, so it watches what people do instead:
 * someone jumping forward over the opening of an episode by hand is skipping
 * the intro, and since a show's intro sits in the same place every episode,
 * every later episode can offer the same jump.
 *
 * No DOM here, so the tests can check it. */

const LATEST_START = 480   // an intro starts in the first eight minutes
const SHORTEST = 10        // …and lasts from ten seconds
const LONGEST = 300        // …to five minutes
const CHAIN_MS = 3000      // skips this close together are one skip

// The span a jump from `from` to `to` says is the intro, or null.
export function introSpan (from, to) {
  if (!(from >= 0 && from < LATEST_START)) return null
  const length = to - from
  if (!(length >= SHORTEST && length <= LONGEST)) return null
  return { start: Math.max(0, Math.floor(from)), end: Math.floor(to) }
}

// Whether the Skip intro button belongs on screen at `time`. It goes a few
// seconds before the end, when there is nothing left worth skipping.
export function inIntro (marker, time) {
  return Boolean(marker) && time >= marker.start - 1 && time < marker.end - 3
}

/* Collects forward jumps. Pressing +30 three times, or holding the right
 * arrow, is one skip made of several: jumps that start where the last one
 * landed, within three seconds, are joined. Anything backwards means the jump
 * overshot and was corrected, and teaches nothing. `learn` is called with the
 * span once a skip has settled. */
export function skipTracker (learn, { now = () => Date.now(), schedule = (fn, ms) => setTimeout(fn, ms), cancel = clearTimeout } = {}) {
  let pending = null
  let timer = null

  const settle = () => {
    timer = null
    const span = pending && introSpan(pending.from, pending.to)
    pending = null
    if (span) learn(span)
  }

  return {
    seek (from, to) {
      const at = now()
      if (to <= from) {
        pending = null
        if (timer) cancel(timer)
        timer = null
        return
      }
      if (pending && at - pending.at <= CHAIN_MS && Math.abs(from - pending.to) <= 2) {
        pending.to = to
        pending.at = at
      } else {
        pending = { from, to, at }
      }
      if (timer) cancel(timer)
      timer = schedule(settle, CHAIN_MS)
    },
    // Leaving the player settles whatever was in hand.
    flush () {
      if (timer) cancel(timer)
      settle()
    }
  }
}
