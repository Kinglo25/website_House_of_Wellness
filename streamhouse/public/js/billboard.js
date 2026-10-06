/* Home's billboard: a handful of titles to choose from, one shown at a time.
 *
 * Which titles is taste.js's mixSlides: your For you picks and each
 * catalogue's best, films and series, of different genres. The others wait as
 * thumbnails beside it. Pick one, or leave it to move on by itself every few
 * seconds, as Netflix's and Prime Video's do. It holds still while the pointer
 * or the remote is on it, and for good once you choose. */

import { api } from './api.js'
import { h, esc } from './util.js'
import { detailHref } from './components.js'
import { mixSlides } from './taste.js'

const MAX_SLIDES = 8
const ROTATE_MS = 9000
const TICK_MS = 250
// A slow picture is not waited for past this; the next one is fetched early.
const ART_WAIT_MS = 1500

const tvMode = () => document.documentElement.classList.contains('tv')
const cssUrl = url => String(url).replace(/["\\\n]/g, encodeURIComponent)

function loaded (url) {
  return new Promise(resolve => {
    if (!url) return resolve()
    const img = new Image()
    img.onload = img.onerror = () => resolve()
    setTimeout(resolve, ART_WAIT_MS)
    img.src = url
  })
}

function facts (meta) {
  return [
    meta.imdbRating ? `<span class="rating">★ ${esc(meta.imdbRating)}</span>` : '',
    ...[meta.releaseInfo || meta.year, meta.runtime, meta.genres?.slice(0, 3).join(', ')].filter(Boolean).map(fact => `<span>${esc(fact)}</span>`)
  ].filter(Boolean).join('<span>·</span>')
}

/* The billboard in `slot`, standing in for `heading` once it has something.
 *
 *   offer(key, { label, order, items: [{ meta, because? }] })   a source answered
 *   skip(ids)   titles never to feature: already watched or saved
 *   settle()    stop waiting for more before showing it
 *
 * Sources arriving after it shows are fitted in after the title on screen. */
export function billboard (slot, heading) {
  const sources = new Map()
  let exclude = new Set()
  let slides = []
  let current = -1
  let settled = false
  let node = null
  let info = null
  let row = null
  let layer = 0
  let elapsed = 0
  let hovering = false
  let focused = false
  // Reduced motion: it never moves on by itself.
  let still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

  // Until the sources answer, a placeholder its size keeps the page still.
  slot.replaceChildren(h('<section class="billboard skeleton" aria-hidden="true"></section>'))
  heading.hidden = true

  function offer (key, source) {
    sources.set(key, source)
    if (settled) refresh()
  }

  function settle () {
    if (settled) return
    settled = true
    refresh()
  }

  function refresh () {
    const ordered = [...sources.values()].sort((a, b) => (a.order || 0) - (b.order || 0))
    const fresh = mixSlides(ordered, { max: MAX_SLIDES, day: Math.floor(Date.now() / 864e5), exclude })
    if (!node) {
      if (!fresh.length) {
        // Nothing to feature, for now: the plain heading, as before there was a billboard.
        slot.replaceChildren()
        heading.hidden = false
        return
      }
      slides = fresh
      build()
      show(0)
      return
    }
    // What has been on screen stays where it was; anything new comes next.
    const kept = slides.slice(0, current + 1)
    const ids = new Set(kept.map(slide => slide.meta.id))
    slides = [...kept, ...fresh.filter(slide => !ids.has(slide.meta.id))].slice(0, MAX_SLIDES)
    drawChoices()
  }

  function build () {
    node = h(`
      <section class="billboard" aria-roledescription="carousel" aria-label="Featured">
        <div class="billboard-art"></div>
        <div class="billboard-art"></div>
        <div class="content">
          <div class="info"></div>
          <div class="billboard-choices" role="tablist" aria-label="Featured titles"></div>
        </div>
        <button class="billboard-nav prev" type="button" tabindex="-1" aria-label="Previous title">‹</button>
        <button class="billboard-nav next" type="button" tabindex="-1" aria-label="Next title">›</button>
      </section>`)
    node.style.setProperty('--rotate', `${ROTATE_MS}ms`)
    info = node.querySelector('.info')
    row = node.querySelector('.billboard-choices')
    node.querySelector('.prev').addEventListener('click', () => choose(current - 1))
    node.querySelector('.next').addEventListener('click', () => choose(current + 1))
    node.addEventListener('pointerenter', () => { hovering = true })
    node.addEventListener('pointerleave', () => { hovering = false })
    node.addEventListener('focusin', () => { focused = true })
    node.addEventListener('focusout', event => { if (!node.contains(event.relatedTarget)) focused = false })
    // A finger swipes it along.
    let start = null
    node.addEventListener('touchstart', event => {
      start = { x: event.touches[0].clientX, y: event.touches[0].clientY }
    }, { passive: true })
    node.addEventListener('touchend', event => {
      if (!start) return
      const dx = event.changedTouches[0].clientX - start.x
      const dy = event.changedTouches[0].clientY - start.y
      start = null
      if (Math.abs(dx) > 50 && Math.abs(dx) > 1.5 * Math.abs(dy)) choose(current + (dx < 0 ? 1 : -1))
    }, { passive: true })
    drawChoices()
    slot.replaceChildren(node)
    heading.hidden = true
    const timer = setInterval(() => {
      // Gone with the page: nothing else stops it.
      if (!node.isConnected) return clearInterval(timer)
      const paused = hovering || focused || document.hidden
      node.classList.toggle('paused', paused)
      node.classList.toggle('still', still || slides.length < 2)
      if (still || paused || slides.length < 2) return
      elapsed += TICK_MS
      if (elapsed >= ROTATE_MS) show(current + 1)
    }, TICK_MS)
  }

  function drawChoices () {
    // Rebuilding the thumbnails must not take the remote's place away.
    const had = row.contains(document.activeElement) ? [...row.children].indexOf(document.activeElement) : -1
    row.replaceChildren(...slides.map((slide, index) => {
      const name = slide.meta.name || ''
      const button = h(`
        <button class="choice" type="button" role="tab" aria-label="${esc(name)}" title="${esc(name)}">
          <img alt="" loading="lazy" src="${esc(slide.meta.poster || slide.meta.background || '')}">
        </button>`)
      button.addEventListener('click', () => choose(index))
      // On a TV, moving onto a thumbnail is enough to show it.
      button.addEventListener('focus', () => { if (tvMode() && index !== current) choose(index) })
      return button
    }))
    row.hidden = slides.length < 2
    // The countdown bar starts again below; so does the time it shows.
    elapsed = 0
    markChoices()
    if (had >= 0) row.children[Math.min(had, row.children.length - 1)]?.focus({ preventScroll: true })
  }

  function markChoices () {
    const buttons = [...row.children]
    buttons.forEach(button => button.classList.remove('active'))
    // Restarts the countdown bar under the one now showing.
    void row.offsetWidth
    buttons.forEach((button, index) => {
      button.classList.toggle('active', index === current)
      button.setAttribute('aria-selected', String(index === current))
    })
  }

  // You chose: this one stays.
  function choose (index) {
    still = true
    show(index)
  }

  async function show (index) {
    current = (index + slides.length) % slides.length
    elapsed = 0
    const slide = slides[current]
    markChoices()
    await loaded(slide.meta.background || slide.meta.poster)
    if (slides[current] !== slide) return
    paint(slide, true)
    // Catalogue entries are often brief; the title's own record has the rest.
    if (!slide.full && (!slide.meta.description || !slide.meta.background)) {
      slide.full = true
      try { slide.meta = { ...slide.meta, ...(await api.meta(slide.meta.type || 'movie', slide.meta.id)) } } catch { /* the brief one will do */ }
      if (slides[current] === slide) paint(slide, false)
    }
    // The next picture, fetched while this one is read.
    const next = slides[(current + 1) % slides.length]?.meta
    if (next && next !== slide.meta) loaded(next.background || next.poster)
  }

  function paint (slide, fresh) {
    const meta = slide.meta
    const art = meta.background || meta.poster || ''
    const layers = node.querySelectorAll('.billboard-art')
    if (layers[layer].dataset.art !== art) {
      layer ^= 1
      layers[layer].style.backgroundImage = art ? `url("${cssUrl(art)}")` : ''
      layers[layer].dataset.art = art
      layers[layer].classList.add('on')
      layers[layer ^ 1].classList.remove('on')
    }
    if (!fresh) {
      // The fuller record, filled in around whatever the remote is on.
      info.querySelector('.facts').innerHTML = facts(meta)
      if (meta.description && !info.querySelector('.desc')) {
        info.querySelector('.cta').before(h(`<p class="desc">${esc(meta.description)}</p>`))
      }
      return
    }
    const href = detailHref(meta)
    info.innerHTML = `
      <span class="eyebrow">${esc([slide.label, slide.because ? `Like ${slide.because}` : ''].filter(Boolean).join(' · '))}</span>
      <h1>${esc(meta.name)}</h1>
      <div class="facts">${facts(meta)}</div>
      ${meta.description ? `<p class="desc">${esc(meta.description)}</p>` : ''}
      <div class="cta">
        <a class="btn primary" href="${esc(href)}?play=1">▶ Play</a>
        <a class="btn" href="${esc(href)}">ⓘ More info</a>
      </div>`
    info.classList.remove('enter')
    void info.offsetWidth
    info.classList.add('enter')
  }

  return {
    offer,
    settle,
    skip (ids) { exclude = new Set(ids) }
  }
}
