import tls from 'tls'
import makeMdns from 'multicast-dns'

/* Google Cast — what an Android TV, Google TV box or Chromecast actually
 * speaks. (Android TV has no DLNA renderer, so the UPnP path never finds one.)
 *
 * Devices announce themselves over mDNS as _googlecast._tcp, then take a TLS
 * connection on port 8009 carrying length-prefixed protobuf frames. Each frame
 * wraps a small JSON payload addressed to a namespace: connection, heartbeat,
 * receiver (launch an app) and media (load, pause, seek).
 *
 * The CastMessage schema is small enough to encode by hand, which keeps this
 * dependency-free:
 *   1 protocol_version varint | 2 source_id str | 3 destination_id str
 *   4 namespace str | 5 payload_type varint | 6 payload_utf8 str
 */

const NS_CONNECTION = 'urn:x-cast:com.google.cast.tp.connection'
const NS_HEARTBEAT = 'urn:x-cast:com.google.cast.tp.heartbeat'
const NS_RECEIVER = 'urn:x-cast:com.google.cast.receiver'
const NS_MEDIA = 'urn:x-cast:com.google.cast.media'
const DEFAULT_MEDIA_RECEIVER = 'CC1AD845'

/* ------------------------------------------------------------- protobuf */

function varint (value) {
  const out = []
  let n = value
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80)
    n >>>= 7
  }
  out.push(n)
  return Buffer.from(out)
}

function stringField (fieldNumber, text) {
  const payload = Buffer.from(String(text), 'utf8')
  return Buffer.concat([Buffer.from([(fieldNumber << 3) | 2]), varint(payload.length), payload])
}

function varintField (fieldNumber, value) {
  return Buffer.concat([Buffer.from([(fieldNumber << 3) | 0]), varint(value)])
}

export function encodeCastMessage ({ sourceId, destinationId, namespace, data }) {
  const body = Buffer.concat([
    varintField(1, 0),                       // protocol_version = CASTV2_1_0
    stringField(2, sourceId),
    stringField(3, destinationId),
    stringField(4, namespace),
    varintField(5, 0),                       // payload_type = STRING
    stringField(6, typeof data === 'string' ? data : JSON.stringify(data))
  ])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(body.length, 0)
  return Buffer.concat([length, body])
}

function readVarint (buffer, offset) {
  let result = 0
  let shift = 0
  let position = offset
  while (position < buffer.length) {
    const byte = buffer[position++]
    result |= (byte & 0x7f) << shift
    if (!(byte & 0x80)) return { value: result >>> 0, offset: position }
    shift += 7
    if (shift > 35) break
  }
  throw new Error('malformed varint in cast frame')
}

export function decodeCastMessage (body) {
  const message = {}
  let offset = 0
  while (offset < body.length) {
    const key = readVarint(body, offset)
    offset = key.offset
    const fieldNumber = key.value >>> 3
    const wireType = key.value & 7

    if (wireType === 0) {
      const value = readVarint(body, offset)
      offset = value.offset
      if (fieldNumber === 5) message.payloadType = value.value
      continue
    }
    if (wireType === 2) {
      const length = readVarint(body, offset)
      const start = length.offset
      const end = start + length.value
      const slice = body.subarray(start, end)
      offset = end
      if (fieldNumber === 2) message.sourceId = slice.toString('utf8')
      else if (fieldNumber === 3) message.destinationId = slice.toString('utf8')
      else if (fieldNumber === 4) message.namespace = slice.toString('utf8')
      else if (fieldNumber === 6) message.payload = slice.toString('utf8')
      continue
    }
    // Unknown fixed-width fields: skip so one addition upstream cannot break us.
    if (wireType === 5) { offset += 4; continue }
    if (wireType === 1) { offset += 8; continue }
    throw new Error(`unsupported wire type ${wireType} in cast frame`)
  }
  return message
}

/* ------------------------------------------------------------ discovery */

export function discoverCastDevices ({ timeout = 3500 } = {}) {
  return new Promise(resolve => {
    const found = new Map()      // service name -> partial record
    const addresses = new Map()  // hostname -> ip
    let mdns

    try {
      mdns = makeMdns()
    } catch (err) {
      console.warn('[cast] mDNS unavailable:', err.message)
      return resolve([])
    }

    const record = name => {
      if (!found.has(name)) found.set(name, { service: name })
      return found.get(name)
    }

    mdns.on('error', err => console.warn('[cast] mDNS error:', err.message))

    mdns.on('response', response => {
      for (const answer of [...(response.answers || []), ...(response.additionals || [])]) {
        if (answer.type === 'PTR' && answer.name === '_googlecast._tcp.local') {
          record(answer.data)
        } else if (answer.type === 'SRV') {
          const entry = record(answer.name)
          entry.host = answer.data?.target
          entry.port = answer.data?.port || 8009
        } else if (answer.type === 'TXT') {
          const entry = record(answer.name)
          for (const item of answer.data || []) {
            const text = Buffer.isBuffer(item) ? item.toString('utf8') : String(item)
            const index = text.indexOf('=')
            if (index < 0) continue
            const key = text.slice(0, index)
            const value = text.slice(index + 1)
            if (key === 'fn') entry.name = value          // friendly name
            else if (key === 'md') entry.model = value    // model
            else if (key === 'id') entry.deviceId = value
          }
        } else if (answer.type === 'A') {
          addresses.set(answer.name, answer.data)
        }
      }
    })

    mdns.query({ questions: [{ name: '_googlecast._tcp.local', type: 'PTR' }] })
    setTimeout(() => {
      try {
        mdns.query({ questions: [{ name: '_googlecast._tcp.local', type: 'PTR' }] })
      } catch { /* socket already closing */ }
    }, 900).unref?.()

    setTimeout(() => {
      try { mdns.destroy() } catch { /* already gone */ }
      const devices = []
      for (const entry of found.values()) {
        const address = addresses.get(entry.host) || entry.host
        if (!address) continue
        devices.push({
          id: `cast:${entry.deviceId || entry.service}`,
          protocol: 'cast',
          name: entry.name || entry.service?.split('.')[0] || 'Chromecast',
          manufacturer: 'Google Cast',
          model: entry.model || 'Cast device',
          address,
          port: entry.port || 8009
        })
      }
      resolve(devices)
    }, timeout).unref?.()
  })
}

/* --------------------------------------------------------------- client */

class CastSession {
  constructor (device) {
    this.device = device
    this.socket = null
    this.requestId = 1
    this.buffer = Buffer.alloc(0)
    this.waiting = new Map()      // requestId -> {resolve, reject, timer}
    this.transportId = null
    this.sessionId = null
    this.mediaSessionId = null
    this.heartbeat = null
    this.closed = false
  }

  connect ({ timeout = 10000 } = {}) {
    if (this.socket) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const socket = tls.connect({
        host: this.device.address,
        port: this.device.port || 8009,
        // Cast devices present a self-signed certificate; this is a LAN device
        // the user picked from a list, not a public endpoint.
        rejectUnauthorized: false,
        servername: this.device.address,
        timeout
      })

      const fail = err => {
        this.close()
        reject(new Error(`Could not reach ${this.device.name}: ${err.message}`))
      }

      socket.once('error', fail)
      socket.once('timeout', () => fail(new Error('timed out')))

      socket.on('secureConnect', () => {
        socket.removeListener('error', fail)
        socket.on('error', err => {
          console.warn(`[cast] ${this.device.name} socket error: ${err.message}`)
          this.close()
        })
        socket.on('close', () => this.close())
        this.socket = socket
        this.send(NS_CONNECTION, { type: 'CONNECT' }, 'receiver-0')
        this.heartbeat = setInterval(() => {
          this.send(NS_HEARTBEAT, { type: 'PING' }, 'receiver-0')
        }, 5000)
        this.heartbeat.unref?.()
        resolve()
      })

      socket.on('data', chunk => this.onData(chunk))
    })
  }

  onData (chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32BE(0)
      if (this.buffer.length < length + 4) break
      const body = this.buffer.subarray(4, length + 4)
      this.buffer = this.buffer.subarray(length + 4)
      try {
        this.onMessage(decodeCastMessage(body))
      } catch (err) {
        console.warn('[cast] bad frame:', err.message)
      }
    }
  }

  onMessage (message) {
    let payload
    try {
      payload = JSON.parse(message.payload || '{}')
    } catch {
      return
    }

    if (payload.type === 'PING') {
      this.send(NS_HEARTBEAT, { type: 'PONG' }, message.sourceId || 'receiver-0')
      return
    }
    if (payload.type === 'CLOSE') {
      this.transportId = null
      return
    }

    if (payload.type === 'MEDIA_STATUS' && payload.status?.length) {
      this.mediaSessionId = payload.status[0].mediaSessionId ?? this.mediaSessionId
      this.lastMediaStatus = payload.status[0]
    }
    if (payload.type === 'RECEIVER_STATUS') {
      const app = (payload.status?.applications || []).find(entry => entry.appId === DEFAULT_MEDIA_RECEIVER)
      if (app) {
        this.transportId = app.transportId
        this.sessionId = app.sessionId
      }
      this.lastVolume = payload.status?.volume
    }

    const pending = payload.requestId != null ? this.waiting.get(payload.requestId) : null
    if (pending) {
      this.waiting.delete(payload.requestId)
      clearTimeout(pending.timer)
      if (payload.type === 'LAUNCH_ERROR' || payload.type === 'INVALID_REQUEST' || payload.type === 'LOAD_FAILED') {
        pending.reject(new Error(payload.reason || payload.type))
      } else {
        pending.resolve(payload)
      }
    }
  }

  send (namespace, data, destinationId = 'receiver-0') {
    if (!this.socket || this.socket.destroyed) throw new Error('Not connected to the cast device')
    this.socket.write(encodeCastMessage({
      sourceId: 'sender-0',
      destinationId,
      namespace,
      data
    }))
  }

  // Send and wait for the reply carrying the same requestId.
  request (namespace, data, destinationId = 'receiver-0', { timeout = 12000 } = {}) {
    const requestId = this.requestId++
    const payload = { ...data, requestId }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(requestId)
        reject(new Error(`${data.type} timed out — the device did not answer`))
      }, timeout)
      timer.unref?.()
      this.waiting.set(requestId, { resolve, reject, timer })
      try {
        this.send(namespace, payload, destinationId)
      } catch (err) {
        this.waiting.delete(requestId)
        clearTimeout(timer)
        reject(err)
      }
    })
  }

  // Start the default media receiver, then join its session.
  async launch () {
    if (this.transportId) return this.transportId
    const status = await this.request(NS_RECEIVER, { type: 'LAUNCH', appId: DEFAULT_MEDIA_RECEIVER })
    const app = (status.status?.applications || []).find(entry => entry.appId === DEFAULT_MEDIA_RECEIVER)
    this.transportId = app?.transportId || this.transportId
    this.sessionId = app?.sessionId || this.sessionId
    if (!this.transportId) throw new Error('The device did not start its media receiver')
    this.send(NS_CONNECTION, { type: 'CONNECT' }, this.transportId)
    return this.transportId
  }

  async load ({ url, title, mime = 'video/mp4', subtitleUrl = null }) {
    await this.connect()
    await this.launch()
    const media = {
      contentId: url,
      contentType: mime,
      streamType: 'BUFFERED',
      metadata: { type: 0, metadataType: 0, title: title || 'StreamHouse' }
    }
    if (subtitleUrl) {
      media.tracks = [{
        trackId: 1,
        type: 'TEXT',
        trackContentId: subtitleUrl,
        trackContentType: 'text/vtt',
        subtype: 'SUBTITLES',
        name: 'Subtitles',
        language: 'en'
      }]
      media.textTrackStyle = { backgroundColor: '#00000000', foregroundColor: '#FFFFFFFF' }
    }
    const result = await this.request(NS_MEDIA, {
      type: 'LOAD',
      sessionId: this.sessionId,
      media,
      autoplay: true,
      currentTime: 0,
      ...(subtitleUrl ? { activeTrackIds: [1] } : {})
    }, this.transportId)
    this.mediaSessionId = result.status?.[0]?.mediaSessionId ?? this.mediaSessionId
    return result
  }

  async media (type, extra = {}) {
    if (!this.socket) throw new Error('Not connected to the cast device')
    if (!this.mediaSessionId) await this.status()
    if (!this.mediaSessionId) throw new Error('Nothing is playing on that device')
    return this.request(NS_MEDIA, { type, mediaSessionId: this.mediaSessionId, ...extra }, this.transportId)
  }

  async status () {
    await this.connect()
    if (!this.transportId) return { state: 'IDLE', position: 0, duration: 0 }
    const result = await this.request(NS_MEDIA, { type: 'GET_STATUS' }, this.transportId).catch(() => null)
    const status = result?.status?.[0] || this.lastMediaStatus
    if (status?.mediaSessionId) this.mediaSessionId = status.mediaSessionId
    return {
      state: status?.playerState || 'IDLE',
      position: status?.currentTime || 0,
      duration: status?.media?.duration || 0,
      title: status?.media?.metadata?.title || null
    }
  }

  async setVolume (level) {
    await this.connect()
    return this.request(NS_RECEIVER, { type: 'SET_VOLUME', volume: { level: Math.max(0, Math.min(1, level)) } })
  }

  async stop () {
    try {
      if (this.mediaSessionId) await this.media('STOP')
    } catch { /* already stopped */ }
    try {
      if (this.sessionId) await this.request(NS_RECEIVER, { type: 'STOP', sessionId: this.sessionId })
    } catch { /* receiver already idle */ }
    this.close()
  }

  close () {
    if (this.closed) return
    this.closed = true
    clearInterval(this.heartbeat)
    for (const pending of this.waiting.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Connection to the cast device closed'))
    }
    this.waiting.clear()
    try { this.socket?.destroy() } catch { /* already destroyed */ }
    this.socket = null
    this.transportId = null
    this.mediaSessionId = null
  }
}

// One live session per device, reused so the transport bar can keep controlling
// what it started.
const sessions = new Map()

export function sessionFor (device) {
  const existing = sessions.get(device.id)
  if (existing && !existing.closed) return existing
  const session = new CastSession(device)
  sessions.set(device.id, session)
  return session
}

export function closeSession (deviceId) {
  const session = sessions.get(deviceId)
  if (!session) return false
  session.close()
  sessions.delete(deviceId)
  return true
}

export function closeAllSessions () {
  for (const session of sessions.values()) session.close()
  sessions.clear()
}
