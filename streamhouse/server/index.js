import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from './config.js'
import { engine } from './torrent.js'
import { addons } from './addons.js'
import api from './routes/api.js'
import { localAddresses, isLanReachable } from './network.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(here, '..', 'public')

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '2mb' }))

// The stream endpoint is deliberately open to the local network so a TV or a
// copy of VLC on the same machine can play from it.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range')
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges')
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, DELETE, OPTIONS')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

app.use('/api', api)
app.use(express.static(publicDir, { extensions: ['html'] }))

// Client-side routing: anything that is not an API call renders the app shell.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next()
  res.sendFile(path.join(publicDir, 'index.html'))
})

app.use((req, res) => res.status(404).json({ error: 'Not found' }))

app.use((err, req, res, next) => {
  console.error('[api]', err.message)
  if (res.headersSent) return next(err)
  res.status(err.status || 500).json({ error: err.message || 'Unexpected error' })
})

const settings = config.get()
let server = null

function start (host, port, { announce = true } = {}) {
  return new Promise((resolve, reject) => {
    const next = app.listen(port, host, () => {
      // Streaming clients hold connections open for a long time; do not cut
      // them off mid-seek with the default 2 minute timeout.
      next.headersTimeout = 0
      next.requestTimeout = 0
      next.timeout = 0
      server = next
      if (announce) banner(host, port)
      resolve(next)
    })
    next.on('error', err => {
      if (err.code === 'EADDRINUSE') {
        console.error(`Port ${port} is already in use. Change it with PORT=<port> npm start.`)
        if (!server) process.exit(1)
      }
      reject(err)
    })
  })
}

function banner (host, port) {
  const reachable = isLanReachable(host)
  console.log('')
  console.log('  StreamHouse is running')
  console.log(`  On this computer   http://127.0.0.1:${port}`)
  if (reachable) {
    for (const entry of localAddresses()) {
      console.log(`  On your network    http://${entry.address}:${port}   ← open this on your TV`)
    }
    if (!localAddresses().length) console.log('  On your network    (no network address found)')
  } else {
    console.log('  On your network    off — turn on "Allow other devices" in Settings to use a TV')
  }
  console.log(`  Downloads          ${config.get().downloadDir}`)
  console.log('')
}

// Lets Settings switch between loopback-only and the whole network live.
// Existing sockets (including the request that asked for the switch, and any
// video being streamed) must be dropped, or close() waits on them forever.
app.locals.rebind = async (host, port) => {
  const old = server
  server = null
  if (old) {
    await new Promise(resolve => {
      old.close(resolve)
      old.closeAllConnections?.()
    })
  }
  await start(host, port)
  return { host, port }
}

await start(settings.host, settings.port)
engine.start()
addons.refreshManifests()

// A malformed torrent or a dropped peer connection must never take the whole
// app down while downloads are in flight.
process.on('uncaughtException', err => {
  console.error('[fatal] uncaught exception:', err.stack || err.message)
})
process.on('unhandledRejection', reason => {
  console.error('[fatal] unhandled rejection:', reason?.stack || reason)
})

let shuttingDown = false
async function shutdown () {
  if (shuttingDown) return
  shuttingDown = true
  console.log('\nStopping StreamHouse…')
  server?.close()
  await engine.destroy()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
