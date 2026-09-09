import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from './config.js'
import { engine } from './torrent.js'
import { addons } from './addons.js'
import api from './routes/api.js'

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
const server = app.listen(settings.port, settings.host, () => {
  engine.start()
  addons.refreshManifests()
  console.log('')
  console.log('  StreamHouse is running')
  console.log(`  UI          http://${settings.host}:${settings.port}`)
  console.log(`  Downloads   ${settings.downloadDir}`)
  console.log('')
})

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${settings.port} is already in use. Change it with PORT=<port> npm start.`)
    process.exit(1)
  }
  throw err
})

// Streaming clients hold connections open for a long time; do not cut them off
// mid-seek with the default 2 minute timeout.
server.headersTimeout = 0
server.requestTimeout = 0
server.timeout = 0

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
  server.close()
  await engine.destroy()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
