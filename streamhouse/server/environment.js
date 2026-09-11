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
