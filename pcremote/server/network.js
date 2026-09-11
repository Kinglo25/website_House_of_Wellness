import os from 'os'

export function localAddresses () {
  const out = []
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if ((entry.family === 'IPv4' || entry.family === 4) && !entry.internal) out.push({ address: entry.address, name })
    }
  }
  const score = address => {
    if (address.startsWith('192.168.')) return 0
    if (address.startsWith('10.')) return 1
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 2
    return 3
  }
  return out.sort((a, b) => score(a.address) - score(b.address))
}
