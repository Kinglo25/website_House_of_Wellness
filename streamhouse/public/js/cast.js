import { api } from './api.js'
import { h, esc, toast, clock } from './util.js'

/* Sending video to a TV over DLNA. The TV pulls the stream from this server
 * directly, so it plays there even while the file is still downloading — and
 * this page becomes the remote control. */

let bar = null
let poller = null

export async function castPicker ({ torrentId, fileIdx = null, title = '', subtitleUrl = null, url = null }) {
  const backdrop = h(`
    <div class="modal-backdrop">
      <div class="modal">
        <header><h2>Play on your TV</h2></header>
        <div class="content" id="cast-body"><p class="muted">Looking for devices on your network…</p></div>
        <footer>
          <button class="btn ghost" data-act="manual">Add by address</button>
          <button class="btn ghost" data-act="rescan">Scan again</button>
          <button class="btn" data-act="cancel">Close</button>
        </footer>
      </div>
    </div>`)
  document.getElementById('modal-root').append(backdrop)

  const body = backdrop.querySelector('#cast-body')
  const close = () => backdrop.remove()

  backdrop.addEventListener('click', event => {
    if (event.target === backdrop || event.target.dataset.act === 'cancel') close()
  })
  backdrop.querySelector('[data-act="rescan"]').addEventListener('click', () => load(true))
  backdrop.querySelector('[data-act="manual"]').addEventListener('click', async () => {
    const location = prompt('Device description URL\n\nMost TVs expose one like http://192.168.1.20:8080/description.xml — check the TV\'s network or DLNA settings.')
    if (!location) return
    try {
      const device = await api.castAddDevice(location)
      toast(`Added ${device.name}`, 'ok')
      load()
    } catch (err) {
      toast(err.message, 'err')
    }
  })

  async function start (device) {
    close()
    toast(`Starting on ${device.name}…`)
    try {
      await api.castPlay({ deviceId: device.id, torrentId, fileIdx, url, title, subtitleUrl })
      showBar(device, title)
    } catch (err) {
      toast(err.message, 'err')
    }
  }

  async function load (refresh = false) {
    body.innerHTML = `<p class="muted">${refresh ? 'Scanning your network…' : 'Looking for devices…'}</p>`
    let devices = []
    try {
      devices = await api.castDevices(refresh)
    } catch (err) {
      body.innerHTML = ''
      return body.append(h(`<div class="error-box">${esc(err.message)}</div>`))
    }

    body.innerHTML = ''
    if (!devices.length) {
      body.append(h(`
        <div>
          <p>No TV answered.</p>
          <p class="muted tiny">Check that the TV is on and on the same network, and that its DLNA
          feature is enabled — Samsung calls it <b>AllShare</b>, LG <b>SmartShare</b>, Sony
          <b>Screen&nbsp;mirroring / Home&nbsp;network</b>. Then hit Scan again.</p>
          <p class="muted tiny">If your TV never appears, use <b>Add by address</b>, or just open the
          StreamHouse address in the TV's own web browser.</p>
        </div>`))
      return
    }

    devices.forEach(device => {
      const node = h(`
        <button class="device">
          <span class="screen">📺</span>
          <span style="flex:1;min-width:0">
            <b>${esc(device.name)}</b>
            <span class="sub">${esc([device.manufacturer, device.model].filter(Boolean).join(' · ') || 'DLNA renderer')}</span>
          </span>
          <span class="btn small primary">Play</span>
        </button>`)
      node.addEventListener('click', () => start(device))
      body.append(node)
    })
  }

  await load()
  backdrop.querySelector('.device, .btn')?.focus()
}

// A small transport bar: once the TV is playing, this page is the remote.
export function showBar (device, title) {
  hideBar()
  bar = h(`
    <div class="cast-bar">
      <span class="dot"></span>
      <div class="what">
        <b>${esc(title || 'Playing')}</b>
        <div class="tiny muted">on ${esc(device.name)} · <span id="cast-clock">—</span></div>
      </div>
      <button class="btn small" data-act="pause">⏸</button>
      <button class="btn small" data-act="resume">▶</button>
      <button class="btn small" data-act="back">⟲ 10s</button>
      <button class="btn small danger" data-act="stop">Stop</button>
    </div>`)
  document.body.append(bar)

  let position = 0
  bar.addEventListener('click', async event => {
    const act = event.target.closest('[data-act]')?.dataset.act
    if (!act) return
    try {
      if (act === 'stop') {
        await api.castControl(device.id, 'stop')
        hideBar()
        toast('Stopped', 'ok')
        return
      }
      if (act === 'back') await api.castControl(device.id, 'seek', Math.max(0, position - 10))
      else await api.castControl(device.id, act)
    } catch (err) {
      toast(err.message, 'err')
    }
  })

  poller = setInterval(async () => {
    try {
      const state = await api.castStatus(device.id)
      position = state.position
      const clockEl = bar?.querySelector('#cast-clock')
      if (clockEl) {
        clockEl.textContent = state.duration
          ? `${clock(state.position)} / ${clock(state.duration)}`
          : state.state.toLowerCase()
      }
      if (state.state === 'STOPPED' && position === 0) hideBar()
    } catch {
      // The TV dropped off the network; leave the bar so Stop still works.
    }
  }, 4000)
}

export function hideBar () {
  clearInterval(poller)
  poller = null
  bar?.remove()
  bar = null
}

// A "Cast to TV" button that can be dropped into any row or toolbar.
export function castButton (options, { small = true, label = '📺 TV' } = {}) {
  const button = h(`<button class="btn ${small ? 'small ' : ''}ghost" title="Play on your TV">${label}</button>`)
  button.addEventListener('click', event => {
    event.stopPropagation()
    castPicker(typeof options === 'function' ? options() : options)
  })
  return button
}
