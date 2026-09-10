import dgram from 'dgram'
import { URL } from 'url'

// Casting over DLNA / UPnP AVTransport — the protocol virtually every smart TV
// (Samsung, LG, Sony, Philips) and every media box speaks out of the box.
//
//   1. shout an SSDP M-SEARCH onto the local network
//   2. fetch each responder's description XML to learn its name and control URL
//   3. POST SOAP actions (SetAVTransportURI, Play, Pause, Seek…) to that URL
//
// The TV then pulls the video straight from this server, so the file streams to
// the TV even while it is still downloading.

const SSDP_ADDRESS = '239.255.255.250'
const SSDP_PORT = 1900
const AV_TRANSPORT = 'urn:schemas-upnp-org:service:AVTransport:1'
const RENDERING_CONTROL = 'urn:schemas-upnp-org:service:RenderingControl:1'
const MEDIA_RENDERER = 'urn:schemas-upnp-org:device:MediaRenderer:1'

const devices = new Map()
let lastScan = 0

function xmlEscape (value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  }[ch]))
}

function tag (xml, name) {
  const match = new RegExp(`<(?:[a-z0-9]+:)?${name}[^>]*>([\\s\\S]*?)</(?:[a-z0-9]+:)?${name}>`, 'i').exec(xml || '')
  return match ? match[1].trim() : null
}

// Pull the control URL of one service out of a device description document.
function serviceControlUrl (xml, serviceType) {
  const blocks = xml.match(/<service>[\s\S]*?<\/service>/gi) || []
  for (const block of blocks) {
    if ((tag(block, 'serviceType') || '').toLowerCase() === serviceType.toLowerCase()) {
      return tag(block, 'controlURL')
    }
  }
  return null
}

async function describe (location) {
  const res = await fetch(location, { signal: AbortSignal.timeout(6000) })
  if (!res.ok) throw new Error(`description fetch failed (${res.status})`)
  const xml = await res.text()
  const control = serviceControlUrl(xml, AV_TRANSPORT)
  if (!control) return null                       // not a renderer we can drive
  const base = tag(xml, 'URLBase') || location
  return {
    id: Buffer.from(location).toString('base64url').slice(0, 32),
    name: tag(xml, 'friendlyName') || 'Media renderer',
    manufacturer: tag(xml, 'manufacturer') || '',
    model: tag(xml, 'modelName') || '',
    location,
    controlUrl: new URL(control, base).toString(),
    volumeUrl: (() => {
      const rendering = serviceControlUrl(xml, RENDERING_CONTROL)
      return rendering ? new URL(rendering, base).toString() : null
    })(),
    seenAt: Date.now()
  }
}

// Broadcast an M-SEARCH and collect whatever answers within the timeout.
export function discover ({ timeout = 3000 } = {}) {
  return new Promise(resolve => {
    const found = new Map()
    let socket
    try {
      socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    } catch (err) {
      console.warn('[cast] could not open SSDP socket:', err.message)
      return resolve([])
    }

    const pending = []

    socket.on('message', message => {
      const text = message.toString()
      if (!/HTTP\/1\.1 200 OK/i.test(text)) return
      const location = /LOCATION:\s*(\S+)/i.exec(text)?.[1]
      if (!location || found.has(location)) return
      found.set(location, true)
      pending.push(
        describe(location)
          .then(device => {
            if (device) devices.set(device.id, device)
          })
          .catch(err => console.warn(`[cast] ${location}: ${err.message}`))
      )
    })

    socket.on('error', err => {
      console.warn('[cast] SSDP error:', err.message)
      try { socket.close() } catch { /* already closed */ }
      resolve([...devices.values()])
    })

    socket.bind(() => {
      try {
        socket.setBroadcast(true)
      } catch { /* not fatal */ }
      const query = [
        'M-SEARCH * HTTP/1.1',
        `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
        'MAN: "ssdp:discover"',
        'MX: 2',
        `ST: ${MEDIA_RENDERER}`,
        '', ''
      ].join('\r\n')
      // Sent a few times: SSDP is UDP, and TVs miss the odd packet.
      for (const delay of [0, 400, 900]) {
        setTimeout(() => {
          try {
            socket.send(query, SSDP_PORT, SSDP_ADDRESS)
          } catch { /* interface went away */ }
        }, delay).unref?.()
      }
    })

    setTimeout(async () => {
      try { socket.close() } catch { /* already closed */ }
      await Promise.allSettled(pending)
      lastScan = Date.now()
      resolve([...devices.values()])
    }, timeout).unref?.()
  })
}

export async function listDevices ({ refresh = false } = {}) {
  if (refresh || !devices.size || Date.now() - lastScan > 60000) await discover({})
  return [...devices.values()]
}

// Some TVs answer SSDP unreliably, or sit on a different subnet. Pointing
// straight at a device description URL always works.
export async function addManual (location) {
  const url = String(location || '').trim()
  if (!/^https?:\/\//i.test(url)) throw new Error('Enter the full device description URL, e.g. http://192.168.1.20:8080/description.xml')
  const device = await describe(url)
  if (!device) throw new Error('That URL is reachable but does not expose an AVTransport service')
  devices.set(device.id, device)
  return device
}

export function forgetDevice (id) {
  return devices.delete(id)
}

export function getDevice (id) {
  return devices.get(id) || null
}

async function soap (url, serviceType, action, args = {}) {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
 <s:Body>
  <u:${action} xmlns:u="${serviceType}">
${Object.entries(args).map(([key, value]) => `   <${key}>${xmlEscape(value)}</${key}>`).join('\n')}
  </u:${action}>
 </s:Body>
</s:Envelope>`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      SOAPACTION: `"${serviceType}#${action}"`,
      Connection: 'close'
    },
    body,
    signal: AbortSignal.timeout(10000)
  })
  const text = await res.text()
  if (!res.ok) {
    const reason = tag(text, 'errorDescription') || tag(text, 'faultstring') || `HTTP ${res.status}`
    throw new Error(`${action} rejected by the device: ${reason}`)
  }
  return text
}

// DIDL-Lite is the metadata envelope DLNA renderers expect; without it many TVs
// show "unknown" or refuse the stream outright.
function didl ({ url, title, mime = 'video/mp4', subtitleUrl = null, duration = null }) {
  const upnpClass = mime.startsWith('audio') ? 'object.item.audioItem.musicTrack' : 'object.item.videoItem'
  const protocolInfo = `http-get:*:${mime}:DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000`
  const subtitle = subtitleUrl
    ? `<res protocolInfo="http-get:*:text/srt:*">${xmlEscape(subtitleUrl)}</res>` +
      `<sec:CaptionInfoEx sec:type="srt">${xmlEscape(subtitleUrl)}</sec:CaptionInfoEx>`
    : ''
  return `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:sec="http://www.sec.co.kr/">` +
    `<item id="1" parentID="0" restricted="1">` +
    `<dc:title>${xmlEscape(title || 'StreamHouse')}</dc:title>` +
    `<upnp:class>${upnpClass}</upnp:class>` +
    `<res protocolInfo="${protocolInfo}"${duration ? ` duration="${duration}"` : ''}>${xmlEscape(url)}</res>` +
    subtitle +
    `</item></DIDL-Lite>`
}

export async function play (deviceId, { url, title, mime, subtitleUrl }) {
  const device = getDevice(deviceId)
  if (!device) throw new Error('That device is no longer on the network — scan again')

  // Stop first: a renderer already playing often ignores SetAVTransportURI.
  await soap(device.controlUrl, AV_TRANSPORT, 'Stop', { InstanceID: 0 }).catch(() => {})
  await soap(device.controlUrl, AV_TRANSPORT, 'SetAVTransportURI', {
    InstanceID: 0,
    CurrentURI: url,
    CurrentURIMetaData: didl({ url, title, mime, subtitleUrl })
  })
  await soap(device.controlUrl, AV_TRANSPORT, 'Play', { InstanceID: 0, Speed: 1 })
  device.nowPlaying = { url, title, startedAt: Date.now() }
  return { device: device.name, title }
}

export async function control (deviceId, action, value = null) {
  const device = getDevice(deviceId)
  if (!device) throw new Error('That device is no longer on the network — scan again')

  switch (action) {
    case 'pause':
      return soap(device.controlUrl, AV_TRANSPORT, 'Pause', { InstanceID: 0 })
    case 'resume':
      return soap(device.controlUrl, AV_TRANSPORT, 'Play', { InstanceID: 0, Speed: 1 })
    case 'stop':
      device.nowPlaying = null
      return soap(device.controlUrl, AV_TRANSPORT, 'Stop', { InstanceID: 0 })
    case 'seek':
      return soap(device.controlUrl, AV_TRANSPORT, 'Seek', {
        InstanceID: 0,
        Unit: 'REL_TIME',
        Target: hms(value)
      })
    case 'volume':
      if (!device.volumeUrl) throw new Error('This device does not expose volume control')
      return soap(device.volumeUrl, RENDERING_CONTROL, 'SetVolume', {
        InstanceID: 0,
        Channel: 'Master',
        DesiredVolume: Math.max(0, Math.min(100, Math.round(Number(value))))
      })
    default:
      throw new Error(`Unknown cast action: ${action}`)
  }
}

export async function status (deviceId) {
  const device = getDevice(deviceId)
  if (!device) throw new Error('That device is no longer on the network — scan again')
  const [position, transport] = await Promise.all([
    soap(device.controlUrl, AV_TRANSPORT, 'GetPositionInfo', { InstanceID: 0 }).catch(() => ''),
    soap(device.controlUrl, AV_TRANSPORT, 'GetTransportInfo', { InstanceID: 0 }).catch(() => '')
  ])
  return {
    device: device.name,
    state: tag(transport, 'CurrentTransportState') || 'UNKNOWN',
    position: seconds(tag(position, 'RelTime')),
    duration: seconds(tag(position, 'TrackDuration')),
    title: device.nowPlaying?.title || null
  }
}

export function hms (totalSeconds) {
  const value = Math.max(0, Math.floor(Number(totalSeconds) || 0))
  const pad = n => String(n).padStart(2, '0')
  return `${pad(Math.floor(value / 3600))}:${pad(Math.floor(value / 60) % 60)}:${pad(value % 60)}`
}

export function seconds (clock) {
  if (!clock || clock === 'NOT_IMPLEMENTED') return 0
  const parts = String(clock).split(':').map(Number)
  if (parts.some(Number.isNaN)) return 0
  return parts.reduce((total, part) => total * 60 + part, 0)
}
