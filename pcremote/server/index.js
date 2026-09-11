import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from './config.js'
import { getCapabilities, disposeBackend } from './platform/index.js'
import { localAddresses } from './network.js'
import api from './routes/api.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(here, '..', 'public')

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', true)
app.use(express.json({ limit: '256kb' }))

app.use('/api', api)
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
  console.log('')
  console.log('  PC Remote is running')
  console.log('')
  if (addresses.length) {
    for (const address of addresses) console.log(`  On your phone   http://${address}:${settings.port}`)
  } else {
    console.log('  No network address found — is this machine on your network?')
  }
  console.log('')
  console.log(`  Pairing PIN     ${settings.pin}`)
  console.log('')
  console.log(`  Controlling     ${capabilities.platformName} (${capabilities.hostname})`)
  if (capabilities.note) console.log(`  Note            ${capabilities.note}`)
  console.log('')
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
