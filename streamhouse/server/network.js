import os from 'os'

// A TV cannot reach 127.0.0.1, so anything that hands a URL to another device
// (casting, or typing the address into the TV browser) needs the LAN address.
export function localAddresses () {
  const out = []
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' && entry.family !== 4) continue
      if (entry.internal) continue
      out.push({ name, address: entry.address, netmask: entry.netmask })
    }
  }
  // Prefer ordinary home-network ranges over VPN / container bridges.
  const score = address => {
    if (address.startsWith('192.168.')) return 0
    if (address.startsWith('10.')) return 1
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 2
    return 3
  }
  return out.sort((a, b) => score(a.address) - score(b.address))
}

export function primaryAddress () {
  return localAddresses()[0]?.address || null
}

// The address another device on the network should use to reach this server.
export function lanUrl (port, address = null) {
  const host = address || primaryAddress()
  return host ? `http://${host}:${port}` : null
}

// Bound to loopback only, nothing else on the network can connect — the most
// common reason "it does not work on my TV".
export function isLanReachable (host) {
  return host === '0.0.0.0' || host === '::' || (host && host !== '127.0.0.1' && host !== 'localhost' && host !== '::1')
}
