import { api } from '../api.js'
import { h, esc, toast, bytes } from '../util.js'

// Everything the engine and the UI read at runtime, editable in one place.
export default async function settings ({ container }) {
  container.innerHTML = '<div class="pad" id="settings"></div>'
  const root = container.querySelector('#settings')
  root.append(h('<h1>Settings</h1>'))

  const [config, disk] = await Promise.all([api.getConfig(), api.disk().catch(() => null)])
  const grid = h('<div class="settings-grid"></div>')
  root.append(grid)

  const save = async patch => {
    try {
      await api.saveConfig(patch)
      toast('Saved', 'ok')
    } catch (err) {
      toast(err.message, 'err')
    }
  }

  const textSetting = ({ key, title, hint, value, placeholder = '' }) => {
    const node = h(`
      <div class="setting">
        <div class="label"><b>${esc(title)}</b><span class="tiny muted">${hint}</span></div>
        <div class="control"><input class="field" value="${esc(value)}" placeholder="${esc(placeholder)}"></div>
      </div>`)
    const input = node.querySelector('input')
    input.addEventListener('change', () => save({ [key]: input.value }))
    return node
  }

  const numberSetting = ({ key, title, hint, value, min = 0, step = 1, transform = v => v, display = v => v }) => {
    const node = h(`
      <div class="setting">
        <div class="label"><b>${esc(title)}</b><span class="tiny muted">${hint}</span></div>
        <div class="control"><input class="field" type="number" min="${min}" step="${step}" value="${esc(display(value))}"></div>
      </div>`)
    const input = node.querySelector('input')
    input.addEventListener('change', () => save({ [key]: transform(Number(input.value)) }))
    return node
  }

  const toggleSetting = ({ key, title, hint, value }) => {
    const node = h(`
      <div class="setting">
        <div class="label"><b>${esc(title)}</b><span class="tiny muted">${hint}</span></div>
        <div class="switch ${value ? 'on' : ''}"><i></i></div>
      </div>`)
    const toggle = node.querySelector('.switch')
    toggle.addEventListener('click', () => {
      const next = !toggle.classList.contains('on')
      toggle.classList.toggle('on', next)
      save({ [key]: next })
    })
    return node
  }

  grid.append(h('<h2 style="margin-top:8px">Downloads</h2>'))
  grid.append(textSetting({
    key: 'downloadDir',
    title: 'Download folder',
    hint: disk ? `${disk.writable ? 'writable' : 'NOT writable — pick another folder'}` : 'where finished media is kept',
    value: config.downloadDir
  }))
  grid.append(numberSetting({
    key: 'downloadLimit',
    title: 'Download limit',
    hint: 'KB/s — 0 means unlimited',
    value: config.downloadLimit,
    display: value => (value > 0 ? Math.round(value / 1024) : 0),
    transform: value => (value > 0 ? value * 1024 : -1)
  }))
  grid.append(numberSetting({
    key: 'uploadLimit',
    title: 'Upload limit',
    hint: 'KB/s — 0 means unlimited',
    value: config.uploadLimit,
    display: value => (value > 0 ? Math.round(value / 1024) : 0),
    transform: value => (value > 0 ? value * 1024 : -1)
  }))
  grid.append(numberSetting({
    key: 'maxConns',
    title: 'Peer connections',
    hint: 'maximum peers per torrent',
    value: config.maxConns,
    min: 4
  }))
  grid.append(toggleSetting({
    key: 'seedAfterDownload',
    title: 'Keep seeding when finished',
    hint: 'share completed files back to the swarm',
    value: config.seedAfterDownload
  }))
  grid.append(numberSetting({
    key: 'seedRatioLimit',
    title: 'Stop seeding at ratio',
    hint: '0 means never stop automatically',
    value: config.seedRatioLimit,
    step: 0.1
  }))
  grid.append(toggleSetting({
    key: 'streamCacheOnly',
    title: 'Discard streamed files',
    hint: 'delete play-only torrents 30 minutes after you stop watching',
    value: config.streamCacheOnly
  }))

  grid.append(h('<h2 style="margin-top:22px">Network</h2>'))
  grid.append(numberSetting({
    key: 'torrentPort',
    title: 'BitTorrent port',
    hint: '0 lets the OS choose a free port',
    value: config.torrentPort
  }))
  grid.append(numberSetting({
    key: 'port',
    title: 'Web interface port',
    hint: 'takes effect after a restart',
    value: config.port,
    min: 1
  }))
  grid.append(textSetting({
    key: 'host',
    title: 'Bind address',
    hint: '127.0.0.1 keeps it local; 0.0.0.0 exposes it to your network (restart required)',
    value: config.host
  }))

  grid.append(h('<h2 style="margin-top:22px">Maintenance</h2>'))
  const maintenance = h(`
    <div class="setting">
      <div class="label"><b>Add-on response cache</b><span class="tiny muted">catalogues and streams are cached for five minutes</span></div>
      <div class="control"><button class="btn" id="clear-cache">Clear cache</button></div>
    </div>`)
  maintenance.querySelector('#clear-cache').addEventListener('click', async () => {
    await api.clearCache()
    toast('Cache cleared', 'ok')
  })
  grid.append(maintenance)

  const about = h(`
    <div class="setting">
      <div class="label">
        <b>About</b>
        <span class="tiny muted">StreamHouse — a Stremio-style front end with its own BitTorrent engine.
        You are responsible for the add-ons you install and the material you download.</span>
      </div>
      <div class="control tiny muted mono">data: ~/.streamhouse<br>media: ${esc(config.downloadDir)}</div>
    </div>`)
  grid.append(about)
}
