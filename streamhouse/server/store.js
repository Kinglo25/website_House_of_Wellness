import fs from 'fs'
import path from 'path'
import { DATA_DIR, ensureDir } from './paths.js'

// Tiny JSON-file store. Writes are atomic (write to .tmp then rename) and
// debounced so a chatty caller cannot thrash the disk.
export class JsonStore {
  constructor (name, fallback) {
    this.file = path.join(ensureDir(DATA_DIR), `${name}.json`)
    this.fallback = fallback
    this.data = this._read()
    this._timer = null
  }

  _read () {
    try {
      const raw = fs.readFileSync(this.file, 'utf8')
      const parsed = JSON.parse(raw)
      if (Array.isArray(this.fallback) && !Array.isArray(parsed)) return structuredClone(this.fallback)
      if (!Array.isArray(this.fallback) && typeof parsed !== 'object') return structuredClone(this.fallback)
      return parsed
    } catch {
      return structuredClone(this.fallback)
    }
  }

  get () {
    return this.data
  }

  set (data) {
    this.data = data
    this.save()
    return this.data
  }

  save () {
    if (this._timer) return
    this._timer = setTimeout(() => {
      this._timer = null
      this.flush()
    }, 250)
    if (this._timer.unref) this._timer.unref()
  }

  flush () {
    if (this._timer) {
      clearTimeout(this._timer)
      this._timer = null
    }
    const tmp = `${this.file}.tmp`
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2))
      fs.renameSync(tmp, this.file)
    } catch (err) {
      console.error(`[store] could not write ${this.file}:`, err.message)
    }
  }
}
