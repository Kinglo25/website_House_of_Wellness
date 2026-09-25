import crypto from 'crypto'
import os from 'os'
import { JsonStore } from './store.js'
import { config, SYNCED_SETTINGS } from './config.js'
import { addons } from './addons.js'
import { library, progress, viewers } from './history.js'
import { scopeKey } from './viewers.js'
import { fingerprint, localChanges, remoteWins } from './merge.js'

/* Account sync: the library, Continue watching, add-ons and stream settings
 * follow an account between devices, through the account server in ../account.
 * Films never do — each device fetches its own.
 *
 * Each item syncs on its own and the most recent edit wins. The server numbers
 * every change it stores, and this device remembers the last number it has
 * seen, so a pull is "everything after 1834" however long the device was off.
 *
 * What was last agreed with the server is kept as a fingerprint per item.
 * Anything whose value no longer matches its fingerprint was edited here and
 * gets pushed — which catches every edit, whichever part of the app made it. */

export const DEFAULT_SERVER = process.env.STREAMHOUSE_ACCOUNT_SERVER || 'https://streamhouse-account.streamhouse-account.workers.dev'

const KEY_ITERATIONS = 300000
const PUSH_BATCH = 40          // the account server takes at most 40 changes per request
const PULL_EVERY_MS = 60 * 1000
const PUSH_AFTER_MS = 3000     // an edit goes up this soon after it happens…
const PUSH_GAP_MS = 15000      // …but no more often than this while playback writes progress
const FRESH_MS = 15000
const REQUEST_TIMEOUT_MS = 15000

/* ------------------------------------------------------------ what syncs */

// Each kind as a map of key → value, and how to write one back. `stamp` is when
// an item says it was last changed, for kinds whose items record that.
const KINDS = {
  progress: {
    store: () => progress,
    read: () => progress.get(),
    write: map => progress.set(map),
    stamp: entry => entry?.updatedAt || 0,
    deletable: true
  },
  library: {
    store: () => library,
    // Keyed per profile, as progress is: two profiles can save the same film.
    read: () => Object.fromEntries(library.get().map(item => [scopeKey(item.viewer, item.id), item])),
    write: map => library.set(Object.values(map).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))),
    stamp: item => item?.addedAt || 0,
    deletable: true
  },
  // One item: the list itself, since its order matters. Manifests stay local.
  addons: {
    store: () => addons.store,
    read: () => ({ list: addons.list().map(addon => ({ transportUrl: addon.transportUrl, enabled: addon.enabled !== false })) }),
    write: map => addons.replaceList(map.list || []),
    stamp: () => 0,
    deletable: false
  },
  setting: {
    store: () => config.store,
    // The profile list travels as one more setting. A device that does not
    // know profiles ignores it, as it ignores any setting it does not have.
    stores: () => [config.store, viewers.store],
    read: () => ({ ...Object.fromEntries(SYNCED_SETTINGS.map(key => [key, config.get()[key]])), viewers: viewers.list() }),
    write: map => {
      const { viewers: list, ...settings } = map
      config.update(settings)
      if (list) viewers.replace(list)
    },
    stamp: () => 0,
    deletable: false
  }
}

// The password never leaves this device. The server gets a key stretched from
// it here — slow on purpose, and salted with the email so one password makes a
// different key for every account — and hashes that again before storing it.
function deriveKey (password, email) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(String(password), `streamhouse-account:${email}`, KEY_ITERATIONS, 32, 'sha256', (err, key) => {
      if (err) reject(err)
      else resolve(key.toString('hex'))
    })
  })
}

const failure = (status, message) => Object.assign(new Error(message), { status })

const SIGNED_OUT = { server: null, email: null, token: null, cursor: 0, snapshot: {}, changedAt: {}, lastSync: null, lastError: null }

/* ------------------------------------------------------------------ sync */

class AccountSync {
  constructor () {
    this.store = new JsonStore('account', SIGNED_OUT)
    this.running = null
    this.again = false
    this.applying = false
    this.pushTimer = null
    this.pushDue = 0
    this.pullTimer = null
    this.lastRunAt = 0
    this.lastLogged = null

    // What each kind looked like the last time it was seen, so a store saving
    // something that does not sync (a manifest refresh, a port change) is not
    // mistaken for an edit.
    this.seen = {}
    for (const [kind, adapter] of Object.entries(KINDS)) {
      this.seen[kind] = fingerprint(adapter.read())
      for (const store of adapter.stores ? adapter.stores() : [adapter.store()]) store.onChange(() => this.noticeEdit(kind))
    }
  }

  get state () {
    const state = this.store.get()
    state.snapshot ||= {}
    state.changedAt ||= {}
    return state
  }

  get signedIn () {
    return Boolean(this.state.token)
  }

  status () {
    const { email, server, lastSync, lastError } = this.state
    return {
      signedIn: this.signedIn,
      email,
      server: server || DEFAULT_SERVER,
      lastSync,
      lastError,
      syncing: Boolean(this.running)
    }
  }

  start () {
    if (this.pullTimer) return
    this.pullTimer = setInterval(() => {
      if (this.signedIn) this.sync()
    }, PULL_EVERY_MS)
    this.pullTimer.unref?.()
    if (this.signedIn) this.sync()
  }

  noticeEdit (kind) {
    if (this.applying) return
    const print = fingerprint(KINDS[kind].read())
    if (print === this.seen[kind]) return
    this.seen[kind] = print
    if (!this.signedIn) return
    this.state.changedAt[kind] = Date.now()
    this.store.save()
    this.schedulePush(kind)
  }

  // An edit goes up a few seconds after it happens. Playback saves progress
  // every few seconds for as long as a film runs, so progress alone also waits
  // for a gap since the last sync.
  schedulePush (kind) {
    const now = Date.now()
    const due = kind === 'progress'
      ? Math.max(now + PUSH_AFTER_MS, this.lastRunAt + PUSH_GAP_MS)
      : now + PUSH_AFTER_MS
    if (this.pushTimer && this.pushDue <= due) return
    clearTimeout(this.pushTimer)
    this.pushDue = due
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null
      this.sync()
    }, due - now)
    this.pushTimer.unref?.()
  }

  // Never throws: the outcome is in the returned status. Calls made while a
  // sync is running get one more pass once it ends, so no edit is left waiting.
  sync () {
    if (!this.signedIn) return Promise.resolve(this.status())
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = (async () => {
      do {
        this.again = false
        await this.run()
      } while (this.again && this.signedIn)
    })()
      .finally(() => { this.running = null })
      .then(() => this.status())
    return this.running
  }

  async run () {
    this.lastRunAt = Date.now()
    try {
      await this.pull()
      await this.push()
      Object.assign(this.state, { lastSync: Date.now(), lastError: null })
      this.lastLogged = null
    } catch (err) {
      if (err.status === 401) {
        this.forget('This device was signed out — sign in again')
      } else {
        this.state.lastError = err.message
      }
      if (this.state.lastError && this.state.lastError !== this.lastLogged) {
        console.warn(`[account] sync failed: ${this.state.lastError}`)
        this.lastLogged = this.state.lastError
      }
    }
    this.store.save()
  }

  // Before showing Continue watching or the library, catch up with whatever
  // another device did — but never keep the page waiting on a slow network.
  async fresh (waitMs = 1500) {
    if (!this.signedIn || Date.now() - this.lastRunAt < FRESH_MS) return
    await Promise.race([this.sync(), new Promise(resolve => setTimeout(resolve, waitMs).unref?.())])
  }

  // On the way out, send what has not been sent yet.
  async flush (waitMs = 3000) {
    clearTimeout(this.pushTimer)
    this.pushTimer = null
    if (!this.signedIn) return
    await Promise.race([this.sync(), new Promise(resolve => setTimeout(resolve, waitMs).unref?.())])
  }

  async request (method, path, body = null, { token = this.state.token, server = this.state.server } = {}) {
    let res
    try {
      res = await fetch(new URL(path, server), {
        method,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
    } catch (err) {
      const reason = err.name === 'TimeoutError' ? 'timed out' : err.cause?.code || err.message
      throw failure(502, `Could not reach the account server (${reason})`)
    }
    const data = await res.json().catch(() => null)
    if (!res.ok) throw failure(res.status, data?.error || `The account server answered ${res.status}`)
    return data
  }

  async pull () {
    let more = true
    while (more && this.signedIn) {
      const page = await this.request('GET', `/v1/sync?since=${this.state.cursor || 0}`)
      this.applyRemote(page.items || [])
      this.state.cursor = page.cursor
      more = Boolean(page.more)
      this.store.save()
    }
  }

  applyRemote (items) {
    const state = this.state
    const byKind = new Map()
    for (const item of items) {
      if (!KINDS[item.kind]) continue
      if (!byKind.has(item.kind)) byKind.set(item.kind, [])
      byKind.get(item.kind).push(item)
    }

    for (const [kind, list] of byKind) {
      const adapter = KINDS[kind]
      const current = { ...adapter.read() }
      const agreed = (state.snapshot[kind] ||= {})
      let dirty = false

      for (const remote of list) {
        if (remote.value === null && !adapter.deletable) continue
        const local = current[remote.key] ?? null
        if (!remoteWins({ remote, local, agreed: agreed[remote.key], stamp: adapter.stamp, changedAt: state.changedAt[kind] || 0 })) continue
        agreed[remote.key] = fingerprint(remote.value)
        if (fingerprint(local) === agreed[remote.key]) continue
        if (remote.value === null) delete current[remote.key]
        else current[remote.key] = remote.value
        dirty = true
      }

      if (!dirty) continue
      this.applying = true
      try {
        adapter.write(current)
      } finally {
        this.applying = false
      }
      this.seen[kind] = fingerprint(adapter.read())
    }
  }

  async push () {
    const state = this.state
    const changes = Object.entries(KINDS).flatMap(([kind, adapter]) => localChanges({
      kind,
      current: adapter.read(),
      agreed: state.snapshot[kind] || {},
      stamp: adapter.stamp,
      changedAt: state.changedAt[kind] || 0,
      deletable: adapter.deletable
    }))

    for (let index = 0; index < changes.length && this.signedIn; index += PUSH_BATCH) {
      const batch = changes.slice(index, index + PUSH_BATCH)
      await this.request('POST', '/v1/sync', { changes: batch })
      for (const change of batch) (state.snapshot[change.kind] ||= {})[change.key] = fingerprint(change.value)
      this.store.save()
    }
  }

  // A device's first sync merges: its own history and the account's both
  // survive, the newer edit of each item winning. Settings and add-ons carry
  // no dates of their own, so there the account's copy wins.
  async signIn ({ mode, email, password, server = DEFAULT_SERVER }) {
    email = String(email || '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw failure(400, 'Enter your email address')
    if (String(password || '').length < 8) throw failure(400, 'Passwords need at least 8 characters')

    const key = await deriveKey(password, email)
    const answer = await this.request('POST', mode === 'signup' ? '/v1/signup' : '/v1/login', {
      email,
      key,
      // Android reports "localhost" as its hostname; the app passes the real name.
      device: process.env.STREAMHOUSE_DEVICE_NAME || os.hostname()
    }, { token: null, server })

    this.store.set({ ...SIGNED_OUT, server, email: answer.user.email, token: answer.token })
    return this.sync()
  }

  // Everything already on this device stays; it just stops syncing.
  async signOut () {
    const { token, server } = this.state
    this.forget(null)
    if (token) await this.request('POST', '/v1/logout', null, { token, server }).catch(() => {})
    return this.status()
  }

  forget (reason) {
    clearTimeout(this.pushTimer)
    this.pushTimer = null
    this.store.set({ ...SIGNED_OUT, lastError: reason })
  }
}

export const account = new AccountSync()
