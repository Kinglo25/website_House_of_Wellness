import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from './config.js'
import { getCapabilities, disposeBackend } from './platform/index.js'
import { localAddresses } from './network.js'
import { detectHost, printHostWarning, describeAddresses, firewallHint } from './environment.js'
import api from './routes/api.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(here, '..', 'public')

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', true)
app.use(express.json({ limit: '256kb' }))

app.use('/api', api)

// Serve the manifest with its proper type; browsers ignore it otherwise, and
// "Add to Home Screen" then falls back to a plain bookmark.
app.get('/manifest.webmanifest', (req, res) => {
  res.type('application/manifest+json')
  res.sendFile(path.join(publicDir, 'manifest.webmanifest'))
})

app.use(express.static(publicDir, { extensions: ['html'] }))
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next()
  res.sendFile(path.join(publicDir, 'index.html'))
})

app.use((err, req, res, next) => {
  console.error('[api]', err.message)
  if (res.headersSent) return next(err)
  res.status(err.status || 500).json({ error: err.message || 'Unexpected error' })
})

const settings = config.get()
const server = app.listen(settings.port, settings.host, async () => {
  const capabilities = await getCapabilities()
  const addresses = localAddresses()
  const host = detectHost({ addresses: addresses.map(entry => entry.address) })
  console.log('')
  console.log('  PC Remote is running')
  console.log('')
  // Say up front when the address below cannot work, rather than letting
  // someone type it into a phone and get a timeout.
  printHostWarning(host, { controlsDesktop: true })
  for (const line of describeAddresses(addresses, settings.port, '  On your phone   ')) console.log(line)
  console.log('')
  console.log(`  Pairing PIN     ${settings.pin}`)
  console.log('')
  console.log(`  Controlling     ${capabilities.platformName} (${capabilities.hostname})`)
  if (capabilities.note) console.log(`  Note            ${capabilities.note}`)
  console.log('')
  for (const line of firewallHint(settings.port, 'PC Remote')) console.log(`  ${line}`)
  if (process.platform === 'win32') console.log('')
})

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${settings.port} is already in use. Change it with PORT=<port> npm start.`)
    process.exit(1)
  }
  throw err
})

process.on('uncaughtException', err => console.error('[fatal]', err.stack || err.message))
process.on('unhandledRejection', reason => console.error('[fatal]', reason?.stack || reason))

let stopping = false
function shutdown () {
  if (stopping) return
  stopping = true
  console.log('\nStopping PC Remote…')
  server.close()
  disposeBackend()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
