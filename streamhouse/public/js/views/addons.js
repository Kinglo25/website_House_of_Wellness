import { api } from '../api.js'
import { h, esc, toast, confirmDialog } from '../util.js'

// Add-ons are the only thing that supply catalogues, metadata and streams, so
// this page is where a fresh install actually becomes useful.
export default async function addonsView ({ container }) {
  container.innerHTML = '<div class="pad" id="addons"></div>'
  const root = container.querySelector('#addons')

  root.append(h(`
    <h1>Add-ons</h1>
    <p class="muted" style="margin-top:0;max-width:720px">
      StreamHouse speaks the Stremio add-on protocol. Paste the manifest URL of any add-on you
      have the right to use and its catalogues, metadata and streams appear across the app.
      Nothing is bundled beyond the public Cinemeta metadata add-on.
    </p>`))

  const form = h(`
    <div class="toolbar">
      <input class="field" id="addon-url" style="flex:1;min-width:300px" placeholder="https://example.com/manifest.json">
      <button class="btn primary" id="addon-install">Install</button>
      <button class="btn" id="addon-refresh">↻ Refresh all</button>
    </div>`)
  root.append(form)

  const list = h('<div class="dl-table"></div>')
  root.append(list)

  async function install () {
    const input = root.querySelector('#addon-url')
    const url = input.value.trim()
    if (!url) return
    const button = root.querySelector('#addon-install')
    button.disabled = true
    button.textContent = 'Installing…'
    try {
      const addon = await api.installAddon(url)
      toast(`Installed ${addon.manifest?.name || 'add-on'}`, 'ok')
      input.value = ''
      await draw()
    } catch (err) {
      toast(err.message, 'err')
    } finally {
      button.disabled = false
      button.textContent = 'Install'
    }
  }

  root.querySelector('#addon-install').addEventListener('click', install)
  root.querySelector('#addon-url').addEventListener('keydown', event => {
    if (event.key === 'Enter') install()
  })
  root.querySelector('#addon-refresh').addEventListener('click', async () => {
    await draw(true)
    toast('Manifests refreshed', 'ok')
  })

  async function draw (refresh = false) {
    list.innerHTML = '<p class="muted">Loading…</p>'
    let addons = []
    try {
      addons = await api.addons(refresh)
    } catch (err) {
      list.innerHTML = ''
      return list.append(h(`<div class="error-box">${esc(err.message)}</div>`))
    }
    list.innerHTML = ''

    addons.forEach((addon, index) => {
      const manifest = addon.manifest
      const id = manifest?.id || addon.transportUrl
      const resources = (manifest?.resources || []).map(entry => (typeof entry === 'string' ? entry : entry.name))
      const node = h(`
        <div class="addon">
          <div class="logo" style="${manifest?.logo ? `background-image:url('${esc(manifest.logo)}')` : ''}">${manifest?.logo ? '' : esc((manifest?.name || '?').trim().charAt(0).toUpperCase())}</div>
          <div style="flex:1;min-width:0">
            <div class="row"><b>${esc(manifest?.name || addon.transportUrl)}</b>
              <span class="tiny muted">v${esc(manifest?.version || '?')}</span>
              ${addon.enabled === false ? '<span class="chip static tiny">disabled</span>' : ''}
            </div>
            <div class="tiny muted" style="margin-top:4px">${esc(manifest?.description || '')}</div>
            <div class="types">
              ${resources.map(resource => `<span class="chip static tiny">${esc(resource)}</span>`).join('')}
              ${(manifest?.types || []).map(type => `<span class="chip static tiny">${esc(type)}</span>`).join('')}
            </div>
            ${addon.error ? `<div class="tiny" style="color:#ff9ba4;margin-top:6px">${esc(addon.error)}</div>` : ''}
            <div class="tiny muted mono" style="margin-top:6px;word-break:break-all">${esc(addon.transportUrl)}</div>
          </div>
          <div class="actions row">
            <button class="btn small ghost" data-act="up" ${index === 0 ? 'disabled' : ''} title="Higher priority">↑</button>
            <button class="btn small" data-act="toggle">${addon.enabled === false ? 'Enable' : 'Disable'}</button>
            <button class="btn small danger" data-act="remove">Remove</button>
          </div>
        </div>`)

      node.querySelector('[data-act="toggle"]').addEventListener('click', async () => {
        await api.toggleAddon(id, addon.enabled === false)
        await draw()
      })

      node.querySelector('[data-act="up"]').addEventListener('click', async () => {
        const ids = addons.map(entry => entry.manifest?.id || entry.transportUrl)
        ;[ids[index - 1], ids[index]] = [ids[index], ids[index - 1]]
        await api.reorderAddons(ids)
        toast('Priority updated — streams from higher add-ons are listed first', 'ok')
        await draw()
      })

      node.querySelector('[data-act="remove"]').addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: 'Remove add-on?',
          danger: true,
          confirmLabel: 'Remove',
          body: `<p>“${esc(manifest?.name || id)}” will stop providing catalogues and streams.</p>`
        })
        if (!ok) return
        await api.removeAddon(id)
        toast('Add-on removed', 'ok')
        await draw()
      })

      list.append(node)
    })

    if (!addons.length) {
      list.append(h('<div class="empty"><h2>No add-ons installed</h2><p>Paste a manifest URL above to get started.</p></div>'))
    }
  }

  await draw()
}
