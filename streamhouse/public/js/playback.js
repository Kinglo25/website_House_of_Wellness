/* Turning "play this" into a player URL.
 *
 * Picking a stream for a title, starting its torrent and working out which
 * episode comes next are all needed in more than one place — the title page
 * plays an episode, the player queues up the one after it — so they live here
 * rather than in either view. */

import { api } from './api.js'

// Specials (season 0) are not part of the running order unless that is all the
// series has — the same rule the episode list on the title page uses.
export function orderedEpisodes (series) {
  const videos = (series?.videos || []).filter(video => video.id)
  const regular = videos.filter(video => video.season !== 0)
  return (regular.length ? regular : videos)
    .slice()
    .sort((a, b) => (a.season - b.season) || (a.episode - b.episode))
}

// The episode that follows the one being watched, if the series has one.
// `meta` is the player's metadata: the series id plus which episode it is.
export async function nextEpisode (meta) {
  if (meta?.type !== 'series') return null
  const seriesId = meta.imdbId || String(meta.videoId || '').split(':')[0]
  if (!seriesId) return null

  let series
  try {
    series = await api.meta('series', seriesId)
  } catch {
    return null
  }

  const episodes = orderedEpisodes(series)
  const index = episodes.findIndex(video => (
    video.id === meta.videoId ||
    (Number(video.season) === Number(meta.season) && Number(video.episode) === Number(meta.episode))
  ))
  const video = index >= 0 ? episodes[index + 1] : null
  if (!video) return null

  return {
    video,
    series,
    label: `S${video.season}E${video.episode}`,
    title: video.name || video.title || `Episode ${video.episode}`,
    poster: video.thumbnail || series.poster || ''
  }
}

// The stream to play when nobody has picked one by hand. The server ranks them
// best-first for the quality profile, so this is that decision, honoured.
export async function bestStream (type, videoId) {
  const streams = await api.streams(type, videoId)
  return streams.find(stream => stream.infoHash || stream.url) || null
}

// Start `stream` and return the player URL for it. Torrents have to be handed
// to the engine first; a direct URL only needs passing along.
export async function playerHref (stream, playbackMeta) {
  const meta = encodeURIComponent(JSON.stringify(playbackMeta))
  if (stream.infoHash) {
    const record = await api.addTorrent({
      infoHash: stream.infoHash,
      sources: stream.sources || [],
      fileIdx: stream.fileIdx ?? null,
      mode: 'stream',
      meta: playbackMeta
    })
    return `#/player/torrent/${encodeURIComponent(record.id)}?fileIdx=${stream.fileIdx ?? ''}&meta=${meta}`
  }
  if (stream.url) return `#/player/direct/x?src=${encodeURIComponent(stream.url)}&meta=${meta}`
  return ''
}

// Everything at once: find the best stream for an episode and get its player
// URL, with the metadata the player needs to name it and remember it.
export async function episodeHref (next, meta) {
  const playbackMeta = {
    title: `${next.series.name || meta.seriesName || ''} ${next.label}`.trim(),
    poster: next.series.poster || meta.poster || '',
    type: 'series',
    imdbId: next.series.imdb_id || next.series.id || meta.imdbId,
    videoId: next.video.id,
    season: next.video.season,
    episode: next.video.episode
  }
  const stream = await bestStream('series', next.video.id)
  if (!stream) throw new Error(`No add-on has a stream for ${next.label}`)
  const href = await playerHref(stream, playbackMeta)
  if (!href) throw new Error(`${next.label} has nothing playable attached`)
  return href
}
