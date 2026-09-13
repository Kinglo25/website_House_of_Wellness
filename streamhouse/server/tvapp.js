/* Updates for the sideloaded Android TV app.
 *
 * A sideloaded app has no store behind it, so the TV asks the StreamHouse
 * server it is already talking to: the server is the machine with a dependable
 * internet connection and a modern TLS stack — TV boxes often have neither —
 * and asking it means no release URL has to be baked into the APK.
 *
 * CI publishes two assets on the rolling `tv-latest` release: the APK, and a
 * tv-version.json describing it. */

import { Readable } from 'stream'
import { config } from './config.js'

const CACHE_MS = 15 * 60 * 1000
const APK_ASSET = 'streamhouse-tv.apk'
const VERSION_ASSET = 'tv-version.json'

let cache = { at: 0, value: null }

async function get (url, accept) {
  const response = await fetch(url, {
    headers: { Accept: accept, 'User-Agent': 'StreamHouse' },
    redirect: 'follow'
  })
  if (!response.ok) throw new Error(`${new URL(url).host} returned ${response.status}`)
  return response
}

function assetUrl (release, name) {
  return (release.assets || []).find(asset => asset.name === name)?.browser_download_url || null
}

// What the newest published build is. Cached: a TV asking on every start should
// not mean a GitHub request on every start.
export async function latest ({ refresh = false } = {}) {
  if (!refresh && cache.value && Date.now() - cache.at < CACHE_MS) return cache.value

  const release = await (await get(config.get().tvReleaseApi, 'application/vnd.github+json')).json()
  const versionUrl = assetUrl(release, VERSION_ASSET)
  const apkUrl = assetUrl(release, APK_ASSET)
  if (!apkUrl) throw new Error(`The ${release.tag_name || 'tv-latest'} release has no ${APK_ASSET}`)
  if (!versionUrl) throw new Error(`The ${release.tag_name || 'tv-latest'} release predates in-app updates`)

  const described = await (await get(versionUrl, 'application/json')).json()
  const value = {
    versionCode: Number(described.versionCode) || 0,
    versionName: described.versionName || '',
    commit: described.commit || '',
    builtAt: described.builtAt || release.published_at || null,
    size: (release.assets || []).find(asset => asset.name === APK_ASSET)?.size || 0,
    downloadUrl: apkUrl
  }
  cache = { at: Date.now(), value }
  return value
}

// The APK itself, passed through rather than redirected to: the TV then needs
// nothing but this server, over plain HTTP on the local network.
export async function pipeApk (res) {
  const { downloadUrl, size, versionName } = await latest()
  const upstream = await get(downloadUrl, 'application/octet-stream')
  res.writeHead(200, {
    'Content-Type': 'application/vnd.android.package-archive',
    'Content-Disposition': `attachment; filename="${APK_ASSET}"`,
    'Cache-Control': 'no-store',
    'X-StreamHouse-Version': versionName,
    ...(size ? { 'Content-Length': size } : {})
  })
  Readable.fromWeb(upstream.body).pipe(res)
}
