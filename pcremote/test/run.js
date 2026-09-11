/* Tests for PC Remote.
 *
 * Input is verified for real on Linux against a virtual X display: the pointer
 * is actually moved and its coordinates read back. Windows and macOS cannot be
 * executed here, so their backends run in dry-run mode and the exact commands
 * they would issue are asserted instead. */

import { execFile } from 'child_process'
import { WindowsBackend } from '../server/platform/windows.js'
import * as bedtime from '../server/timer.js'

let passed = 0
let failed = 0

function ok (name, condition, extra = '') {
  if (condition) {
    passed += 1
    console.log(`  PASS  ${name}${extra ? ` -> ${extra}` : ''}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${name}${extra ? ` -> ${extra}` : ''}`)
  }
}

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:11480'
const wait = ms => new Promise(r => setTimeout(r, ms))

async function call (path, { method = 'POST', body, token } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  let data = null
  const text = await res.text()
  if (text) { try { data = JSON.parse(text) } catch { data = text } }
  return { status: res.status, data }
}

const pointer = () => new Promise(resolve => execFile('xdotool', ['getmouselocation'], (err, out) => {
  const match = /x:(\d+)\s+y:(\d+)/.exec(out || '')
  resolve(match ? { x: Number(match[1]), y: Number(match[2]) } : null)
}))

/* ------------------------------------------------- Windows command shapes */

console.log('\nWindows backend (dry run — the exact PowerShell it would send)')
{
  const win = new WindowsBackend({ dryRun: true })

  win.moveRelative(12, -7)
  ok('relative move', win.sent.at(-1) === 'MoveRel 12 -7', win.sent.at(-1))

  win.click('left')
  ok('left click uses LEFTDOWN/LEFTUP flags', win.sent.at(-1) === 'MouseBtn 2 4', win.sent.at(-1))

  win.click('right')
  ok('right click uses RIGHTDOWN/RIGHTUP flags', win.sent.at(-1) === 'MouseBtn 8 16', win.sent.at(-1))

  win.buttonDown('left')
  const down = win.sent.at(-1)
  win.buttonUp('left')
  ok('drag sends down then up separately', down === 'MouseBtn 2 0' && win.sent.at(-1) === 'MouseBtn 0 4', `${down} | ${win.sent.at(-1)}`)

  win.scroll(120)
  ok('scroll down is a negative wheel delta', win.sent.at(-1) === 'Wheel -360', win.sent.at(-1))
  win.scroll(-40)
  ok('scroll up is positive', win.sent.at(-1) === 'Wheel 120', win.sent.at(-1))

  // The whole point of base64: quotes and $ in user text must not become code.
  win.type("hi'; Remove-Item C:\\ -Recurse #")
  const typed = win.sent.at(-1)
  const decoded = Buffer.from(typed.match(/'([^']+)'/)[1], 'base64').toString('utf8')
  ok('typed text is base64, never interpolated', typed.startsWith('TypeB64 ') && !typed.includes('Remove-Item'), typed.slice(0, 34) + '…')
  ok('base64 round-trips exactly', decoded === "hi'; Remove-Item C:\\ -Recurse #", decoded)

  win.type('café ✓ 日本語')
  ok('unicode survives', Buffer.from(win.sent.at(-1).match(/'([^']+)'/)[1], 'base64').toString('utf8') === 'café ✓ 日本語')

  // Named keys must bypass TypeB64, whose brace escaping types "{ENTER}" as text.
  win.key('Enter')
  ok('Enter is sent as a raw SendKeys {ENTER}', win.sent.at(-1) === "SendKeysRaw '{ENTER}'", win.sent.at(-1))
  win.key('Backspace')
  ok('Backspace is sent as a raw SendKeys {BACKSPACE}', win.sent.at(-1) === "SendKeysRaw '{BACKSPACE}'", win.sent.at(-1))

  win.combo(['ctrl', 'c'])
  ok('ctrl+c becomes ^c', win.sent.at(-1) === "SendKeysRaw '^c'", win.sent.at(-1))

  win.combo(['ctrl', 'shift', 'Escape'])
  ok('ctrl+shift+esc keeps the named key', win.sent.at(-1) === "SendKeysRaw '^+{ESC}'", win.sent.at(-1))

  win.combo(['meta', 'd'])
  ok('Windows-key combo uses keybd_event, not SendKeys', win.sent.at(-1) === 'WinCombo 68', win.sent.at(-1))

  win.media('playpause')
  ok('play/pause taps VK 0xB3', win.sent.at(-1) === 'TapVk 179', win.sent.at(-1))
  win.media('volumeup')
  ok('volume up taps VK 0xAF', win.sent.at(-1) === 'TapVk 175', win.sent.at(-1))

  let rejected = null
  try { win.key('NoSuchKey') } catch (err) { rejected = err.message }
  ok('unknown key is rejected', Boolean(rejected), rejected)
}

/* ------------------------------------------------------------ bed timer */

console.log('\nBed timer')
{
  ok('idle by default', bedtime.status().active === false)

  const started = bedtime.start(45, 'shutdown')
  ok('starts and reports the deadline', started.active && started.totalMinutes === 45, `${started.remainingSeconds}s left`)
  ok('remaining is about 45 minutes', Math.abs(started.remainingSeconds - 2700) <= 2)

  const extended = bedtime.extend(10)
  ok('extend adds time', Math.abs(extended.remainingSeconds - 3300) <= 2, `${extended.remainingSeconds}s`)

  ok('cancel stops it', bedtime.cancel() === true && bedtime.status().active === false)
  ok('cancel again is harmless', bedtime.cancel() === false)

  const rejects = value => {
    try { bedtime.start(value); return false } catch { return true }
  }
  ok('rejects zero, negative and absurd lengths', rejects(0) && rejects(-5) && rejects(9999))
  let badAction = false
  try { bedtime.start(5, 'selfdestruct') } catch { badAction = true }
  ok('rejects unknown actions', badAction)
  bedtime.cancel()
}

/* ----------------------------------------------------- live HTTP + input */

console.log('\nServer, pairing and live input')
{
  const health = await call('/api/system', { method: 'GET' })
  ok('unpaired requests are refused', health.status === 401, `HTTP ${health.status}`)

  const bad = await call('/api/pair', { body: { pin: '000000' } })
  ok('a wrong PIN is refused', bad.status === 401 || bad.status === 429, `HTTP ${bad.status}`)

  const pin = process.env.TEST_PIN
  const paired = await call('/api/pair', { body: { pin, label: 'test' } })
  ok('the right PIN returns a token', paired.status === 200 && Boolean(paired.data?.token))
  const token = paired.data?.token

  const forged = await call('/api/system', { method: 'GET', token: 'deadbeef'.repeat(6) })
  ok('a forged token is refused', forged.status === 401)

  const system = await call('/api/system', { method: 'GET', token })
  ok('system reports capabilities', system.status === 200 && system.data.pointer === true,
    `${system.data?.platformName} via ${system.data?.tool}`)

  // Move the real pointer and read the real coordinates back.
  await new Promise(r => execFile('xdotool', ['mousemove', '500', '400'], r))
  const before = await pointer()
  await call('/api/input/move', { body: { dx: 50, dy: 25 }, token })
  await wait(300)
  const after = await pointer()
  const speed = system.data.pointerSpeed
  ok('the API moves the actual pointer', after.x === before.x + Math.round(50 * speed) && after.y === before.y + Math.round(25 * speed),
    `${before.x},${before.y} -> ${after.x},${after.y} (speed ${speed})`)

  // A swipe: many small deltas in quick succession, none of them lost.
  const swipeStart = await pointer()
  for (let i = 0; i < 40; i += 1) await call('/api/input/move', { body: { dx: 1, dy: 0 }, token })
  await wait(400)
  const swiped = await pointer()
  ok('a 40-step swipe lands every step', swiped.x === swipeStart.x + Math.round(1 * speed) * 40,
    `moved ${swiped.x - swipeStart.x}px`)

  ok('click', (await call('/api/input/click', { body: { button: 'left' }, token })).status === 204)
  ok('right click', (await call('/api/input/click', { body: { button: 'right' }, token })).status === 204)
  ok('scroll', (await call('/api/input/scroll', { body: { dy: 120 }, token })).status === 204)
  ok('drag down/up', (await call('/api/input/button', { body: { button: 'left', state: 'down' }, token })).status === 204 &&
    (await call('/api/input/button', { body: { button: 'left', state: 'up' }, token })).status === 204)
  ok('type', (await call('/api/input/type', { body: { text: 'hello from the phone' }, token })).status === 204)
  ok('named key', (await call('/api/input/key', { body: { key: 'Enter' }, token })).status === 204)
  ok('combo', (await call('/api/input/combo', { body: { keys: ['ctrl', 'c'] }, token })).status === 204)
  ok('media key', (await call('/api/media/playpause', { token })).status === 204)

  const huge = await call('/api/input/type', { body: { text: 'x'.repeat(5000) }, token })
  ok('over-long text is refused', huge.status === 413, `HTTP ${huge.status}`)

  const unconfirmed = await call('/api/power/shutdown', { body: {}, token })
  ok('power needs explicit confirmation', unconfirmed.status === 400, unconfirmed.data?.error)

  const nonsense = await call('/api/power/selfdestruct', { body: { confirm: true }, token })
  ok('unknown power actions are refused', nonsense.status === 400)

  // Timer over HTTP, using the harmless "pause" action.
  const t1 = await call('/api/timer', { body: { minutes: 30, action: 'pause' }, token })
  ok('timer starts over the API', t1.status === 200 && t1.data.active, `${t1.data.remainingSeconds}s`)
  const t2 = await call('/api/timer', { method: 'GET', token })
  ok('timer status is readable', t2.data.active && t2.data.action === 'pause')
  const t3 = await call('/api/timer/cancel', { token })
  ok('timer cancels over the API', t3.data.cancelled === true && t3.data.active === false)
}

/* -------------------------------------------------------- rate limiting */

console.log('\nPIN brute-force protection')
{
  let lockedOut = false
  let statuses = []
  for (let i = 0; i < 8; i += 1) {
    const attempt = await call('/api/pair', { body: { pin: String(100000 + i) } })
    statuses.push(attempt.status)
    if (attempt.status === 429) lockedOut = true
  }
  ok('repeated wrong PINs get locked out', lockedOut, statuses.join(','))
}

console.log(`\n  ${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
