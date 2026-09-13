/* Stream ranking — a quality profile, in the Sonarr sense.
 *
 * Sonarr never makes you pick a release by hand: you declare what you want
 * ("1080p, WEB-DL or better, nothing I can't play"), it runs every candidate
 * past a list of independent checks, throws out the ones that fail and sorts
 * what is left. This is the same shape, scaled down to three profiles and a
 * handful of checks.
 *
 * The profile that matters most here is `compatible`. StreamHouse's own README
 * warns that browsers decode almost nothing — MKV not at all, H.265 usually
 * not, AC3/DTS audio never — so "best" is not the biggest file: it is the best
 * file the thing you are watching on can actually decode.
 */

import { parseStream, qualityLabel, SOURCE_LABELS, CODEC_LABELS, AUDIO_LABELS } from './parse.js'

export const PROFILES = {
  compatible: {
    label: 'Plays anywhere',
    hint: 'H.264 in MP4 with AAC — what a browser tab and a Chromecast decode without help',
    sourceWeight: 60,
    codec: { h264: 220, vp9: 20, hevc: -260, av1: -300, xvid: -90, divx: -90, mpeg2: -60 },
    container: { mp4: 140, webm: 70, mkv: -170, avi: -220 },
    audio: { aac: 70, opus: 50, mp3: 40, flac: -40, ac3: -120, eac3: -120, dts: -160, 'dts-hd': -170, 'dts-x': -170, truehd: -180, atmos: -180 },
    dynamicRange: { dv: -170, 'hdr10+': -70, hdr10: -60, hdr: -60, hlg: -60 }
  },
  balanced: {
    label: 'Balanced',
    hint: 'good picture, but nudged towards files most devices in the house can play',
    sourceWeight: 80,
    codec: { h264: 60, hevc: -70, av1: -90, xvid: -60, divx: -60, mpeg2: -40 },
    container: { mp4: 50, mkv: -25, avi: -120 },
    audio: { aac: 30, opus: 20, dts: -30, 'dts-hd': -30, 'dts-x': -30, truehd: -40, atmos: -40 },
    dynamicRange: { dv: -50 }
  },
  quality: {
    label: 'Best picture',
    hint: 'picture first — for the Android TV app, casting, or anything that plays MKV properly',
    sourceWeight: 130,
    codec: { hevc: 40, av1: 20, xvid: -120, divx: -120, mpeg2: -100 },
    container: { avi: -100 },
    audio: { atmos: 50, truehd: 40, 'dts-hd': 40, 'dts-x': 40, mp3: -40 },
    dynamicRange: { dv: 70, 'hdr10+': 60, hdr10: 50, hdr: 40, hlg: 20 }
  }
}

export const RESOLUTION_RANK = { '2160p': 4, '1080p': 3, '720p': 2, '576p': 1, '480p': 1 }
export const SOURCE_RANK = { remux: 5, bluray: 4, 'web-dl': 3, webrip: 2, hdrip: 2, hdtv: 1, dvd: 1 }

// Below these a file is a trailer, a sample or a bad re-encode, whatever its
// name claims. Deliberately generous — a 22-minute episode is a small file.
const SIZE_FLOOR = { '2160p': 900 * 1024 ** 2, '1080p': 250 * 1024 ** 2, '720p': 120 * 1024 ** 2 }

const RESOLUTION_ORDER = ['480p', '576p', '720p', '1080p', '2160p']

export function normalizeProfile (settings = {}) {
  const name = String(settings.streamProfile || '').toLowerCase()
  const maxResolution = String(settings.maxResolution || 'any').toLowerCase()
  return {
    name: PROFILES[name] ? name : 'balanced',
    weights: PROFILES[name] || PROFILES.balanced,
    maxResolution: RESOLUTION_ORDER.includes(maxResolution) ? maxResolution : 'any',
    minSeeders: Math.max(0, Number(settings.minSeeders) || 0),
    maxStreamSize: Math.max(0, Number(settings.maxStreamSize) || 0)   // GB
  }
}

/* Score one parsed release. Returns the score plus the reasons behind it, so
 * the UI can answer "why is this one at the top?" instead of asking for trust. */
export function scoreRelease (quality, options = {}) {
  const { weights, maxResolution, minSeeders, maxStreamSize } = normalizeProfile(options)
  const reasons = []
  const rejections = []
  let score = 0

  const add = (delta, label) => {
    if (!delta) return
    score += delta
    reasons.push({ label, delta })
  }

  /* ------------------------------------------------------------ resolution */

  const resolutionRank = RESOLUTION_RANK[quality.resolution] || 0
  if (quality.resolution) {
    add(resolutionRank * 300, quality.resolution)
    if (maxResolution !== 'any' && RESOLUTION_ORDER.indexOf(quality.resolution) > RESOLUTION_ORDER.indexOf(maxResolution)) {
      rejections.push(`${quality.resolution} is above your ${maxResolution} limit`)
    }
  } else {
    add(-60, 'quality not stated')
  }

  /* ---------------------------------------------------------------- source */

  if (quality.source === 'cam') rejections.push('cam or telesync rip')
  else if (quality.source) add((SOURCE_RANK[quality.source] || 0) * weights.sourceWeight, SOURCE_LABELS[quality.source])

  /* ----------------------------------------------- what can actually play it */

  add(weights.codec[quality.codec] || 0, CODEC_LABELS[quality.codec])
  add(weights.container[quality.container] || 0, quality.container)
  add(weights.audio[quality.audio] || 0, AUDIO_LABELS[quality.audio])
  add(weights.dynamicRange[quality.dynamicRange] || 0, quality.dynamicRange?.toUpperCase())

  /* -------------------------------------------------------------- swarm */

  if (quality.seeders != null) {
    if (minSeeders && quality.seeders < minSeeders) {
      rejections.push(`only ${quality.seeders} seeder${quality.seeders === 1 ? '' : 's'}`)
    }
    // Diminishing returns: 4 seeders vs 2 matters, 400 vs 200 does not.
    add(Math.round(Math.log2(Math.min(quality.seeders, 500) + 1) * 45), `${quality.seeders} seeders`)
  }

  /* ---------------------------------------------------------------- size */

  if (quality.size) {
    if (maxStreamSize && quality.size > maxStreamSize * 1024 ** 3) {
      rejections.push(`larger than your ${maxStreamSize} GB limit`)
    }
    const floor = SIZE_FLOOR[quality.resolution]
    if (floor && quality.size < floor) add(-200, `small for ${quality.resolution}`)
  }

  /* ------------------------------------------------------------- revision */

  if (quality.proper) add(60, 'proper')
  if (quality.repack) add(60, 'repack')
  if (quality.sample) rejections.push('sample')

  return { score, reasons: reasons.filter(reason => reason.label), rejections }
}

/* Rank a list of annotated add-on streams, best first.
 *
 * Nothing is hidden: rejected releases sink to the bottom carrying the reason
 * they were rejected, because the add-on list is sometimes all you have and a
 * cam rip you chose knowingly beats an empty page.
 */
export function rankStreams (streams = [], settings = {}) {
  const options = normalizeProfile(settings)

  const scored = streams.map(stream => {
    const quality = parseStream(stream)
    const { score, reasons, rejections } = scoreRelease(quality, settings)
    return {
      ...stream,
      quality: {
        ...quality,
        label: qualityLabel(quality),
        // Display spellings live with the parser, so the UI never has to keep
        // its own copy of "eac3 means DD+".
        sourceLabel: SOURCE_LABELS[quality.source] || null,
        codecLabel: CODEC_LABELS[quality.codec] || null,
        audioLabel: AUDIO_LABELS[quality.audio] || null
      },
      score,
      scoreReasons: reasons,
      rejections
    }
  })

  // Sort is stable in Node, so equal scores keep the order the add-ons were
  // in — which is the priority the user set on the Add-ons page.
  scored.sort((a, b) => {
    if (Boolean(a.rejections.length) !== Boolean(b.rejections.length)) return a.rejections.length ? 1 : -1
    return b.score - a.score
  })

  const best = scored.find(stream => !stream.rejections.length)
  if (best) best.best = true

  return scored.map(stream => ({ ...stream, profile: options.name }))
}
