import os from 'os'
import path from 'path'
import fs from 'fs'

// Everything the app persists lives under one directory so it is easy to back
// up or wipe. Override with STREAMHOUSE_DIR when running several instances.
export const DATA_DIR = process.env.STREAMHOUSE_DIR
  ? path.resolve(process.env.STREAMHOUSE_DIR)
  : path.join(os.homedir(), '.streamhouse')

export const DEFAULT_DOWNLOAD_DIR = process.env.STREAMHOUSE_DOWNLOADS
  ? path.resolve(process.env.STREAMHOUSE_DOWNLOADS)
  : path.join(os.homedir(), 'Downloads', 'StreamHouse')

export function ensureDir (dir) {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

ensureDir(DATA_DIR)
