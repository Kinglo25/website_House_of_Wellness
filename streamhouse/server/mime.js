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

// Minimal SubRip -> WebVTT conversion so <track> can use add-on subtitles.
export function srtToVtt (srt = '') {
  const body = String(srt)
    .replace(/\r+/g, '')
    .replace(/^﻿/, '')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
  return `WEBVTT\n\n${body}`
}
