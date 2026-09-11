import { execFile } from 'child_process'

/* macOS input.
 *
 * Keys, clicks, volume and power all go through osascript, which ships with the
 * system. Moving the pointer does not: AppleScript simply cannot do it, so that
 * one feature needs the small `cliclick` helper (brew install cliclick). The
 * capability report says so plainly rather than failing silently.
 *
 * macOS also gates synthetic input behind Accessibility permission — Terminal
 * (or whatever runs this) must be ticked in System Settings → Privacy &
 * Security → Accessibility. */

const KEY_CODES = {
  Enter: 36,
  Backspace: 51,
  Escape: 53,
  Tab: 48,
  Space: 49,
  Delete: 117,
  ArrowUp: 126,
  ArrowDown: 125,
  ArrowLeft: 123,
  ArrowRight: 124,
  Home: 115,
  End: 119,
  PageUp: 116,
  PageDown: 121,
  F5: 96,
  F11: 103
}

const MODIFIERS = {
  ctrl: 'control down',
  control: 'control down',
  alt: 'option down',
  option: 'option down',
  shift: 'shift down',
  meta: 'command down',
  cmd: 'command down',
  win: 'command down'
}

export class MacBackend {
  constructor () {
    this.name = 'macos'
    this.cliclick = false
  }

  async detect () {
    this.cliclick = await which('cliclick')
    return {
      pointer: this.cliclick,
      keyboard: true,
      media: true,
      power: true,
      tool: this.cliclick ? 'cliclick + osascript' : 'osascript',
      note: this.cliclick
        ? 'Give your terminal Accessibility permission in System Settings → Privacy & Security.'
        : 'Pointer control needs cliclick: brew install cliclick. Keyboard, media and power work without it. Accessibility permission is required in System Settings → Privacy & Security.'
    }
  }

  requirePointer () {
    if (!this.cliclick) {
      throw new Error('Pointer control on macOS needs cliclick — install it with: brew install cliclick')
    }
  }

  moveRelative (dx, dy) {
    this.requirePointer()
    const x = Math.round(dx)
    const y = Math.round(dy)
    return run('cliclick', [`m:${x >= 0 ? '+' : ''}${x},${y >= 0 ? '+' : ''}${y}`])
  }

  click (button = 'left', double = false) {
    if (this.cliclick) {
      const command = button === 'right' ? 'rc:.' : double ? 'dc:.' : 'c:.'
      return run('cliclick', [command])
    }
    // System Events can click where the pointer already is.
    const script = button === 'right'
      ? 'tell application "System Events" to key code 36 using {control down}'
      : 'tell application "System Events" to click at (get position of mouse)'
    return osascript(script).catch(() => {
      throw new Error('Clicking needs cliclick on this version of macOS — brew install cliclick')
    })
  }

  buttonDown () {
    this.requirePointer()
    return run('cliclick', ['dd:.'])
  }

  buttonUp () {
    this.requirePointer()
    return run('cliclick', ['du:.'])
  }

  scroll (dy) {
    // No scroll wheel synthesis without a helper; page keys are the honest
    // approximation and work in every scrollable view.
    return this.key(dy < 0 ? 'PageUp' : 'PageDown')
  }

  type (text) {
    return osascriptArgv(
      'on run argv\ntell application "System Events" to keystroke (item 1 of argv)\nend run',
      [String(text)]
    )
  }

  key (name) {
    const code = KEY_CODES[name]
    if (!code) throw new Error(`Unknown key: ${name}`)
    return osascript(`tell application "System Events" to key code ${code}`)
  }

  combo (keys) {
    const lower = keys.map(key => String(key).toLowerCase())
    const mods = lower.map(key => MODIFIERS[key]).filter(Boolean)
    const last = keys[keys.length - 1]
    const using = mods.length ? ` using {${mods.join(', ')}}` : ''
    if (KEY_CODES[last]) {
      return osascript(`tell application "System Events" to key code ${KEY_CODES[last]}${using}`)
    }
    return osascript(`tell application "System Events" to keystroke "${String(last).replace(/["\\]/g, '\\$&')}"${using}`)
  }

  media (action) {
    switch (action) {
      case 'volumeup':
        return osascript('set volume output volume (output volume of (get volume settings) + 8)')
      case 'volumedown':
        return osascript('set volume output volume (output volume of (get volume settings) - 8)')
      case 'mute':
        return osascript('set volume output muted (not output muted of (get volume settings))')
      case 'playpause':
      case 'next':
      case 'previous':
      case 'stop':
        return this.mediaApp(action)
      default:
        throw new Error(`Unknown media action: ${action}`)
    }
  }

  // Whichever player is actually running gets the transport command.
  async mediaApp (action) {
    const verb = { playpause: 'playpause', next: 'next track', previous: 'previous track', stop: 'pause' }[action]
    for (const app of ['Spotify', 'Music']) {
      try {
        await osascript(`if application "${app}" is running then tell application "${app}" to ${verb}`)
        return
      } catch { /* try the next player */ }
    }
    throw new Error('No supported media player is running (Spotify or Music)')
  }

  power (action) {
    switch (action) {
      case 'shutdown': return osascript('tell application "System Events" to shut down')
      case 'restart': return osascript('tell application "System Events" to restart')
      case 'sleep': return osascript('tell application "System Events" to sleep')
      case 'logoff': return osascript('tell application "System Events" to log out')
      case 'lock': return run('pmset', ['displaysleepnow'])
      default: throw new Error(`Unknown power action: ${action}`)
    }
  }

  dispose () {}
}

function osascript (script) {
  return run('osascript', ['-e', script])
}

// Text the user typed is passed as an argument, never interpolated into the
// script, so quotes and backslashes in it are harmless.
function osascriptArgv (script, args) {
  return run('osascript', ['-e', script, ...args])
}

function run (command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 10000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.trim() || err.message))
      else resolve(stdout)
    })
  })
}

function which (command) {
  return new Promise(resolve => execFile('which', [command], err => resolve(!err)))
}
