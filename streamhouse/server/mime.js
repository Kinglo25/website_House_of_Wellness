import path from 'path'

const TYPES = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.ts': 'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.srt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
}

export function mimeFor (name = '') {
  return TYPES[path.extname(name).toLowerCase()] || 'application/octet-stream'
}

// Browsers can only play what their decoders support; anything else has to be
// handed to an external player, so the UI needs to know which is which.
export function isBrowserPlayable (name = '') {
  return ['.mp4', '.m4v', '.webm', '.ogv'].includes(path.extname(name).toLowerCase())
}

// The bytes a Range header asks for, as inclusive offsets into a file of `total`
// bytes, or null when none of them exist. "bytes=-500" is the last 500 bytes, not
// the first 501: players seek to the end that way to read an index stored there.
export function byteRange (header, total) {
  const match = /bytes=(\d*)-(\d*)/.exec(header || '')
  if (!match || (!match[1] && !match[2])) return { start: 0, end: total - 1 }
  if (!match[1]) {
    const suffix = parseInt(match[2], 10)
    if (!suffix || !total) return null
    return { start: Math.max(0, total - suffix), end: total - 1 }
  }
  const start = parseInt(match[1], 10)
  if (start >= total) return null
  let end = match[2] ? parseInt(match[2], 10) : total - 1
  if (end >= total || end < start) end = total - 1
  return { start, end }
}

// Minimal SubRip -> WebVTT conversion so <track> can use add-on subtitles.
export function srtToVtt (srt = '') {
  const body = String(srt)
    .replace(/\r+/g, '')
    .replace(/^﻿/, '')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
  return `WEBVTT\n\n${body}`
}
