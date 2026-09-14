/* StreamHouse account server.
 *
 * A Cloudflare Worker over a D1 (SQLite) database. It keeps exactly what has to
 * follow a person between devices — library, Continue watching, the add-on list
 * and stream settings — and never touches video. Each device's StreamHouse
 * server talks to it; browsers never do, so there is no CORS here.
 *
 * Sync is last-write-wins per item. Every item carries the time it was changed
 * on the device that changed it, plus a sequence number from this server that
 * only ever goes up. A device remembers the last number it has seen, so a pull
 * is "everything after 1834" however long the device was off. Deletions stay
 * as rows with no value, so a device that was off still hears about them.
 *
 * Passwords never arrive here. The device stretches the password into a key
 * (PBKDF2, 300k rounds, salted with the email) and sends that; this server
 * salts and hashes the key again before storing it. The slow part runs on the
 * device because the free Workers plan allows 10 ms of CPU per request. */

const PAGE_SIZE = 500
// The free plan allows 50 database queries per request; authentication takes two.
const MAX_CHANGES = 40
const MAX_BODY_BYTES = 1024 * 1024
const MAX_VALUE_BYTES = 64 * 1024
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000
const KINDS = new Set(['progress', 'library', 'addons', 'setting'])
const LOCKOUT_FAILURES = 10
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000
const SEEN_EVERY_MS = 60 * 60 * 1000

class HttpError extends Error {
  constructor (status, message) {
    super(message)
    this.status = status
  }
}

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
})

export default {
  async fetch (request, env) {
    try {
      return await route(request, env)
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status)
      console.error(err.stack || err)
      return json({ error: 'The account server hit an unexpected error' }, 500)
    }
  }
}

async function route (request, env) {
  const { pathname } = new URL(request.url)
  const method = request.method

  if (method === 'GET' && pathname === '/') return json({ service: 'streamhouse-account', version: 1 })
  if (method === 'POST' && pathname === '/v1/signup') return signup(request, env)
  if (method === 'POST' && pathname === '/v1/login') return login(request, env)
  if (method === 'POST' && pathname === '/v1/logout') return logout(request, env)
  if (method === 'GET' && pathname === '/v1/me') {
    const { user } = await authenticate(request, env)
    return json({ user: publicUser(user) })
  }
  if (method === 'GET' && pathname === '/v1/sync') return pull(request, env)
  if (method === 'POST' && pathname === '/v1/sync') return push(request, env)
  throw new HttpError(404, 'Not found')
}

/* ------------------------------------------------------------------ helpers */

const encoder = new TextEncoder()

const toHex = bytes => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')

const toBase64Url = bytes => btoa(String.fromCharCode(...bytes))
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '')

async function sha256Hex (text) {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(text)))
}

async function readJson (request) {
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY_BYTES) throw new HttpError(413, 'Request too large')
  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'Request too large')
  try {
    const body = JSON.parse(text || '{}')
    if (body && typeof body === 'object') return body
  } catch { /* answered below */ }
  throw new HttpError(400, 'Expected a JSON body')
}

function credentials (body) {
  const email = String(body.email || '').trim().toLowerCase()
  const key = String(body.key || '')
  if (!/^[^\s@]+@[^\s@]+$/.test(email) || email.length > 254) throw new HttpError(400, 'Enter a valid email address')
  if (!/^[0-9a-f]{64}$/.test(key)) throw new HttpError(400, 'Update StreamHouse on this device to sign in')
  return { email, key, device: String(body.device || '').slice(0, 100) }
}

const hashKey = (salt, key) => sha256Hex(`${salt}:${key}`)

const publicUser = user => ({ email: user.email, createdAt: user.created_at })

/* ----------------------------------------------------------------- accounts */

async function signup (request, env) {
  if (String(env.ALLOW_SIGNUPS ?? 'true') !== 'true') {
    throw new HttpError(403, 'This account server is not taking new accounts')
  }
  const { email, key, device } = credentials(await readJson(request))
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)))
  const user = { id: crypto.randomUUID(), email, created_at: Date.now() }
  try {
    await env.DB.prepare('INSERT INTO users (id, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(user.id, email, await hashKey(salt, key), salt, user.created_at)
      .run()
  } catch (err) {
    if (/UNIQUE/i.test(String(err.message))) throw new HttpError(409, 'There is already an account with that email — sign in instead')
    throw err
  }
  return json({ token: await openSession(env, user.id, device), user: publicUser(user) }, 201)
}

async function login (request, env) {
  const { email, key, device } = credentials(await readJson(request))
  const now = Date.now()

  const failures = await env.DB.prepare('SELECT count, first_at FROM login_failures WHERE email = ?').bind(email).first()
  if (failures && now - failures.first_at < LOCKOUT_WINDOW_MS && failures.count >= LOCKOUT_FAILURES) {
    throw new HttpError(429, 'Too many wrong passwords — try again in 15 minutes')
  }

  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first()
  const hash = await hashKey(user?.password_salt || '', key)
  const match = Boolean(user) && crypto.subtle.timingSafeEqual(encoder.encode(hash), encoder.encode(user.password_hash))

  if (!match) {
    // Counted per email whether or not the account exists, so the lockout
    // says nothing about which emails have accounts.
    await env.DB.prepare(`
      INSERT INTO login_failures (email, count, first_at) VALUES (?1, 1, ?2)
      ON CONFLICT (email) DO UPDATE SET
        count = CASE WHEN ?2 - first_at < ?3 THEN count + 1 ELSE 1 END,
        first_at = CASE WHEN ?2 - first_at < ?3 THEN first_at ELSE ?2 END`)
      .bind(email, now, LOCKOUT_WINDOW_MS)
      .run()
    throw new HttpError(401, 'Wrong email or password')
  }

  if (failures) await env.DB.prepare('DELETE FROM login_failures WHERE email = ?').bind(email).run()
  return json({ token: await openSession(env, user.id, device), user: publicUser(user) })
}

// Tokens are random and only their hash is stored, so a copy of the database
// cannot be used to sign in as anyone.
async function openSession (env, userId, device) {
  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)))
  const now = Date.now()
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, device, created_at, last_seen) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256Hex(token), userId, device, now, now)
    .run()
  return token
}

async function authenticate (request, env) {
  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') || '')?.[1]
  if (!token) throw new HttpError(401, 'Sign in first')
  const tokenHash = await sha256Hex(token)
  const user = await env.DB.prepare(`
    SELECT sessions.last_seen, users.id, users.email, users.created_at
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ?`)
    .bind(tokenHash)
    .first()
  if (!user) throw new HttpError(401, 'This device was signed out — sign in again')

  // Worth knowing which devices are still in use, not worth a write per request.
  const now = Date.now()
  if (now - user.last_seen > SEEN_EVERY_MS) {
    await env.DB.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').bind(now, tokenHash).run()
  }
  return { user, tokenHash }
}

async function logout (request, env) {
  const { tokenHash } = await authenticate(request, env)
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run()
  return json({ ok: true })
}

/* --------------------------------------------------------------------- sync */

async function pull (request, env) {
  const { user } = await authenticate(request, env)
  const since = Math.max(0, Math.floor(Number(new URL(request.url).searchParams.get('since')) || 0))
  const { results } = await env.DB.prepare('SELECT kind, key, value, updated_at, seq FROM items WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?')
    .bind(user.id, since, PAGE_SIZE + 1)
    .all()
  const page = results.slice(0, PAGE_SIZE)
  return json({
    items: page.map(row => ({
      kind: row.kind,
      key: row.key,
      value: row.value === null ? null : JSON.parse(row.value),
      updatedAt: row.updated_at
    })),
    cursor: page.length ? page[page.length - 1].seq : since,
    more: results.length > PAGE_SIZE
  })
}

// One statement per change, in one transaction. D1 runs a database's writes
// one at a time, so MAX(seq) + 1 is always a fresh number. A change older than
// what is stored is dropped: the device that sent it hears the newer value on
// its next pull.
const UPSERT = `
  INSERT INTO items (user_id, kind, key, value, updated_at, seq)
  VALUES (?1, ?2, ?3, ?4, ?5, (SELECT COALESCE(MAX(seq), 0) + 1 FROM items WHERE user_id = ?1))
  ON CONFLICT (user_id, kind, key) DO UPDATE SET
    value = excluded.value,
    updated_at = excluded.updated_at,
    seq = excluded.seq
  WHERE excluded.updated_at > items.updated_at`

async function push (request, env) {
  const { user } = await authenticate(request, env)
  const body = await readJson(request)
  if (!Array.isArray(body.changes)) throw new HttpError(400, 'Expected { changes: [...] }')
  if (body.changes.length > MAX_CHANGES) throw new HttpError(413, `At most ${MAX_CHANGES} changes per request`)

  // A device whose clock runs fast must not win every argument for ever.
  const latest = Date.now() + MAX_CLOCK_SKEW_MS
  const seen = new Set()
  const statements = []
  body.changes.forEach((change, index) => {
    const kind = String(change?.kind || '')
    const key = String(change?.key ?? '')
    if (!KINDS.has(kind)) throw new HttpError(400, `Change ${index}: unknown kind "${kind}"`)
    if (!key || key.length > 512) throw new HttpError(400, `Change ${index}: a key is required`)
    if (seen.has(`${kind}\n${key}`)) throw new HttpError(400, `Change ${index}: ${kind} "${key}" appears twice`)
    seen.add(`${kind}\n${key}`)
    const value = change.value === null || change.value === undefined ? null : JSON.stringify(change.value)
    if (value && value.length > MAX_VALUE_BYTES) throw new HttpError(413, `Change ${index}: value too large`)
    const updatedAt = Math.min(Math.max(0, Math.floor(Number(change.updatedAt) || 0)), latest)
    statements.push(env.DB.prepare(UPSERT).bind(user.id, kind, key, value, updatedAt))
  })

  if (statements.length) await env.DB.batch(statements)
  return json({ ok: true, received: statements.length })
}
