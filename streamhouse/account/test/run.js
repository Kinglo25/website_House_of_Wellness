/* Tests for the account server, against a running copy of it.
 *
 *   npm run dev     # in one terminal
 *   npm test        # in another
 *
 * Every run signs up under fresh emails, from made-up connection addresses —
 * the local server reads CF-Connecting-IP from the request, where Cloudflare
 * would set it — so it can be repeated against the same local database. */

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:8787'

const octet = () => Math.floor(Math.random() * 256)
const hextet = () => Math.floor(Math.random() * 0x10000).toString(16)
const newAddress = () => `10.${octet()}.${octet()}.${octet()}`
const home = newAddress()

let passed = 0
let failed = 0

function ok (name, condition, extra = '') {
  if (condition) {
    passed += 1
    console.log(`  PASS  ${name}${extra !== '' ? ` -> ${extra}` : ''}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${name}${extra !== '' ? ` -> ${extra}` : ''}`)
  }
}

async function call (path, { method = 'POST', body, token, raw, address = home } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'CF-Connecting-IP': address,
      ...(body !== undefined || raw !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  let data = null
  if (text) { try { data = JSON.parse(text) } catch { data = text } }
  return { status: res.status, data }
}

// Stands in for the key a device stretches from the password: 64 hex characters.
const keyFor = seed => [...seed.padEnd(32, '.')].slice(0, 32).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')

const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const email = `test-${run}@example.test`
const key = keyFor(`right ${run}`)

console.log('\nThe server')
{
  const hello = await call('/', { method: 'GET' })
  ok('answers', hello.status === 200 && hello.data?.service === 'streamhouse-account', `HTTP ${hello.status}`)
  ok('unknown paths are 404', (await call('/v1/nothing', { method: 'GET' })).status === 404)
}

console.log('\nSigning up')
let token
{
  const bad = await call('/v1/signup', { body: { email: 'not an email', key } })
  ok('a malformed email is refused', bad.status === 400, bad.data?.error)
  const oldClient = await call('/v1/signup', { body: { email, key: 'a plain password' } })
  ok('a raw password is refused, not stored', oldClient.status === 400, oldClient.data?.error)
  const notJson = await call('/v1/signup', { raw: '{nope' })
  ok('a body that is not JSON is a 400', notJson.status === 400, notJson.data?.error)

  const created = await call('/v1/signup', { body: { email: `  ${email.toUpperCase()} `, key, device: 'laptop' } })
  ok('signs up', created.status === 201 && Boolean(created.data?.token), `HTTP ${created.status}`)
  ok('the email is stored trimmed and lower-cased', created.data?.user?.email === email, created.data?.user?.email)
  token = created.data?.token

  const again = await call('/v1/signup', { body: { email, key } })
  ok('the same email cannot sign up twice', again.status === 409, again.data?.error)
}

console.log('\nSessions')
let second
{
  const me = await call('/v1/me', { method: 'GET', token })
  ok('the token identifies the account', me.status === 200 && me.data?.user?.email === email)
  ok('no token is refused', (await call('/v1/me', { method: 'GET' })).status === 401)
  ok('a made-up token is refused', (await call('/v1/me', { method: 'GET', token: 'x'.repeat(43) })).status === 401)

  const login = await call('/v1/login', { body: { email, key, device: 'tv' } })
  ok('signs in from a second device', login.status === 200 && Boolean(login.data?.token))
  second = login.data?.token
  ok('with a token of its own', second && second !== token)

  const wrong = await call('/v1/login', { body: { email, key: keyFor('wrong') } })
  ok('a wrong key is refused', wrong.status === 401, wrong.data?.error)
  const nobody = await call('/v1/login', { body: { email: `nobody-${run}@example.test`, key } })
  ok('an unknown email gets the same answer', nobody.status === 401 && nobody.data?.error === wrong.data?.error, nobody.data?.error)
}

console.log('\nSync')
{
  const empty = await call('/v1/sync', { method: 'GET', token })
  ok('a new account has nothing', empty.status === 200 && empty.data?.items?.length === 0 && empty.data?.cursor === 0)

  const now = Date.now()
  const first = await call('/v1/sync', {
    token,
    body: {
      changes: [
        { kind: 'library', key: 'movie:tt1', value: { name: 'One' }, updatedAt: now - 3000 },
        { kind: 'progress', key: 'tt1', value: { time: 60 }, updatedAt: now - 3000 },
        { kind: 'setting', key: 'streamProfile', value: 'compatible', updatedAt: now - 3000 }
      ]
    }
  })
  ok('pushes changes', first.status === 200 && first.data?.received === 3, JSON.stringify(first.data))

  const pulled = await call('/v1/sync', { method: 'GET', token: second })
  ok('the other device sees them all', pulled.data?.items?.length === 3, pulled.data?.items?.length)
  ok('values come back as they went in', pulled.data?.items?.find(i => i.key === 'movie:tt1')?.value?.name === 'One')
  const cursor = pulled.data?.cursor
  ok('with a cursor to carry on from', cursor > 0, cursor)

  const caughtUp = await call(`/v1/sync?since=${cursor}`, { method: 'GET', token: second })
  ok('nothing new after the cursor', caughtUp.data?.items?.length === 0 && caughtUp.data?.cursor === cursor)

  const stale = await call('/v1/sync', { token: second, body: { changes: [{ kind: 'progress', key: 'tt1', value: { time: 5 }, updatedAt: now - 9000 }] } })
  ok('an older edit is accepted…', stale.status === 200)
  const afterStale = await call(`/v1/sync?since=${cursor}`, { method: 'GET', token })
  ok('…but does not replace the newer one', afterStale.data?.items?.length === 0)

  const newer = await call('/v1/sync', { token: second, body: { changes: [{ kind: 'progress', key: 'tt1', value: { time: 120 }, updatedAt: now - 1000 }] } })
  ok('a newer edit is accepted', newer.status === 200)
  const afterNewer = await call(`/v1/sync?since=${cursor}`, { method: 'GET', token })
  ok('and is the one the first device hears', afterNewer.data?.items?.length === 1 && afterNewer.data.items[0].value?.time === 120,
    JSON.stringify(afterNewer.data?.items))

  const gone = await call('/v1/sync', { token, body: { changes: [{ kind: 'library', key: 'movie:tt1', value: null, updatedAt: now }] } })
  ok('a deletion is pushed', gone.status === 200)
  const afterGone = await call(`/v1/sync?since=${afterNewer.data?.cursor}`, { method: 'GET', token: second })
  ok('and heard by a device that was away', afterGone.data?.items?.length === 1 && afterGone.data.items[0].value === null)

  const future = await call('/v1/sync', { token, body: { changes: [{ kind: 'setting', key: 'clock', value: 1, updatedAt: now + 365 * 864e5 }] } })
  ok('a fast clock is accepted', future.status === 200)
  const clamped = await call(`/v1/sync?since=${afterGone.data?.cursor}`, { method: 'GET', token })
  ok('but its date is held to a few minutes ahead', clamped.data?.items?.[0]?.updatedAt <= Date.now() + 5 * 60 * 1000 + 1000,
    clamped.data?.items?.[0]?.updatedAt - Date.now())

  const unknown = await call('/v1/sync', { token, body: { changes: [{ kind: 'passwords', key: 'x', value: 1 }] } })
  ok('an unknown kind is refused', unknown.status === 400, unknown.data?.error)
  const twice = await call('/v1/sync', { token, body: { changes: [{ kind: 'setting', key: 'a', value: 1 }, { kind: 'setting', key: 'a', value: 2 }] } })
  ok('the same item twice in one push is refused', twice.status === 400, twice.data?.error)
  const many = await call('/v1/sync', { token, body: { changes: Array.from({ length: 41 }, (_, i) => ({ kind: 'setting', key: `k${i}`, value: i })) } })
  ok('more than 40 changes at once is refused', many.status === 413, many.data?.error)
  const huge = await call('/v1/sync', { token, body: { changes: [{ kind: 'setting', key: 'big', value: 'x'.repeat(70 * 1024) }] } })
  ok('an oversized value is refused', huge.status === 413, huge.data?.error)
  const shape = await call('/v1/sync', { token, body: { nothing: true } })
  ok('a push with no changes list is refused', shape.status === 400, shape.data?.error)
}

console.log('\nAccounts are kept apart')
{
  const otherEmail = `other-${run}@example.test`
  const other = await call('/v1/signup', { body: { email: otherEmail, key: keyFor(`other ${run}`) } })
  const theirs = await call('/v1/sync', { method: 'GET', token: other.data?.token })
  ok('another account sees none of this one', theirs.status === 200 && theirs.data?.items?.length === 0, theirs.data?.items?.length)
}

console.log('\nPaging')
{
  // 501 items: one more than a page, so the second page has exactly one.
  const now = Date.now()
  for (let start = 0; start < 501; start += 40) {
    const changes = []
    for (let i = start; i < Math.min(start + 40, 501); i += 1) changes.push({ kind: 'progress', key: `page-${i}`, value: i, updatedAt: now })
    await call('/v1/sync', { token, body: { changes } })
  }
  let since = 0
  let pages = 0
  const keys = new Set()
  for (;;) {
    const page = await call(`/v1/sync?since=${since}`, { method: 'GET', token: second })
    pages += 1
    for (const item of page.data.items) keys.add(`${item.kind}:${item.key}`)
    since = page.data.cursor
    if (!page.data.more) break
  }
  ok('a long history comes in pages', pages === 2, `${pages} pages`)
  ok('and nothing is lost between them', [...Array(501).keys()].every(i => keys.has(`progress:page-${i}`)), `${keys.size} items`)
}

console.log('\nSigning out')
{
  const out = await call('/v1/logout', { token: second })
  ok('signs out', out.status === 200)
  ok('that token no longer works', (await call('/v1/me', { method: 'GET', token: second })).status === 401)
  ok('the other device stays signed in', (await call('/v1/me', { method: 'GET', token })).status === 200)
}

console.log('\nSign-ups per connection')
{
  const from = newAddress()
  const statuses = []
  for (let i = 0; i < 6; i += 1) {
    statuses.push((await call('/v1/signup', { address: from, body: { email: `limit-${i}-${run}@example.test`, key } })).status)
  }
  ok('five accounts an hour from one connection, then refused', statuses.slice(0, 5).every(s => s === 201) && statuses[5] === 429,
    statuses.join(','))
  const elsewhere = await call('/v1/signup', { address: newAddress(), body: { email: `elsewhere-${run}@example.test`, key } })
  ok('another connection is not held up', elsewhere.status === 201, `HTTP ${elsewhere.status}`)

  // Written six ways, all in one /64.
  const [a, b] = [hextet(), hextet()]
  const sameHome = [`2001:db8:${a}:${b}::1`, `2001:0DB8:${a}:${b}:0:0:0:2`, `2001:db8:${a}:${b}:ffff::3`,
    `2001:db8:${a}:${b}:1:2:3:4`, `2001:db8:${a}:${b}::5`, `2001:db8:${a}:${b}:aaaa:bbbb:cccc:dddd`]
  const v6 = []
  for (const [i, address] of sameHome.entries()) {
    v6.push((await call('/v1/signup', { address, body: { email: `v6-${i}-${run}@example.test`, key } })).status)
  }
  ok('an IPv6 connection counts by its /64', v6.slice(0, 5).every(s => s === 201) && v6[5] === 429, v6.join(','))
  const nextB = ((parseInt(b, 16) + 1) % 0x10000).toString(16)
  const nextDoor = await call('/v1/signup', { address: `2001:db8:${a}:${nextB}::1`, body: { email: `v6-next-${run}@example.test`, key } })
  ok('the next /64 is another connection', nextDoor.status === 201, `HTTP ${nextDoor.status}`)
}

console.log('\nA full account')
{
  const made = await call('/v1/signup', { address: newAddress(), body: { email: `full-${run}@example.test`, key } })
  const fullToken = made.data?.token
  const now = Date.now()
  // Fifteen values just under the 64 KB limit fit in one push under the 1 MB
  // body limit; six such pushes pass the 5 MB an account may keep.
  const chunk = 'x'.repeat(62 * 1024)
  const statuses = []
  for (let push = 0; push < 7; push += 1) {
    const changes = Array.from({ length: 15 }, (_, i) => ({ kind: 'library', key: `big-${push}-${i}`, value: chunk, updatedAt: now }))
    statuses.push((await call('/v1/sync', { token: fullToken, body: { changes } })).status)
  }
  ok('fills up, then takes nothing more', statuses.slice(0, 6).every(s => s === 200) && statuses[6] === 413, statuses.join(','))

  const { cursor } = (await call('/v1/sync', { method: 'GET', token: fullToken })).data
  const freed = await call('/v1/sync', {
    token: fullToken,
    body: {
      changes: [
        ...Array.from({ length: 15 }, (_, i) => ({ kind: 'library', key: `big-0-${i}`, value: null, updatedAt: now + 1 })),
        { kind: 'library', key: 'never-stored', value: null, updatedAt: now + 1 }
      ]
    }
  })
  ok('a full account can still delete', freed.status === 200, freed.data?.error)
  const heard = await call(`/v1/sync?since=${cursor}`, { method: 'GET', token: fullToken })
  ok('its deletions are heard, and nothing new is stored', heard.data?.items?.length === 15 && heard.data.items.every(i => i.value === null),
    heard.data?.items?.map(i => i.key).join(' '))
  const room = await call('/v1/sync', { token: fullToken, body: { changes: [{ kind: 'setting', key: 'after', value: 1, updatedAt: now + 2 }] } })
  ok('with room again, it takes more', room.status === 200, room.data?.error)
}

console.log('\nDeleting an account')
{
  const address = newAddress()
  const goneEmail = `gone-${run}@example.test`
  const goneKey = keyFor(`gone ${run}`)
  const made = await call('/v1/signup', { address, body: { email: goneEmail, key: goneKey } })
  const goneToken = made.data?.token
  const otherDevice = (await call('/v1/login', { body: { email: goneEmail, key: goneKey } })).data?.token
  await call('/v1/sync', { token: goneToken, body: { changes: [{ kind: 'setting', key: 'x', value: 1, updatedAt: Date.now() }] } })

  const wrong = await call('/v1/account/delete', { token: goneToken, body: { key: keyFor('wrong') } })
  const stillThere = await call('/v1/me', { method: 'GET', token: goneToken })
  ok('a wrong password deletes nothing', wrong.status === 401 && stillThere.status === 200, wrong.data?.error)
  const noDevice = await call('/v1/account/delete', { body: { key: goneKey } })
  ok('nor does the password without a signed-in device', noDevice.status === 401, noDevice.data?.error)

  const deleted = await call('/v1/account/delete', { token: goneToken, body: { key: goneKey } })
  ok('the password deletes it', deleted.status === 200, deleted.data?.error)
  const both = [goneToken, otherDevice].map(t => call('/v1/me', { method: 'GET', token: t }))
  ok('every device is signed out', (await Promise.all(both)).every(r => r.status === 401))
  ok('the password no longer signs in', (await call('/v1/login', { body: { email: goneEmail, key: goneKey } })).status === 401)
  const fresh = await call('/v1/signup', { address, body: { email: goneEmail, key: goneKey } })
  const nothing = await call('/v1/sync', { method: 'GET', token: fresh.data?.token })
  ok('the email can sign up again, with nothing left over', fresh.status === 201 && nothing.data?.items?.length === 0,
    `HTTP ${fresh.status}, ${nothing.data?.items?.length} items`)
}

console.log('\nWrong-password lockout')
{
  // One wrong key was already tried under Sessions, so the ninth here is the tenth.
  const statuses = []
  for (let i = 0; i < 10; i += 1) statuses.push((await call('/v1/login', { body: { email, key: keyFor(`guess ${i}`) } })).status)
  ok('ten wrong keys, then locked out', statuses.slice(0, 9).every(s => s === 401) && statuses[9] === 429, statuses.join(','))
  const right = await call('/v1/login', { body: { email, key } })
  ok('even the right key waits out the lockout', right.status === 429, `HTTP ${right.status}`)
}

console.log(`\n  ${passed} passed, ${failed} failed\n`)
process.exitCode = failed ? 1 : 0
