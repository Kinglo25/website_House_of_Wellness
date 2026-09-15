/* Test entry point.
 *
 * The app persists to ~/.streamhouse, and importing any of its modules is
 * enough to create that directory — `paths.js` does it at import time. The
 * blocklist tests write real entries, so point the whole app at a throwaway
 * directory BEFORE anything is imported, then delete it again.
 *
 * That ordering is why this file exists separately from the suite: an ESM
 * import is hoisted above top-level code, so the environment has to be set in
 * a module that runs first and pulls the suite in dynamically.
 */

import fs from 'fs'
import os from 'os'
import path from 'path'

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'streamhouse-test-'))
process.env.STREAMHOUSE_DIR = scratch
process.env.STREAMHOUSE_DOWNLOADS = path.join(scratch, 'downloads')

let failed = 1
try {
  ({ failed } = await import('./suite.js'))
} finally {
  fs.rmSync(scratch, { recursive: true, force: true })
}

process.exit(failed ? 1 : 0)
