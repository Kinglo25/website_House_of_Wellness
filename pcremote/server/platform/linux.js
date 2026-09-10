import { spawn, execFile } from 'child_process'

/* Linux input via xdotool (X11) or ydotool (Wayland).
 *
 * Pointer moves arrive dozens of times a second while a finger is on the
 * trackpad, so they go down the stdin of one long-lived `xdotool -` process:
 * spawning a process per movement would make the cursor crawl. */

export class LinuxBackend {
  constructor () {
    this.name = 'linux'
    this.proc = null
    this.tool = null
  }

  async detect () {
    this.tool = (await which('xdotool')) ? 'xdotool' : (await which('ydotool')) ? 'ydotool' : null
    return {
      pointer: this.tool === 'xdotool',
      keyboard: Boolean(this.tool),
      media: Boolean(this.tool),
      power: true,
      tool: this.tool,
      // Wayland refuses synthetic input from X11 tools; ydotool needs a daemon.
      note: this.tool
        ? null
        : 'Install xdotool (X11) or ydotool (Wayland) for mouse and keyboard control: sudo apt install xdotool'
    }
  }

  stream () {
    if (this.proc && !this.proc.killed) return this.proc
    this.proc = spawn('xdotool', ['-'], { stdio: ['pipe', 'ignore', 'ignore'] })
    this.proc.on('error', () => { this.proc = null })
    this.proc.on('exit', () => { this.proc = null })
    return this.proc
  }

  send (line) {
    const proc = this.stream()
    if (!proc?.stdin?.writable) throw new Error('xdotool is not available')
    proc.stdin.write(`${line}\n`)
  }

  moveRelative (dx, dy) {
    this.send(`mousemove_relative -- ${Math.round(dx)} ${Math.round(dy)}`)
  }

  click (button = 'left', double = false) {
    const code = { left: 1, middle: 2, right: 3 }[button] || 1
    this.send(`click ${code}`)
    if (double) this.send(`click ${code}`)
  }

  buttonDown (button = 'left') {
    this.send(`mousedown ${{ left: 1, middle: 2, right: 3 }[button] || 1}`)
  }

  buttonUp (button = 'left') {
    this.send(`mouseup ${{ left: 1, middle: 2, right: 3 }[button] || 1}`)
  }

  scroll (dy) {
    // Wheel buttons: 4 is up, 5 is down. One click per notch.
    const button = dy < 0 ? 4 : 5
    const notches = Math.min(10, Math.max(1, Math.round(Math.abs(dy) / 40)))
    for (let i = 0; i < notches; i += 1) this.send(`click ${button}`)
  }

  // Typing goes through argv rather than the command stream, so quotes,
  // spaces and unicode in the text cannot be misparsed.
  type (text) {
    return run('xdotool', ['type', '--clearmodifiers', '--', text])
  }

  key (name) {
    const mapped = KEYS[name] || name
    return run('xdotool', ['key', '--clearmodifiers', mapped])
  }

  combo (keys) {
    const mapped = keys.map(key => MODIFIERS[key.toLowerCase()] || KEYS[key] || key)
    return run('xdotool', ['key', '--clearmodifiers', mapped.join('+')])
  }

  media (action) {
    const key = MEDIA[action]
    if (!key) throw new Error(`Unknown media action: ${action}`)
    return run('xdotool', ['key', '--clearmodifiers', key])
  }

  power (action) {
    switch (action) {
      case 'shutdown': return run('systemctl', ['poweroff'])
      case 'restart': return run('systemctl', ['reboot'])
      case 'sleep': return run('systemctl', ['suspend'])
      case 'lock': return run('loginctl', ['lock-session'])
      case 'logoff': return run('loginctl', ['terminate-user', process.env.USER || ''])
      default: throw new Error(`Unknown power action: ${action}`)
    }
  }

  dispose () {
    try { this.proc?.kill() } catch { /* already gone */ }
    this.proc = null
  }
}

const KEYS = {
  Enter: 'Return',
  Backspace: 'BackSpace',
  Escape: 'Escape',
  Tab: 'Tab',
  Space: 'space',
  Delete: 'Delete',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Home: 'Home',
  End: 'End',
  PageUp: 'Prior',
  PageDown: 'Next',
  F5: 'F5',
  F11: 'F11'
}

const MODIFIERS = { ctrl: 'ctrl', control: 'ctrl', alt: 'alt', shift: 'shift', meta: 'super', win: 'super', cmd: 'super' }

const MEDIA = {
  playpause: 'XF86AudioPlay',
  next: 'XF86AudioNext',
  previous: 'XF86AudioPrev',
  stop: 'XF86AudioStop',
  volumeup: 'XF86AudioRaiseVolume',
  volumedown: 'XF86AudioLowerVolume',
  mute: 'XF86AudioMute'
}

function run (command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 8000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.trim() || err.message))
      else resolve(stdout)
    })
  })
}

function which (command) {
  return new Promise(resolve => {
    execFile('which', [command], err => resolve(!err))
  })
}
