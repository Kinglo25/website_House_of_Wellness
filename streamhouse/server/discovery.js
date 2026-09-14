import dgram from 'dgram'
import os from 'os'
import { config } from './config.js'
import { localAddresses, isLanReachable } from './network.js'

/* Lets the Android TV app find this computer without anyone typing an IP.
 *
 * The app broadcasts one small datagram to the network; every StreamHouse that
 * hears it answers with its address and port. Deliberately plain UDP rather
 * than mDNS: broadcast is far more reliable across the mix of Wi-Fi routers and
 * Android TV firmware people actually have. */

export const DISCOVERY_PORT = 11472
const PROBE = 'STREAMHOUSE_DISCOVER'

let socket = null

export function startDiscovery () {
  if (socket) return socket
  socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })

  socket.on('error', err => {
    console.warn('[discovery] disabled:', err.message)
    try { socket.close() } catch { /* already closed */ }
    socket = null
  })

  socket.on('message', (message, remote) => {
    if (!message.toString().startsWith(PROBE)) return
    const settings = config.get()
    // Listening on this machine only, nothing that asked could connect — so
    // stay out of the list rather than be picked and then fail. That includes
    // the app on a phone or TV, which runs StreamHouse for itself alone.
    if (!isLanReachable(settings.host)) return
    const reply = Buffer.from(JSON.stringify({
      app: 'streamhouse',
      name: process.env.STREAMHOUSE_DEVICE_NAME || os.hostname(),
      port: settings.port,
      addresses: localAddresses().map(entry => entry.address),
      version: 1
    }))
    socket.send(reply, remote.port, remote.address, err => {
      if (err) console.warn('[discovery] could not answer:', err.message)
    })
  })

  socket.bind(DISCOVERY_PORT, () => {
    try {
      socket.setBroadcast(true)
    } catch { /* not fatal */ }
  })
  socket.unref?.()
  return socket
}

export function stopDiscovery () {
  if (!socket) return
  try { socket.close() } catch { /* already closed */ }
  socket = null
}
