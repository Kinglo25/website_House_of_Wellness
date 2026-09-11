import os from 'os'
import { LinuxBackend } from './linux.js'
import { WindowsBackend } from './windows.js'
import { MacBackend } from './macos.js'

/* Picks the backend for whatever this computer is, and remembers what it can
 * actually do so the phone can grey out what will not work. */

let backend = null
let capabilities = null

export function createBackend (platform = process.platform) {
  switch (platform) {
    case 'win32': return new WindowsBackend()
    case 'darwin': return new MacBackend()
    default: return new LinuxBackend()
  }
}

export async function getBackend () {
  if (backend) return backend
  backend = createBackend()
  capabilities = await backend.detect()
  return backend
}

export async function getCapabilities () {
  await getBackend()
  return {
    ...capabilities,
    platform: process.platform,
    platformName: { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[process.platform] || process.platform,
    hostname: os.hostname(),
    uptime: os.uptime()
  }
}

export function disposeBackend () {
  backend?.dispose?.()
  backend = null
  capabilities = null
}
