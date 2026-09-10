import { spawn, execFile } from 'child_process'

/* Windows input through one long-lived PowerShell process.
 *
 * PowerShell takes a second or two to start, so a process per pointer move
 * would be unusable. Instead a single `powershell -Command -` reads statements
 * from stdin; the P/Invoke declarations are set up once at the top.
 *
 * Text to type is base64-encoded on the way in, so quotes, backticks, $ and
 * newlines in what the user types can never be parsed as PowerShell. */

const BOOTSTRAP = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class RemoteInput {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, int data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
}
"@
function MoveRel($dx, $dy) {
  $p = New-Object RemoteInput+POINT
  [void][RemoteInput]::GetCursorPos([ref]$p)
  [void][RemoteInput]::SetCursorPos($p.X + $dx, $p.Y + $dy)
}
function MouseBtn($down, $up) {
  if ($down -ne 0) { [RemoteInput]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero) }
  if ($up -ne 0) { [RemoteInput]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero) }
}
function Wheel($delta) { [RemoteInput]::mouse_event(0x0800, 0, 0, $delta, [UIntPtr]::Zero) }
function TapVk($vk) {
  [RemoteInput]::keybd_event([byte]$vk, 0, 0, [UIntPtr]::Zero)
  [RemoteInput]::keybd_event([byte]$vk, 0, 2, [UIntPtr]::Zero)
}
function EscapeKeys($s) {
  $out = ''
  foreach ($ch in $s.ToCharArray()) {
    if ('+^%~(){}[]'.Contains($ch)) { $out += '{' + $ch + '}' } else { $out += $ch }
  }
  return $out
}
function TypeB64($b64) {
  $text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))
  [System.Windows.Forms.SendKeys]::SendWait((EscapeKeys $text))
}
function SendKeysRaw($seq) { [System.Windows.Forms.SendKeys]::SendWait($seq) }
function WinCombo($vk) {
  [RemoteInput]::keybd_event(0x5B, 0, 0, [UIntPtr]::Zero)
  TapVk $vk
  [RemoteInput]::keybd_event(0x5B, 0, 2, [UIntPtr]::Zero)
}
`.trim()

const BUTTONS = {
  left: { down: 0x0002, up: 0x0004 },
  right: { down: 0x0008, up: 0x0010 },
  middle: { down: 0x0020, up: 0x0040 }
}

// SendKeys names for the keys the on-screen keyboard offers.
const KEYS = {
  Enter: '{ENTER}',
  Backspace: '{BACKSPACE}',
  Escape: '{ESC}',
  Tab: '{TAB}',
  Space: ' ',
  Delete: '{DEL}',
  ArrowUp: '{UP}',
  ArrowDown: '{DOWN}',
  ArrowLeft: '{LEFT}',
  ArrowRight: '{RIGHT}',
  Home: '{HOME}',
  End: '{END}',
  PageUp: '{PGUP}',
  PageDown: '{PGDN}',
  F5: '{F5}',
  F11: '{F11}'
}

const MEDIA_VK = {
  playpause: 0xB3,
  next: 0xB0,
  previous: 0xB1,
  stop: 0xB2,
  volumeup: 0xAF,
  volumedown: 0xAE,
  mute: 0xAD
}

export class WindowsBackend {
  constructor ({ dryRun = false } = {}) {
    this.name = 'windows'
    this.proc = null
    this.dryRun = dryRun
    this.sent = []
  }

  async detect () {
    return { pointer: true, keyboard: true, media: true, power: true, tool: 'powershell', note: null }
  }

  stream () {
    if (this.proc && !this.proc.killed) return this.proc
    this.proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'], {
      stdio: ['pipe', 'ignore', 'ignore'],
      windowsHide: true
    })
    this.proc.on('error', () => { this.proc = null })
    this.proc.on('exit', () => { this.proc = null })
    this.proc.stdin.write(`${BOOTSTRAP}\n`)
    return this.proc
  }

  send (line) {
    this.sent.push(line)
    if (this.dryRun) return
    const proc = this.stream()
    if (!proc?.stdin?.writable) throw new Error('PowerShell is not available')
    proc.stdin.write(`${line}\n`)
  }

  moveRelative (dx, dy) {
    this.send(`MoveRel ${Math.round(dx)} ${Math.round(dy)}`)
  }

  click (button = 'left', double = false) {
    const codes = BUTTONS[button] || BUTTONS.left
    this.send(`MouseBtn ${codes.down} ${codes.up}`)
    if (double) this.send(`MouseBtn ${codes.down} ${codes.up}`)
  }

  buttonDown (button = 'left') {
    this.send(`MouseBtn ${(BUTTONS[button] || BUTTONS.left).down} 0`)
  }

  buttonUp (button = 'left') {
    this.send(`MouseBtn 0 ${(BUTTONS[button] || BUTTONS.left).up}`)
  }

  scroll (dy) {
    // A wheel notch is 120; the sign is inverted against screen coordinates.
    const notches = Math.min(10, Math.max(1, Math.round(Math.abs(dy) / 40)))
    this.send(`Wheel ${(dy < 0 ? 120 : -120) * notches}`)
  }

  type (text) {
    this.send(`TypeB64 '${Buffer.from(String(text), 'utf8').toString('base64')}'`)
  }

  key (name) {
    const sequence = KEYS[name]
    if (!sequence) throw new Error(`Unknown key: ${name}`)
    this.send(`TypeB64 '${Buffer.from(sequence, 'utf8').toString('base64')}'`)
  }

  combo (keys) {
    const lower = keys.map(key => String(key).toLowerCase())
    const last = lower[lower.length - 1]
    // SendKeys has no Windows-key prefix, so those go through keybd_event.
    if (lower.includes('meta') || lower.includes('win') || lower.includes('cmd')) {
      const vk = last.length === 1 ? last.toUpperCase().charCodeAt(0) : SPECIAL_VK[last]
      if (!vk) throw new Error(`Cannot send Windows-key combo with ${last}`)
      this.send(`WinCombo ${vk}`)
      return
    }
    let prefix = ''
    if (lower.includes('ctrl') || lower.includes('control')) prefix += '^'
    if (lower.includes('alt')) prefix += '%'
    if (lower.includes('shift')) prefix += '+'
    const tail = KEYS[keys[keys.length - 1]] || last
    this.send(`SendKeysRaw '${prefix}${tail}'`)
  }

  media (action) {
    const vk = MEDIA_VK[action]
    if (!vk) throw new Error(`Unknown media action: ${action}`)
    this.send(`TapVk ${vk}`)
  }

  power (action) {
    switch (action) {
      case 'shutdown': return run('shutdown.exe', ['/s', '/t', '0'])
      case 'restart': return run('shutdown.exe', ['/r', '/t', '0'])
      case 'logoff': return run('shutdown.exe', ['/l'])
      case 'lock': return run('rundll32.exe', ['user32.dll,LockWorkStation'])
      // Sleeps unless hibernation is enabled, in which case Windows hibernates.
      case 'sleep': return run('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0'])
      default: throw new Error(`Unknown power action: ${action}`)
    }
  }

  dispose () {
    try { this.proc?.kill() } catch { /* already gone */ }
    this.proc = null
  }
}

const SPECIAL_VK = { d: 0x44, e: 0x45, l: 0x4C, r: 0x52, tab: 0x09 }

function run (command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 10000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.trim() || err.message))
      else resolve(stdout)
    })
  })
}

export { BOOTSTRAP, KEYS as WINDOWS_KEYS, MEDIA_VK }
