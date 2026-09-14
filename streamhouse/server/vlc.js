import { spawn, execFileSync } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import net from 'net'
import path from 'path'

/* Plays a stream in VLC on the computer running StreamHouse.
 *
 * Browsers decode only part of what torrents carry. AC3, E-AC3 and DTS audio —
 * the soundtrack on most films — is not in that part, so the picture plays and
 * the sound does not. VLC decodes all of it.
 *
 * VLC is started with its web interface on a private loopback port, and that
 * is how the position comes back for Continue watching: the browser player
 * saves every ten seconds, and this saves on VLC's behalf the same way. */

const POLL_MS = 5000

// Where VLC is installed, most likely first. Pure, so the tests can check it
// on a machine without VLC.
export function candidatePaths ({ platform = process.platform, env = process.env } = {}) {
  if (env.VLC_PATH) return [env.VLC_PATH]
  const onPath = exe => (env.PATH || env.Path || '')
    .split(platform === 'win32' ? ';' : ':')
    .filter(Boolean)
    .map(dir => (platform === 'win32' ? path.win32 : path.posix).join(dir, exe))

  if (platform === 'win32') {
    return [
      ...[env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Programs')]
        .filter(Boolean)
        .map(dir => path.win32.join(dir, 'VideoLAN', 'VLC', 'vlc.exe')),
      ...onPath('vlc.exe')
    ]
  }
  if (platform === 'darwin') return ['/Applications/VLC.app/Contents/MacOS/VLC', ...onPath('vlc')]
  return onPath('vlc')
}

// The installer records its folder in the registry, which finds VLC on
// another drive or in a folder of the user's choosing.
function registryPaths () {
  const found = []
  for (const key of ['HKLM\\SOFTWARE\\VideoLAN\\VLC', 'HKLM\\SOFTWARE\\WOW6432Node\\VideoLAN\\VLC']) {
    try {
      const out = execFileSync('reg', ['query', key, '/v', 'InstallDir'], { encoding: 'utf8', windowsHide: true, timeout: 3000 })
      const match = /InstallDir\s+REG_\w+\s+(.+)/i.exec(out)
      if (match) found.push(path.win32.join(match[1].trim(), 'vlc.exe'))
    } catch { /* not installed under this key */ }
  }
  return found
}

function isFile (file) {
  try {
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

// Not cached: installing VLC while StreamHouse is running should just work.
export function findVlc () {
  const found = candidatePaths().find(isFile)
  if (found) return found
  if (process.platform === 'win32') return registryPaths().find(isFile) || null
  return null
}

// Only web streams. Anything else — a file path, or a string that VLC would
// read as one of its own options — is refused.
export function playableUrl (value) {
  try {
    const url = new URL(String(value || ''))
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

export function isLoopback (address = '') {
  return /^(?:127\.|::1$|::ffff:127\.)/.test(address)
}

export function vlcArgs ({ url, title, start = 0, httpPort, httpPassword }) {
  const args = [
    // A window of its own, whatever "one instance only" says in VLC's preferences —
    // otherwise an already-open VLC takes the file and the position never comes back.
    '--no-one-instance',
    // Close when the film ends, so the last position read is the end of it.
    '--play-and-exit',
    '--extraintf=http',
    '--http-host=127.0.0.1',
    `--http-port=${httpPort}`,
    `--http-password=${httpPassword}`
  ]
  if (start > 0) args.push(`--start-time=${Math.floor(start)}`)
  if (title) args.push(`--meta-title=${title}`)
  args.push(url)
  return args
}

// VLC's status.json as { time, duration } in seconds, or null while there is
// no position worth keeping — before a resume seek lands, VLC reports 0.
export function positionFrom (status) {
  const time = Number(status?.time) || 0
  const duration = Number(status?.length) || 0
  if (time <= 0) return null
  return { time, duration: duration > 0 ? duration : 0 }
}

function freePort () {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

async function readStatus (port, password) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/requests/status.json`, {
      headers: { Authorization: `Basic ${Buffer.from(`:${password}`).toString('base64')}` },
      signal: AbortSignal.timeout(2000)
    })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

let session = null

// Close the VLC this started, if it is still open. Its last position is saved
// on the way out.
export function stop () {
  session?.child.kill()
}

export function status () {
  const bin = findVlc()
  return { available: Boolean(bin), path: bin, playing: Boolean(session) }
}

// One film at a time: starting another closes the VLC playing the last one.
export async function play ({ bin, url, title, start = 0, onProgress = null }) {
  stop()

  const httpPort = await freePort()
  const httpPassword = crypto.randomBytes(12).toString('hex')
  const child = spawn(bin, vlcArgs({ url, title, start, httpPort, httpPassword }), { stdio: 'ignore' })
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })

  const current = { child, last: null, timer: null }
  session = current

  current.timer = setInterval(async () => {
    const position = positionFrom(await readStatus(httpPort, httpPassword))
    // Paused, or not started yet: nothing new to write.
    if (!position || position.time === current.last?.time) return
    current.last = position
    onProgress?.(position)
  }, POLL_MS)
  current.timer.unref?.()

  child.once('exit', () => {
    clearInterval(current.timer)
    if (session === current) session = null
  })
}
