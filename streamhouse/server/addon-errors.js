/* Kept apart from addons.js, which opens the add-on list when imported: the
 * tests import this, and must not touch anyone's StreamHouse folder. */

// What went wrong installing an add-on, said for a person rather than a
// programmer. `fetch` and `res.json()` fail with messages like "Unexpected
// token '<'" or "Failed to parse URL", which tell nobody what to do next.
export const INSTALL_HINT = 'Add-on links usually end in manifest.json.'
export function explainInstallError (err) {
  const message = String(err?.message || err || '')
  const cause = String(err?.cause?.code || err?.cause?.message || '')
  if (/Failed to parse URL|Invalid URL/i.test(message)) return `That is not a web address. ${INSTALL_HINT}`
  if (err?.name === 'AbortError' || /aborted/i.test(message)) return 'The add-on did not answer in time. Try again in a moment.'
  if (/^HTTP 404/.test(message)) return `Nothing is at that address. Check the link — ${INSTALL_HINT.charAt(0).toLowerCase()}${INSTALL_HINT.slice(1)}`
  const status = /^HTTP (\d+)/.exec(message)
  if (status) return `The add-on's server answered with an error (${status[1]}). Try again later.`
  if (err instanceof SyntaxError || /JSON/.test(message)) return `That address is a web page, not an add-on. ${INSTALL_HINT}`
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|ECONNRESET|certificate/i.test(message + ' ' + cause)) {
    return 'Could not reach that address. Check it, and that this computer is online.'
  }
  return message || 'That add-on could not be installed.'
}
