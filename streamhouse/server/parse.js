/* Release parsing.
 *
 * Add-ons hand back free text, not fields. A typical stream looks like:
 *
 *   name:  "Torrentio\n1080p"
 *   title: "Show.Name.S01E02.1080p.WEB-DL.DDP5.1.H.264-NTb\n👤 47 💾 2.31 GB ⚙️ ThePirateBay"
 *
 * Everything worth deciding on — resolution, where it was ripped from, the
 * codec, whether your browser can decode the audio, how many peers are on it —
 * is buried in that string. This turns it into fields the ranker can compare.
 *
 * The categories follow the ones Sonarr splits releases into (resolution,
 * source, codec, revision, release group); the implementation is our own.
 */

const VIDEO_EXTENSION = /\.(?:mkv|mp4|avi|mov|m4v|webm|wmv|flv|mpe?g|m2ts|ts|ogv)$/i

// Matchers run in order and the first hit wins, so the specific ones
// ("web-rip", "dts-hd") have to sit above the general ones ("web", "dts").
const RESOLUTIONS = [
  ['2160p', /\b(?:2160[pi]?|4k|uhd|3840\s?x\s?2160)\b/i],
  ['1080p', /\b(?:1080[pi]|1920\s?x\s?1080|fhd)\b/i],
  ['720p', /\b(?:720[pi]|1280\s?x\s?720)\b/i],
  ['576p', /\b576[pi]\b/i],
  ['480p', /\b(?:480[pi]|640\s?x\s?480)\b/i]
]

const SOURCES = [
  ['remux', /\bre-?mux\b/i],
  ['bluray', /\b(?:blu-?ray|bd-?rip|br-?rip|bdmv|bd(?:25|50))\b/i],
  ['webrip', /\bweb-?rip\b/i],
  ['web-dl', /\b(?:web-?dl|\bweb\b|amzn|nf|dsnp|hmax|atvp|itunes)\b/i],
  ['hdrip', /\bhd-?rip\b/i],
  ['hdtv', /\b(?:hd-?tv|pdtv|dsr|dvbrip)\b/i],
  ['dvd', /\b(?:dvd-?rip|dvd-?r|dvd[59]|\bdvd\b)\b/i],
  // Last, so an explicit WEB-DL or BluRay tag always wins over a loose "TS".
  ['cam', /\b(?:cam-?rip|\bcam\b|hd-?cam|tele-?sync|hd-?ts|\bts\b|tele-?cine|screener|dvd-?scr|\bscr\b|\br5\b)\b/i]
]

const CODECS = [
  ['hevc', /\b(?:x\.?\s?265|h\.?\s?265|hevc)\b/i],
  ['h264', /\b(?:x\.?\s?264|h\.?\s?264|avc)\b/i],
  ['av1', /\bav1\b/i],
  ['vp9', /\bvp9\b/i],
  ['xvid', /\bxvid\b/i],
  ['divx', /\bdivx\b/i],
  ['mpeg2', /\bmpe?g-?2\b/i]
]

const AUDIO = [
  ['atmos', /\batmos\b/i],
  ['truehd', /\btrue-?hd\b/i],
  ['dts-x', /\bdts-?x\b/i],
  ['dts-hd', /\bdts-?hd(?:-?ma)?\b/i],
  ['dts', /\bdts\b/i],
  // No trailing \b: these run straight into their channel count ("DDP5.1").
  ['eac3', /\b(?:e-?ac-?3|eac3|ddp|dd\+)/i],
  ['ac3', /\b(?:ac-?3|dd)(?![a-z])/i],
  ['flac', /\bflac\b/i],
  ['opus', /\bopus\b/i],
  ['aac', /\baac(?![a-z])/i],
  ['mp3', /\bmp3\b/i]
]

const DYNAMIC_RANGE = [
  ['dv', /\b(?:dolby[-_. ]?vision|dovi|dv)\b/i],
  ['hdr10+', /\b(?:hdr10\+|hdr10plus)\b/i],
  ['hdr10', /\bhdr10\b/i],
  ['hdr', /\bhdr\b/i],
  ['hlg', /\bhlg\b/i]
]

const EDITIONS = [
  ['extended', /\bextended(?:[-_. ]cut)?\b/i],
  ['remastered', /\bre-?mastered\b/i],
  ["director's cut", /\bdirectors?'?[-_. ]cut\b/i],
  ['imax', /\bimax\b/i],
  ['uncut', /\buncut\b/i],
  ['unrated', /\bunrated\b/i],
  ['criterion', /\bcriterion\b/i],
  ['theatrical', /\btheatrical\b/i]
]

// Tokens that turn up at the end of a release name but are never the group.
const NOT_A_GROUP = /^(?:\d+|\d+p|mkv|mp4|avi|x?26[45]|hevc|avc|aac|ac3|dts|web|dl|rip|hdtv|bluray|remux|hdr|sdr|multi|dual|repack|proper)$/i

function firstMatch (matchers, text) {
  for (const [value, pattern] of matchers) {
    if (pattern.test(text)) return value
  }
  return null
}

/* ------------------------------------------------------------------ sizes */

const SIZE_UNITS = { kb: 1024, kib: 1024, mb: 1024 ** 2, mib: 1024 ** 2, gb: 1024 ** 3, gib: 1024 ** 3, tb: 1024 ** 4, tib: 1024 ** 4 }

export function parseSize (text) {
  const match = /(\d+(?:[.,]\d+)?)\s*(kib|kb|mib|mb|gib|gb|tib|tb)\b/i.exec(text || '')
  if (!match) return null
  const amount = Number(match[1].replace(',', '.'))
  if (!Number.isFinite(amount) || amount <= 0) return null
  return Math.round(amount * SIZE_UNITS[match[2].toLowerCase()])
}

// 👤 47 · "Seeders: 47" · "47 seeders". Add-ons are not consistent about it.
export function parseSeeders (text) {
  const value = String(text || '')
  const emoji = /[\u{1F464}\u{1F465}]\s*(\d[\d.,]*)/u.exec(value)
  if (emoji) return Number(emoji[1].replace(/[.,]/g, ''))
  const labelled = /\bseed(?:er)?s?\b\s*[:=]?\s*(\d[\d.,]*)/i.exec(value)
  if (labelled) return Number(labelled[1].replace(/[.,]/g, ''))
  const trailing = /(\d[\d.,]*)\s*\bseed(?:er)?s?\b/i.exec(value)
  if (trailing) return Number(trailing[1].replace(/[.,]/g, ''))
  return null
}

/* ----------------------------------------------------------- release group */

export function parseGroup (name) {
  // Cut the add-on's own stat line ("👤 47 💾 2.31 GB") off the end first.
  const line = String(name || '').split('\n')[0].split(/[\u{1F464}\u{1F465}\u{1F4BE}\u2699]/u)[0]
    .trim().replace(VIDEO_EXTENSION, '')
  const bracketed = /[[(]([A-Za-z][\w.-]{1,20})[\])]\s*$/.exec(line)
  if (bracketed && !NOT_A_GROUP.test(bracketed[1])) return bracketed[1]
  const trailing = /-([A-Za-z][\w.]{1,20})\s*$/.exec(line)
  if (trailing && !NOT_A_GROUP.test(trailing[1])) return trailing[1]
  return null
}

/* ---------------------------------------------------------------- episodes */

function parseEpisode (text) {
  const standard = /\bs(\d{1,2})[\s._-]?e(\d{1,3})\b/i.exec(text)
  if (standard) return { season: Number(standard[1]), episode: Number(standard[2]), seasonPack: false }

  const alternate = /\b(\d{1,2})x(\d{1,2})\b/.exec(text)
  if (alternate) return { season: Number(alternate[1]), episode: Number(alternate[2]), seasonPack: false }

  const pack = /\b(?:season[\s._-]?(\d{1,2})|s(\d{1,2}))\b(?![\s._-]?e?\d)/i.exec(text)
  if (pack) return { season: Number(pack[1] || pack[2]), episode: null, seasonPack: true }

  return { season: null, episode: null, seasonPack: false }
}

/* ------------------------------------------------------------------- main */

/* Parse one add-on stream into comparable fields. Pass the whole stream
 * object — the useful text is spread across `name`, `title`, `description`
 * and `behaviorHints`, and no two add-ons agree on which. */
export function parseStream (stream = {}) {
  const name = String(stream.name || '')
  const title = String(stream.title || stream.description || '')
  const filename = String(stream.behaviorHints?.filename || '')
  const text = [name, title, filename].filter(Boolean).join(' ')

  // The release name is the longest line we were given: add-ons put their own
  // branding in `name` and the actual release in the first line of `title`.
  const releaseName = [filename, ...title.split('\n'), ...name.split('\n')]
    .map(line => line.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0] || ''

  const container = (VIDEO_EXTENSION.exec(filename) || VIDEO_EXTENSION.exec(releaseName) || [])[0]

  // A file extension is not a source: without this, anything named ".ts" reads
  // as a telesync and gets thrown out as a cam rip.
  const scrubbed = text.replace(/\.(?:mkv|mp4|avi|mov|m4v|webm|wmv|flv|mpe?g|m2ts|ts|ogv)\b/gi, ' ')

  // "DDP5.1" has no word boundary before the 5, so \b is no use here.
  const channels = (/(?<!\d)([2571])\.([01])(?!\d)/.exec(scrubbed) || [])[0] || null
  // Torrentio and friends name the tracker a release came from after a ⚙.
  const provider = (/⚙️?\s*([^\n|·]{2,30})/.exec(text) || [])[1]?.trim() || null

  return {
    releaseName,
    resolution: firstMatch(RESOLUTIONS, scrubbed),
    source: firstMatch(SOURCES, scrubbed),
    codec: firstMatch(CODECS, scrubbed),
    audio: firstMatch(AUDIO, scrubbed),
    channels,
    dynamicRange: firstMatch(DYNAMIC_RANGE, scrubbed),
    edition: firstMatch(EDITIONS, scrubbed),
    container: container ? container.slice(1).toLowerCase() : null,
    group: parseGroup(releaseName),
    provider,
    proper: /\bproper\b/i.test(scrubbed),
    repack: /\b(?:repack\d?|re-?rip\d?)\b/i.test(scrubbed),
    multi: /\b(?:multi|dual[\s._-]?audio)\b/i.test(scrubbed),
    dubbed: /\bdub(?:bed)?\b/i.test(scrubbed),
    sample: /\bsample\b/i.test(scrubbed),
    seeders: parseSeeders(text),
    size: Number(stream.behaviorHints?.videoSize) || parseSize(text),
    ...parseEpisode(scrubbed)
  }
}

/* -------------------------------------------------------- what was asked for */

/* Stremio addresses an episode as "<series id>:<season>:<episode>", so the id
 * the UI already passes tells us which episode the streams are supposed to be.
 * Returns nulls for a movie id, which means "nothing to check against". */
export function parseVideoId (id) {
  const parts = String(id || '').split(':')
  if (parts.length < 3) return { season: null, episode: null }
  const season = Number(parts[parts.length - 2])
  const episode = Number(parts[parts.length - 1])
  if (!Number.isInteger(season) || !Number.isInteger(episode)) return { season: null, episode: null }
  return { season, episode }
}

/* Add-on metadata states runtime as free text: "142 min", "58min", "1h 30min".
 * Minutes, or null when it says nothing usable. */
export function parseRuntime (text) {
  const value = String(text || '')
  const hoursAndMinutes = /(\d+)\s*h(?:ours?)?[\s.]*(\d+)?\s*m?/i.exec(value)
  if (hoursAndMinutes) return Number(hoursAndMinutes[1]) * 60 + Number(hoursAndMinutes[2] || 0)
  const minutes = /(\d+)\s*(?:min|m\b)/i.exec(value)
  if (minutes) return Number(minutes[1])
  const bare = /^\s*(\d{1,4})\s*$/.exec(value)
  if (bare) return Number(bare[1])
  return null
}

/* A short human label: "1080p WEB-DL · H.264". Used for the badge row. */
export function qualityLabel (quality) {
  return [quality.resolution, SOURCE_LABELS[quality.source] || quality.source]
    .filter(Boolean)
    .join(' ') || 'Unknown quality'
}

export const SOURCE_LABELS = {
  remux: 'Remux',
  bluray: 'BluRay',
  'web-dl': 'WEB-DL',
  webrip: 'WEBRip',
  hdrip: 'HDRip',
  hdtv: 'HDTV',
  dvd: 'DVD',
  cam: 'CAM'
}

export const CODEC_LABELS = {
  hevc: 'H.265',
  h264: 'H.264',
  av1: 'AV1',
  vp9: 'VP9',
  xvid: 'XviD',
  divx: 'DivX',
  mpeg2: 'MPEG-2'
}

export const AUDIO_LABELS = {
  atmos: 'Atmos',
  truehd: 'TrueHD',
  'dts-x': 'DTS:X',
  'dts-hd': 'DTS-HD',
  dts: 'DTS',
  eac3: 'DD+',
  ac3: 'DD',
  flac: 'FLAC',
  opus: 'Opus',
  aac: 'AAC',
  mp3: 'MP3'
}
