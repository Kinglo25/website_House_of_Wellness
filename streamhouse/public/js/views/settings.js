import { api } from '../api.js'
import { h, esc, toast, bytes, confirmDialog } from '../util.js'
import { setTvMode } from '../tv.js'
import { castPicker } from '../cast.js'
import { avatar, currentViewer, setViewer, MAIN } from '../viewers.js'

// Everything the engine and the UI read at runtime, editable in one place.
export default async function settings ({ container, query = {} }) {
  container.innerHTML = '<div class="pad" id="settings"></div>'
  const root = container.querySelector('#settings')
  root.append(h('<h1>Settings</h1>'))

  const [config, disk, network, profiles, vlc, account] = await Promise.all([
    api.getConfig(),
    api.disk().catch(() => null),
    api.network().catch(() => null),
    api.profiles().catch(() => []),
    api.vlc().catch(() => null),
    api.account().catch(() => null)
  ])
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

  const selectSetting = ({ key, title, hint, value, options }) => {
    const node = h(`
      <div class="setting">
        <div class="label"><b>${esc(title)}</b><span class="tiny muted">${hint}</span></div>
        <div class="control">
          <select class="field">
            ${options.map(option => `<option value="${esc(option.value)}" ${String(option.value) === String(value) ? 'selected' : ''}>${esc(option.label)}</option>`).join('')}
          </select>
        </div>
      </div>`)
    const select = node.querySelector('select')
    select.addEventListener('change', () => save({ [key]: select.value }))
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

  /* ------------------------------------------------------------- account */

  grid.append(h('<h2 style="margin-top:8px" id="profiles">Profiles</h2>'))
  grid.append(profilesPanel())
  if (query.section === 'profiles') setTimeout(() => root.querySelector('#profiles')?.scrollIntoView({ block: 'start' }), 50)

  grid.append(h('<h2 style="margin-top:22px">Account</h2>'))
  const accountPanel = h('<div class="setting" style="align-items:flex-start"></div>')
  grid.append(accountPanel)

  const ago = time => {
    const seconds = Math.round((Date.now() - time) / 1000)
    if (seconds < 45) return 'just now'
    if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
    if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`
    return `on ${new Date(time).toLocaleDateString()}`
  }

  function drawAccount (info) {
    accountPanel.innerHTML = ''

    if (info?.signedIn) {
      const line = info.lastError
        ? `<span class="tiny" style="color:#ff9ba4">${esc(info.lastError)}</span>`
        : `<span class="tiny muted">${info.lastSync ? `Synced ${esc(ago(info.lastSync))}.` : 'Syncing…'} Your library,
          Continue watching, add-ons and stream settings follow you to every device signed in here.</span>`
      accountPanel.append(
        h(`<div class="label"><b>Signed in as ${esc(info.email)}</b>${line}</div>`),
        h(`<div class="control row" style="gap:8px">
          <button class="btn" data-act="sync">Sync now</button>
          <button class="btn" data-act="logout">Sign out</button>
        </div>`)
      )
      accountPanel.querySelector('[data-act="sync"]').addEventListener('click', async event => {
        event.currentTarget.disabled = true
        const next = await api.accountSync().catch(err => ({ ...info, lastError: err.message }))
        drawAccount(next)
        toast(next.lastError || 'Synced', next.lastError ? 'err' : 'ok')
      })
      accountPanel.querySelector('[data-act="logout"]').addEventListener('click', async () => {
        const sure = await confirmDialog({
          title: 'Sign out?',
          body: 'Everything already on this device stays here — it just stops syncing with your other devices.',
          confirmLabel: 'Sign out'
        })
        if (!sure) return
        drawAccount(await api.accountLogout().catch(() => null))
        toast('Signed out', 'ok')
      })
      return
    }

    accountPanel.append(h(`
      <div class="label">
        <b>Sign in to sync your devices</b>
        <span class="tiny muted">Your library, Continue watching, add-ons and stream settings follow you
        to every device signed in to the same account. Films do not — each device fetches its own.</span>
        ${info?.lastError ? `<span class="tiny" style="color:#ff9ba4">${esc(info.lastError)}</span>` : ''}
        <form style="display:grid;gap:8px;margin-top:12px;max-width:360px">
          <input class="field" name="email" type="email" autocomplete="username" placeholder="Email" required>
          <input class="field" name="password" type="password" autocomplete="current-password" minlength="8"
            placeholder="Password — 8 characters or more" required>
          <div class="row" style="gap:8px">
            <button class="btn primary" type="submit" data-mode="login">Sign in</button>
            <button class="btn" type="submit" data-mode="signup">Create account</button>
          </div>
        </form>
      </div>`))

    const form = accountPanel.querySelector('form')
    form.addEventListener('submit', async event => {
      event.preventDefault()
      const mode = event.submitter?.dataset.mode || 'login'
      const buttons = [...form.querySelectorAll('button')]
      buttons.forEach(button => { button.disabled = true })
      const body = { email: form.email.value, password: form.password.value }
      try {
        const next = await (mode === 'signup' ? api.accountSignup(body) : api.accountLogin(body))
        toast(mode === 'signup' ? 'Account created — this device is syncing' : 'Signed in — this device is synced', 'ok')
        drawAccount(next)
        // Add-ons and settings may just have arrived from another device.
        setTimeout(() => location.reload(), 900)
      } catch (err) {
        toast(err.message, 'err')
        buttons.forEach(button => { button.disabled = false })
      }
    })
  }
  drawAccount(account)

  /* ------------------------------------------------------------ playback */

  grid.append(h('<h2 style="margin-top:22px">Playback</h2>'))
  const vlcHint = vlc?.available
    ? `VLC plays every soundtrack; in the browser many films have no sound. Phones, TVs and other
      computers always play in the page. <span class="mono">${esc(vlc.path)}</span>`
    : `VLC is not installed, so everything plays in the browser — where many films have no sound.
      Get it from <a href="https://www.videolan.org/vlc/" target="_blank" rel="noopener">videolan.org</a>
      and it is picked up straight away.`
  grid.append(selectSetting({
    key: 'desktopPlayer',
    title: 'Play on this computer with',
    hint: vlcHint,
    value: config.desktopPlayer,
    options: [
      { value: 'vlc', label: 'VLC' },
      { value: 'browser', label: 'The browser' }
    ]
  }))

  /* ------------------------------------------------------------ TV */

  grid.append(h('<h2 style="margin-top:22px">TV</h2>'))

  const tvPanel = h(`
    <div class="setting" style="align-items:flex-start">
      <div class="label">
        <b>Allow other devices</b>
        <span class="tiny muted">Let your TV, phone or tablet reach StreamHouse over your home
        network. Off means this computer only — which is why a TV cannot find it.</span>
        <div id="tv-address" style="margin-top:12px"></div>
      </div>
      <div class="switch ${network?.reachable ? 'on' : ''}" id="tv-expose"><i></i></div>
    </div>`)
  grid.append(tvPanel)

  function drawAddress (info) {
    const box = tvPanel.querySelector('#tv-address')
    box.innerHTML = ''
    if (!info?.reachable) {
      box.append(h('<div class="tiny muted">Turn this on, then type the address that appears here into your TV\'s web browser.</div>'))
      return
    }
    if (!info.urls?.length) {
      box.append(h('<div class="tiny" style="color:#ff9ba4">No network address found — is this machine connected to your network?</div>'))
      return
    }
    box.append(h(`
      <div>
        <div class="tiny muted" style="margin-bottom:6px">Open this on your TV:</div>
        ${info.urls.map(url => `<div class="mono" style="font-size:22px;font-weight:700;color:#c2b0ff">${esc(url)}</div>`).join('')}
        <div class="tiny muted" style="margin-top:8px">No password — anyone on your network can open it.</div>
      </div>`))
  }
  drawAddress(network)

  tvPanel.querySelector('#tv-expose').addEventListener('click', async event => {
    const toggle = event.currentTarget
    const next = !toggle.classList.contains('on')
    toggle.classList.toggle('on', next)
    try {
      const result = await api.exposeNetwork(next)
      toast(result.note, 'ok')
      // The server rebinds a moment later; read the new state back after that.
      setTimeout(async () => {
        const fresh = await api.network().catch(() => null)
        drawAddress(fresh)
      }, 900)
    } catch (err) {
      toggle.classList.toggle('on', !next)
      toast(err.message, 'err')
    }
  })

  const tvModePanel = h(`
    <div class="setting">
      <div class="label">
        <b>Ten-foot mode</b>
        <span class="tiny muted">Bigger text and remote-control navigation — arrow keys move the
        highlight, OK selects, Back goes back. Detected automatically on smart TVs.</span>
      </div>
      <div class="switch ${document.documentElement.classList.contains('tv') ? 'on' : ''}"><i></i></div>
    </div>`)
  tvModePanel.querySelector('.switch').addEventListener('click', event => {
    const toggle = event.currentTarget
    const next = !toggle.classList.contains('on')
    toggle.classList.toggle('on', next)
    setTvMode(next)
    toast(next ? 'Ten-foot mode on — use the arrow keys' : 'Ten-foot mode off', 'ok')
  })
  grid.append(tvModePanel)

  const castPanel = h(`
    <div class="setting">
      <div class="label">
        <b>Cast to a TV</b>
        <span class="tiny muted">Send video to a DLNA device on your network and use this page as
        the remote. Enable AllShare (Samsung), SmartShare (LG) or Home network (Sony) on the TV first.</span>
      </div>
      <div class="control"><button class="btn" id="cast-scan">Find devices</button></div>
    </div>`)
  castPanel.querySelector('#cast-scan').addEventListener('click', () => castPicker({ title: 'StreamHouse' }))
  grid.append(castPanel)

  /* ------------------------------------------------------- stream ranking */

  grid.append(h('<h2 style="margin-top:22px">Streams</h2>'))

  const chosen = profiles.find(profile => profile.id === config.streamProfile)
  grid.append(selectSetting({
    key: 'streamProfile',
    title: 'Pick streams for',
    hint: chosen?.hint || 'how add-on streams are ranked before you see them',
    value: config.streamProfile,
    options: profiles.map(profile => ({ value: profile.id, label: profile.label }))
  }))
  grid.append(selectSetting({
    key: 'maxResolution',
    title: 'Highest resolution',
    hint: 'anything above this drops to the bottom of the list',
    value: config.maxResolution,
    options: [
      { value: 'any', label: 'No limit' },
      { value: '2160p', label: '2160p (4K)' },
      { value: '1080p', label: '1080p' },
      { value: '720p', label: '720p' },
      { value: '480p', label: '480p' }
    ]
  }))
  grid.append(numberSetting({
    key: 'minSeeders',
    title: 'Fewest seeders',
    hint: 'releases with fewer sink to the bottom — 0 accepts any',
    value: config.minSeeders
  }))
  grid.append(numberSetting({
    key: 'maxStreamSize',
    title: 'Largest file',
    hint: 'GB — 0 means no limit',
    value: config.maxStreamSize
  }))

  grid.append(h('<h2 style="margin-top:22px">Downloads</h2>'))
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
    hint: 'set by the TV switch above — 127.0.0.1 is this computer only, 0.0.0.0 is your whole network',
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

/* --------------------------------------------------------------- profiles */

const SWATCHES = ['#7b5bf5', '#e35d6a', '#3ac47d', '#f5a623', '#3a9ad9', '#d95fb5', '#8a8fa8']

// Netflix's "Manage profiles": each person in the house gets their own
// Continue watching, ticks and library. Add-ons, downloads and these settings
// stay shared.
function profilesPanel () {
  const panel = h(`
    <div class="setting profiles-panel">
      <div class="label"><b>Who watches here</b><span class="tiny muted">Each profile has its own Continue watching, watched episodes and library. With more than one, StreamHouse asks who is watching when it opens.</span></div>
      <div class="profiles"></div>
    </div>`)
  const list = panel.querySelector('.profiles')

  const changed = () => window.dispatchEvent(new Event('viewerschanged'))

  async function draw () {
    let viewers = []
    try { viewers = await api.viewers() } catch (err) { list.textContent = err.message; return }
    list.innerHTML = ''
    for (const viewer of viewers) {
      const row = h(`
        <div class="profile-row">
          ${avatar(viewer, 'lg')}
          <input class="field" value="${esc(viewer.name)}" maxlength="24" aria-label="Name">
          <div class="swatches">${SWATCHES.map(colour => `<button class="swatch${colour === viewer.colour ? ' on' : ''}" style="background:${colour}" data-colour="${colour}" title="Colour"></button>`).join('')}</div>
          ${viewer.id === currentViewer() ? '<span class="tiny muted">watching now</span>' : `<button class="btn small" data-act="use">Switch to</button>`}
          ${viewer.id === MAIN ? '' : '<button class="btn small ghost danger" data-act="remove">Remove</button>'}
        </div>`)
      const name = row.querySelector('input')
      name.addEventListener('change', async () => {
        await api.updateViewer(viewer.id, { name: name.value }).catch(err => toast(err.message, 'err'))
        changed(); draw()
      })
      row.querySelectorAll('.swatch').forEach(swatch => swatch.addEventListener('click', async () => {
        await api.updateViewer(viewer.id, { colour: swatch.dataset.colour }).catch(err => toast(err.message, 'err'))
        changed(); draw()
      }))
      row.querySelector('[data-act="use"]')?.addEventListener('click', () => setViewer(viewer.id))
      row.querySelector('[data-act="remove"]')?.addEventListener('click', async () => {
        const sure = await confirmDialog({
          title: `Remove ${viewer.name}?`,
          body: `<p class="muted">${esc(viewer.name)}’s Continue watching, watched episodes and library go with it, on every device signed in to this account. Nobody else’s are touched.</p>`,
          confirmLabel: 'Remove',
          danger: true
        })
        if (!sure) return
        await api.removeViewer(viewer.id).catch(err => toast(err.message, 'err'))
        if (viewer.id === currentViewer()) setViewer(MAIN)
        changed(); draw()
      })
      list.append(row)
    }
    if (viewers.length < 6) {
      const add = h(`
        <form class="profile-row add">
          <span class="avatar lg" style="background:var(--surface-strong)">＋</span>
          <input class="field" placeholder="Add a profile — a name" maxlength="24" aria-label="New profile name">
          <button class="btn small primary">Add</button>
        </form>`)
      add.addEventListener('submit', async event => {
        event.preventDefault()
        const input = add.querySelector('input')
        if (!input.value.trim()) return
        try {
          await api.addViewer({ name: input.value.trim() })
          toast(`${input.value.trim()} added`, 'ok')
        } catch (err) {
          toast(err.message, 'err')
        }
        changed(); draw()
      })
      list.append(add)
    }
  }
  draw()
  return panel
}
