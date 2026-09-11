import fs from 'fs'
import os from 'os'

/* Works out whether this process is somewhere other devices can actually reach.
 *
 * Running the server inside WSL, Docker or a VM is the usual reason a phone or
 * TV cannot connect: those get a private virtual address (typically
 * 172.16-172.31) that is NAT'd away from the real network, so the address the
 * banner prints is unreachable from anywhere else in the house. */

export function isVirtualAddress (address) {
  return /^172\.(1[6-9]|2\d|3[01])\./.test(address)
}

export function isHomeAddress (address) {
  return address.startsWith('192.168.') || address.startsWith('10.')
}

// Pure, so the tests can feed it each situation rather than needing real WSL.
export function detectHost ({
  procVersion = readProcVersion(),
  env = process.env,
  dockerEnv = fs.existsSync('/.dockerenv'),
  addresses = [],
  platform = process.platform
} = {}) {
  const wsl = platform === 'linux' && (/microsoft|WSL/i.test(procVersion || '') || Boolean(env.WSL_DISTRO_NAME))
  const docker = platform === 'linux' && dockerEnv
  const reachable = addresses.filter(isHomeAddress)
  const virtualOnly = addresses.length > 0 && reachable.length === 0 && addresses.some(isVirtualAddress)

  let warning = null
  if (wsl) {
    warning = {
      kind: 'wsl',
      title: 'This is running inside WSL, which your phone and TV cannot reach.',
      fix: [
        'Run it in Windows itself: install Node from nodejs.org, open PowerShell,',
        'and start it there instead of in the WSL terminal.',
        'Or enable mirrored networking: put the two lines below in',
        `${env.USERPROFILE || 'C:\\Users\\<you>'}\\.wslconfig and run "wsl --shutdown":`,
        '    [wsl2]',
        '    networkingMode=mirrored'
      ]
    }
  } else if (docker) {
    warning = {
      kind: 'docker',
      title: 'This is running inside Docker, so the address below is container-internal.',
      fix: ['Start the container with --network host, or publish the port to the host.']
    }
  } else if (virtualOnly) {
    warning = {
      kind: 'virtual',
      title: `The only address found (${addresses[0]}) looks like a virtual adapter, not your home network.`,
      fix: [
        'Home networks use 192.168.x.x or 10.x.x.x addresses.',
        'A VM, VPN or virtual switch is probably in the way.'
      ]
    }
  }

  return { wsl, docker, virtualOnly, reachable, warning, hostname: os.hostname() }
}


/* Not every address a machine has is one a phone can reach. On Windows in
 * particular, WSL, Docker Desktop and Hyper-V each add a virtual adapter whose
 * address looks just as plausible as the real Wi-Fi one. */

const VIRTUAL_NAMES = /vethernet|wsl|hyper-?v|virtualbox|vmware|docker|vpn|tailscale|zerotier|tap-|utun|bridge|loopback/i

export function isVirtualInterface (name = '', address = '') {
  return VIRTUAL_NAMES.test(name) || isVirtualAddress(address)
}

// Sorted best-first, each marked so the banner can label it.
export function rankInterfaces (interfaces = []) {
  return interfaces
    .map(entry => {
      const virtual = isVirtualInterface(entry.name, entry.address)
      return { ...entry, virtual, home: isHomeAddress(entry.address) }
    })
    .sort((a, b) => {
      if (a.virtual !== b.virtual) return a.virtual ? 1 : -1
      if (a.home !== b.home) return a.home ? -1 : 1
      return 0
    })
    .map((entry, index) => ({ ...entry, recommended: index === 0 && !entry.virtual }))
}

// The lines the startup banner prints for each address.
export function describeAddresses (interfaces, port, label) {
  const ranked = rankInterfaces(interfaces)
  const lines = []
  ranked.forEach((entry, index) => {
    const prefix = index === 0 ? label : ' '.repeat(label.length)
    const url = `http://${entry.address}:${port}`
    const adapter = entry.name ? `  (${entry.name})` : ''
    const note = entry.recommended
      ? '  ← use this one'
      : entry.virtual
        ? '  — virtual adapter, a phone cannot reach this'
        : ''
    lines.push(`${prefix}${url.padEnd(26)}${adapter}${note}`)
  })
  if (!ranked.length) lines.push(`${label}(no network address found — is this machine on your network?)`)
  return lines
}

// Windows blocks inbound connections to Node until told otherwise, and this is
// the next thing to trip over once the right address is in hand.
export function firewallHint (port, appName, platform = process.platform) {
  if (platform !== 'win32') return []
  return [
    'If the phone still times out, allow it through Windows Firewall.',
    'In PowerShell as Administrator:',
    `    New-NetFirewallRule -DisplayName "${appName}" -Direction Inbound \\`,
    `      -Protocol TCP -LocalPort ${port} -Action Allow -Profile Private`
  ]
}

function readProcVersion () {
  try {
    return fs.readFileSync('/proc/version', 'utf8')
  } catch {
    return ''
  }
}

// Prints the warning, if there is one, in a form someone can act on.
export function printHostWarning (host, { controlsDesktop = false } = {}) {
  if (!host.warning) return false
  console.log('  ⚠  ' + host.warning.title)
  if (controlsDesktop && host.wsl) {
    console.log('     It also cannot move the mouse or type on the Windows desktop from in here.')
  }
  console.log('')
  for (const line of host.warning.fix) console.log(`     ${line}`)
  console.log('')
  return true
}
